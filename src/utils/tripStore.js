// The planner's trips, as stored in this browser: a list of trips plus which
// one is open. Each trip is { id, title, createdAt, updatedAt, syncedAt?,
// snapshot } where snapshot is the planner's own state for that trip (the
// same object the single-trip planner used to save).
//
// Everything here is pure (state in, state out) except load/save, so the
// rules — migration, deletion, what counts as unsynced — are testable.

export const STORE_KEY = 'trip-planner:v2';
export const LEGACY_KEY = 'trip-planner:v1';
const MAX_TITLE = 80;

export function newTripId() {
  const bytes = new Uint8Array(9);
  (typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
  return `t${Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('')}`.slice(0, 20);
}

export function emptySnapshot() {
  return { version: 1, notesText: '', rows: [], notes: [], rateRows: [], selection: { travel: {}, stay: {}, activity: {} }, activeWindow: null };
}

const cleanTitle = (t) => String(t || '').trim().slice(0, MAX_TITLE);

export function makeTrip(title, snapshot, now = Date.now()) {
  return { id: newTripId(), title: cleanTitle(title) || 'Untitled trip', createdAt: now, updatedAt: now, snapshot };
}

const validSnapshot = (s) => !!s && typeof s === 'object' && Array.isArray(s.rows);

// `null` snapshot means "the example trip" — only the very first trip of a
// brand-new user, which the workspace fills with the sample notes.
export function loadStore(storage, now = Date.now()) {
  try {
    const raw = storage.getItem(STORE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.trips) && data.trips.length) {
        const trips = data.trips.filter((t) => t && typeof t.id === 'string');
        if (trips.length) {
          return {
            trips,
            activeId: trips.some((t) => t.id === data.activeId) ? data.activeId : trips[0].id,
            deletedIds: Array.isArray(data.deletedIds) ? data.deletedIds.filter((x) => typeof x === 'string') : [],
          };
        }
      }
    }
  } catch { /* fall through to migration */ }

  let snapshot = null;
  try {
    const legacy = JSON.parse(storage.getItem(LEGACY_KEY) || 'null');
    if (validSnapshot(legacy)) snapshot = legacy;
  } catch { /* none */ }
  const trip = makeTrip('My trip', snapshot, now);
  return { trips: [trip], activeId: trip.id, deletedIds: [] };
}

export function saveStore(storage, store) {
  try { storage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* blocked or full — in-memory only this session */ }
}

const withTrip = (store, id, fn) => ({ ...store, trips: store.trips.map((t) => (t.id === id ? fn(t) : t)) });

// Called with every change the workspace reports. A no-op report (same
// snapshot as stored) must not bump updatedAt, or merely opening a trip would
// mark it unsynced.
export function setSnapshot(store, id, snapshot, now = Date.now()) {
  const trip = store.trips.find((t) => t.id === id);
  if (!trip || JSON.stringify(trip.snapshot) === JSON.stringify(snapshot)) return store;
  return withTrip(store, id, (t) => ({ ...t, snapshot, updatedAt: now }));
}

export function renameTrip(store, id, title, now = Date.now()) {
  const next = cleanTitle(title);
  const trip = store.trips.find((t) => t.id === id);
  if (!trip || !next || next === trip.title) return store;
  return withTrip(store, id, (t) => ({ ...t, title: next, updatedAt: now }));
}

export function addTrip(store, trip) {
  return { ...store, trips: [...store.trips, trip], activeId: trip.id };
}

export function selectTrip(store, id) {
  return store.trips.some((t) => t.id === id) ? { ...store, activeId: id } : store;
}

// Deleting is remembered (deletedIds) until the server has been told, so a
// trip deleted offline doesn't come back at the next sync. The last trip is
// replaced by a fresh empty one: the planner always has a trip open.
export function removeTrip(store, id, now = Date.now()) {
  if (!store.trips.some((t) => t.id === id)) return store;
  let trips = store.trips.filter((t) => t.id !== id);
  if (!trips.length) trips = [makeTrip('My trip', emptySnapshot(), now)];
  const activeId = store.activeId === id || !trips.some((t) => t.id === store.activeId) ? trips[0].id : store.activeId;
  return { trips, activeId, deletedIds: store.deletedIds.includes(id) ? store.deletedIds : [...store.deletedIds, id] };
}

export function forgetDeleted(store, id) {
  return store.deletedIds.includes(id) ? { ...store, deletedIds: store.deletedIds.filter((x) => x !== id) } : store;
}

// A server trip arrives locally (made by Claude, or on another device).
export function adoptRemoteTrip(store, remote) {
  if (store.trips.some((t) => t.id === remote.id)) return store;
  const updatedAt = Number.isFinite(remote.updatedAt) ? remote.updatedAt : Date.now();
  const trip = {
    id: remote.id,
    title: cleanTitle(remote.title) || 'Untitled trip',
    createdAt: Number.isFinite(remote.createdAt) ? remote.createdAt : updatedAt,
    updatedAt,
    syncedAt: updatedAt,
    snapshot: validSnapshot(remote.snapshot) ? remote.snapshot : emptySnapshot(),
  };
  // Don't steal focus: the user may be mid-edit in another trip.
  return { ...store, trips: [...store.trips, trip] };
}

// Take the server's newer copy of a trip we haven't edited since last sync.
export function replaceFromRemote(store, remote) {
  const local = store.trips.find((t) => t.id === remote.id);
  if (!local || !validSnapshot(remote.snapshot)) return store;
  return withTrip(store, remote.id, (t) => ({
    ...t,
    title: cleanTitle(remote.title) || t.title,
    updatedAt: remote.updatedAt,
    syncedAt: remote.updatedAt,
    snapshot: remote.snapshot,
  }));
}

export function markSynced(store, id, updatedAt) {
  const trip = store.trips.find((t) => t.id === id);
  // Only if nothing changed while the request was in flight.
  if (!trip || trip.updatedAt !== updatedAt || trip.syncedAt === updatedAt) return store;
  return withTrip(store, id, (t) => ({ ...t, syncedAt: updatedAt }));
}

// Changed here since the server last had it (or never sent).
export const isDirty = (trip) => trip.syncedAt !== trip.updatedAt;
