// Collects offers from the TripAgent sources — the Chrome extension
// (push, via window.postMessage) and Claude through the TripAgent server
// (pull, via fetch) — into one staging list.
//
// Staging is deliberate: captured offers do NOT go straight into the
// planner table. The user reviews them and adds the ones they want, so a
// bad scrape can never quietly rewrite a plan they were working on.

import { useCallback, useEffect, useRef, useState } from 'react';
import { listenForExtension, requestCapturedOffers, clearExtensionOffers } from '../utils/tripAgentBridge.js';
import { mergeOffers, offersToRows, offersFromNotesText, normalizeOffers, totalForTravelers } from '../utils/tripAgentOffers.js';
import { fetchPendingOffers, ackOffers } from '../utils/connectorSync.js';

import { useConnector } from './useTripSync.js';

export default function useTripAgent() {
  const { connectorUrl, setConnectorUrl, tripId } = useConnector();
  const [offers, setOffers] = useState([]);
  // Rates that arrived with a capture (a `RATE:` line in selected text). Kept
  // so the panel can tell the user which currencies still lack one, and so a
  // rate they captured isn't silently dropped.
  const [capturedRates, setCapturedRates] = useState({});
  const [extension, setExtension] = useState({ connected: false, version: null });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const stop = listenForExtension({
      onOffers: (incoming, envelope) => {
        if (!mounted.current) return;
        setExtension((s) => (s.connected ? s : { ...s, connected: true }));
        setOffers((prev) => mergeOffers(prev, incoming));
        if (envelope && envelope.rates && Object.keys(envelope.rates).length) {
          setCapturedRates((prev) => ({ ...prev, ...envelope.rates }));
        }
      },
      onStatus: (status) => {
        if (!mounted.current) return;
        setExtension({ connected: true, version: status.version });
      },
    });
    return () => { mounted.current = false; stop(); };
  }, []);

  // ---- Claude connector (mcp-server/) ------------------------------------
  // Options Claude recorded in this trip wait on the server until the user
  // adds or dismisses them here; only then is the server told to forget them.
  // Staging lives in memory, so a reload before reviewing just pulls them
  // again rather than losing them. Each pull is the server's whole current
  // list, so an option Claude corrected or removed replaces its old copy here.
  const [connector, setConnector] = useState({ busy: false, error: null, lastCount: null });
  const connectorRef = useRef({ url: connectorUrl, tripId });
  connectorRef.current = { url: connectorUrl, tripId };
  const fromConnector = useRef(new Set());

  const pullFromClaude = useCallback(async () => {
    const { url, tripId: id } = connectorRef.current;
    if (!url || !id) return;
    setConnector((s) => ({ ...s, busy: true, error: null }));
    try {
      const incoming = normalizeOffers(await fetchPendingOffers(url, id), { source: 'claude' });
      if (!mounted.current || connectorRef.current.tripId !== id || connectorRef.current.url !== url) return;
      const stale = fromConnector.current;
      fromConnector.current = new Set(incoming.map((o) => o.id));
      setOffers((prev) => mergeOffers(prev.filter((o) => !stale.has(o.id)), incoming));
      setConnector({ busy: false, error: null, lastCount: incoming.length });
    } catch (err) {
      if (!mounted.current) return;
      setConnector({ busy: false, error: err.message, lastCount: null });
    }
  }, []);

  // Pull on open, and again whenever the tab comes back into view — the
  // usual path is: record in the Claude app, switch back here.
  useEffect(() => {
    fromConnector.current = new Set();
    setConnector({ busy: false, error: null, lastCount: null });
    if (!connectorUrl || !tripId) return undefined;
    pullFromClaude();
    const onVisible = () => { if (document.visibilityState === 'visible') pullFromClaude(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [connectorUrl, tripId, pullFromClaude]);

  const forgetOnConnector = useCallback((ids) => {
    const { url, tripId: id } = connectorRef.current;
    const done = ids.filter((x) => fromConnector.current.has(x));
    if (!done.length || !url || !id) return;
    done.forEach((x) => fromConnector.current.delete(x));
    ackOffers(url, id, done).catch((err) => {
      // Harmless if it fails: they come back on the next pull, still unreviewed.
      if (mounted.current) setConnector((s) => ({ ...s, error: err.message }));
    });
  }, []);

  const dismissOffer = useCallback((id) => {
    setOffers((prev) => prev.filter((o) => o.id !== id));
    forgetOnConnector([id]);
  }, [forgetOnConnector]);

  const clearOffers = useCallback(() => {
    forgetOnConnector(Array.from(fromConnector.current));
    setOffers([]);
    setCapturedRates({});
    clearExtensionOffers();
  }, [forgetOnConnector]);

  const refreshFromExtension = useCallback(() => { requestCapturedOffers(); }, []);

  // Trip-notes lines from somewhere other than the extension (a screenshot
  // the model transcribed) go through the same parser and into the same
  // staging list, so they are reviewed before anything reaches the plan.
  // Returns how many offers were staged.
  const stageNotes = useCallback((notesText, source, travelers) => {
    const parsed = offersFromNotesText(notesText, { source: source || 'screenshot' });
    const { rates } = parsed;
    // Only when the user said the prices are per traveler (see the panel).
    const incoming = travelers ? totalForTravelers(parsed.offers, travelers) : parsed.offers;
    if (incoming.length) setOffers((prev) => mergeOffers(prev, incoming));
    if (rates && Object.keys(rates).length) setCapturedRates((prev) => ({ ...prev, ...rates }));
    return incoming.length;
  }, []);

  // Offers read from pasted page text (see utils/pasteResults.js). Prices are as
  // shown; the caller passes `travelers` only when the user said per traveler.
  // Returns how many were staged.
  const stageRawOffers = useCallback((raw, source, window, travelers) => {
    let incoming = normalizeOffers(raw, { source: source || 'pasted', window: window || '' });
    if (travelers) incoming = totalForTravelers(incoming, travelers);
    if (incoming.length) setOffers((prev) => mergeOffers(prev, incoming));
    return incoming.length;
  }, []);

  // Hand back rows for the given offer ids and drop them from staging, so
  // an offer cannot be added to the table twice by a double click. Rows are
  // built from the rendered `offers` (not inside the state updater, which
  // React may run later or twice) and the removal is a separate update.
  //
  // `groupOverrides` ({id: group}) lets the panel apply a group the user
  // picked or confirmed for a stay whose capture had none — without this, a
  // hotel captured from a page with no parseable place silently becomes its
  // own disconnected itinerary leg instead of an alternative to compare.
  const takeRowsFor = useCallback((ids, groupOverrides = {}) => {
    const wanted = new Set(ids);
    const picked = offers
      .filter((o) => wanted.has(o.id))
      .map((o) => (groupOverrides[o.id] !== undefined ? { ...o, group: groupOverrides[o.id] } : o));
    const rows = offersToRows(picked);
    setOffers((prev) => prev.filter((o) => !wanted.has(o.id)));
    forgetOnConnector(ids);
    return rows;
  }, [offers, forgetOnConnector]);

  return {
    offers, capturedRates, extension, dismissOffer, clearOffers, refreshFromExtension, takeRowsFor, stageNotes, stageRawOffers,
    connectorUrl, setConnectorUrl, connector, pullFromClaude,
  };
}
