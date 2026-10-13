// Keeps the planner's trips and the TripBuddy server's trips the same, so
// Claude and the planner work on the same trips. Local-first: everything
// works with no connector; with one, trips are saved to the server shortly
// after each change, and checked against it on connect and whenever the
// planner comes back into view (the usual path: talk to Claude, switch back).
//
// Rules (the server only ever holds the planner's own copy of a snapshot, so
// there is no merging — it is one trip, last writer wins):
//   - a trip we edited since the server last had it is pushed;
//   - a trip the server has newer, that we haven't edited, is pulled;
//   - a trip the server has that we don't is adopted (Claude made it, or
//     another device did) unless we deleted it here;
//   - a trip we have that the server lacks is pushed, unless it was synced
//     before — then it was deleted elsewhere, and is dropped here too.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  listRemoteTrips, getRemoteTrip, putRemoteTrip, deleteRemoteTrip, setActiveRemoteTrip,
} from '../utils/connectorSync.js';
import { isExtensionEnvelope, postToExtension } from '../utils/tripAgentBridge.js';
import {
  adoptRemoteTrip, replaceFromRemote, markSynced, isDirty, forgetDeleted, removeTrip,
} from '../utils/tripStore.js';

const CONNECTOR_STORAGE = 'tripagent:claude-connector-url';
const PUSH_DELAY_MS = 1500;

function readConnectorUrl() {
  try { return window.localStorage.getItem(CONNECTOR_STORAGE) || ''; } catch { return ''; }
}

// The open trip's id and the connector, for the capture panel.
export const ConnectorContext = createContext({ connectorUrl: '', setConnectorUrl: () => {}, tripId: null, sync: { busy: false, error: null } });
export const useConnector = () => useContext(ConnectorContext);

export default function useTripSync(store, setStore) {
  const [connectorUrl, setConnectorUrlState] = useState(readConnectorUrl);
  const [sync, setSync] = useState({ busy: false, error: null, lastSyncedAt: null });
  const storeRef = useRef(store);
  storeRef.current = store;
  const urlRef = useRef(connectorUrl);
  const running = useRef(false);
  const again = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const setConnectorUrl = useCallback((url) => {
    const value = String(url || '').trim();
    try {
      if (value) window.localStorage.setItem(CONNECTOR_STORAGE, value);
      else window.localStorage.removeItem(CONNECTOR_STORAGE);
    } catch { /* storage blocked — kept for this session only */ }
    urlRef.current = value;
    setConnectorUrlState(value);
    setSync({ busy: false, error: null, lastSyncedAt: null });
  }, []);

  const syncNow = useCallback(async () => {
    const url = urlRef.current;
    if (!url) return;
    if (running.current) { again.current = true; return; }
    running.current = true;
    if (mounted.current) setSync((s) => ({ ...s, busy: true, error: null }));
    try {
      const remote = await listRemoteTrips(url);
      const remoteIds = new Set(remote.map((r) => r.id));

      // 1. Deletions made here: tell the server, then stop remembering them.
      for (const id of storeRef.current.deletedIds) {
        if (!mounted.current || urlRef.current !== url) return;
        if (remoteIds.has(id)) await deleteRemoteTrip(url, id);
        setStore((s) => forgetDeleted(s, id));
      }

      // 2. Server trips: adopt, or pull when newer and untouched here.
      for (const r of remote) {
        if (!mounted.current || urlRef.current !== url) return;
        if (storeRef.current.deletedIds.includes(r.id)) continue;
        const local = storeRef.current.trips.find((t) => t.id === r.id);
        if (local && (isDirty(local) || !(r.updatedAt > (local.syncedAt || 0)))) continue;
        const full = await getRemoteTrip(url, r.id);
        if (!full) continue;
        setStore((s) => (s.trips.some((t) => t.id === full.id) ? replaceFromRemote(s, full) : adoptRemoteTrip(s, full)));
      }

      // 3. Local trips the server lacks: gone elsewhere, or new here.
      for (const local of storeRef.current.trips) {
        if (!mounted.current || urlRef.current !== url) return;
        if (remoteIds.has(local.id)) continue;
        if (local.syncedAt !== undefined && !isDirty(local)) {
          // The list is eventually consistent; only a direct 404 proves it's gone.
          const check = await getRemoteTrip(url, local.id);
          if (!check) setStore((s) => removeTrip(s, local.id));
        }
      }

      if (mounted.current) setSync({ busy: false, error: null, lastSyncedAt: Date.now() });
    } catch (err) {
      if (mounted.current) setSync((s) => ({ ...s, busy: false, error: err.message }));
    } finally {
      running.current = false;
      if (again.current) { again.current = false; syncNow(); }
    }
  }, [setStore]);

  // Check on connect, and whenever the planner is shown again.
  useEffect(() => {
    if (!connectorUrl) return undefined;
    syncNow();
    const onVisible = () => { if (document.visibilityState === 'visible') syncNow(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [connectorUrl, syncNow]);

  // Tell the server which trip is open, so captures from the browser extension
  // land in it. The trip has to exist there first, so this waits for its push.
  const activeId = store.activeId;
  const activeSynced = (() => { const t = store.trips.find((x) => x.id === activeId); return !!t && t.syncedAt !== undefined; })();
  useEffect(() => {
    if (!connectorUrl || !activeSynced) return;
    setActiveRemoteTrip(connectorUrl, activeId).catch(() => { /* best effort */ });
  }, [connectorUrl, activeId, activeSynced]);

  // Tell the browser extension (if installed) where TripBuddy is, so it needs
  // no setup of its own. It answers our READY with STATUS, which also covers
  // the extension loading after this page.
  useEffect(() => {
    if (!connectorUrl) return undefined;
    const announce = () => postToExtension('CONNECTOR', { url: connectorUrl });
    announce();
    const onMessage = (event) => { if (isExtensionEnvelope(event) && event.data.type === 'STATUS') announce(); };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [connectorUrl]);

  // A trip deleted here is removed on the server straight away.
  const pendingDeletes = store.deletedIds.length;
  useEffect(() => { if (connectorUrl && pendingDeletes) syncNow(); }, [connectorUrl, pendingDeletes, syncNow]);

  // Push edits shortly after they stop.
  useEffect(() => {
    if (!connectorUrl) return undefined;
    const dirty = store.trips.filter((t) => t.snapshot && isDirty(t));
    if (!dirty.length) return undefined;
    const timer = setTimeout(async () => {
      for (const trip of dirty) {
        try {
          // Re-read: the trip may have changed or been deleted meanwhile.
          const current = storeRef.current.trips.find((t) => t.id === trip.id);
          if (!current || !current.snapshot || !isDirty(current) || urlRef.current !== connectorUrl) continue;
          await putRemoteTrip(connectorUrl, current);
          setStore((s) => markSynced(s, current.id, current.updatedAt));
        } catch (err) {
          if (mounted.current) setSync((s) => ({ ...s, error: err.message }));
          return;
        }
      }
      if (mounted.current) setSync((s) => ({ ...s, error: null, lastSyncedAt: Date.now() }));
    }, PUSH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [store.trips, connectorUrl, setStore]);

  return { connectorUrl, setConnectorUrl, sync, syncNow };
}
