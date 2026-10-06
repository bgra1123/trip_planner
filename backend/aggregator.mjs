// Flight aggregation across sources that can't all be reached the same way.
//
// A public API (Amadeus) can be queried server-side. A bank travel portal
// cannot: it needs the user's authenticated session, which lives in their
// browser and nowhere else. So the extension scrapes those portals and POSTs
// what it found to /api/flights/ingest, and a later /api/flights/search folds
// that in alongside the API results.
//
// Ingested data is therefore always a little stale by construction, and every
// entry carries the time it was captured so the app can say so.

const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_ENTRIES = 200;

// key -> { source, offers, searchParams, receivedAt }
const store = new Map();

export function ttlMs() {
  return TTL_MS;
}

// Bank portals are searched per route and date, so that is the grain the
// cache is keyed at. A missing date still gets a stable key so a capture is
// never silently dropped for want of one.
function cacheKey(source, params) {
  const p = params || {};
  return [
    String(source || 'unknown').toLowerCase(),
    String(p.from || p.origin || '').toUpperCase(),
    String(p.to || p.destination || '').toUpperCase(),
    String(p.date || p.departDate || ''),
    String(p.returnDate || ''),
  ].join('|');
}

function isFresh(entry, now) {
  return now - entry.receivedAt < TTL_MS;
}

// Drop everything expired. Called on every read and write, since there is no
// background timer in a process that may sit idle for hours.
function evict(now) {
  for (const [key, entry] of store) {
    if (!isFresh(entry, now)) store.delete(key);
  }
  // Hard cap as a safety valve against unbounded growth from many routes.
  while (store.size > MAX_ENTRIES) {
    const oldest = [...store.entries()].sort((a, b) => a[1].receivedAt - b[1].receivedAt)[0];
    if (!oldest) break;
    store.delete(oldest[0]);
  }
}

export function ingest(source, offers, searchParams) {
  const now = Date.now();
  const list = Array.isArray(offers) ? offers : [];
  const key = cacheKey(source, searchParams);
  store.set(key, {
    source: String(source || 'unknown'),
    offers: list.map((offer) => ({ ...offer, source: offer.source || source })),
    searchParams: searchParams || {},
    receivedAt: now,
  });
  evict(now);
  return { key, stored: list.length, entries: store.size };
}

// Everything ingested for this route/date, from any source, still inside TTL.
export function cachedFor(query) {
  const now = Date.now();
  evict(now);
  const wanted = cacheKey('', query).split('|').slice(1).join('|');
  const out = [];
  for (const entry of store.values()) {
    const entryKey = cacheKey('', entry.searchParams).split('|').slice(1).join('|');
    if (entryKey !== wanted) continue;
    const ageMinutes = Math.round((now - entry.receivedAt) / 60000);
    entry.offers.forEach((offer) => out.push({ ...offer, capturedAt: new Date(entry.receivedAt).toISOString(), ageMinutes }));
  }
  return out;
}

export function summary() {
  const now = Date.now();
  evict(now);
  const bySource = {};
  for (const entry of store.values()) {
    if (!bySource[entry.source]) bySource[entry.source] = { entries: 0, offers: 0, newestAt: null };
    const s = bySource[entry.source];
    s.entries += 1;
    s.offers += entry.offers.length;
    const at = new Date(entry.receivedAt).toISOString();
    if (!s.newestAt || at > s.newestAt) s.newestAt = at;
  }
  return { entries: store.size, ttlMinutes: Math.round(TTL_MS / 60000), bySource };
}

export function clear() {
  store.clear();
}

function priceOf(offer) {
  if (!offer || !offer.price) return null;
  if (typeof offer.price === 'number') return offer.price;
  const amount = offer.price.amount !== undefined ? offer.price.amount : offer.price.low;
  const n = Number(amount);
  return Number.isFinite(n) ? n : null;
}

// Identity of a flight *within one source*. Two sources quoting the same
// flight are deliberately NOT collapsed: "Capital One wants €320, Amex wants
// €340 for this exact flight" is the comparison the user came for. Only an
// exact repeat from the same source is a duplicate.
function dedupeKey(offer) {
  return [
    String(offer.source || '').toLowerCase(),
    String(offer.from || '').toUpperCase(),
    String(offer.to || '').toUpperCase(),
    offer.departure || '',
    offer.arrival || '',
    String(offer.carrier || '').toLowerCase(),
    priceOf(offer),
  ].join('|');
}

// Merge every source's offers, drop within-source repeats, and rank cheapest
// first. Offers with no readable price sort last rather than being discarded —
// a flight the user can see but we couldn't price is still information.
export function aggregate(lists) {
  const seen = new Set();
  const merged = [];
  lists.forEach((list) => {
    (list || []).forEach((offer) => {
      const key = dedupeKey(offer);
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(offer);
    });
  });
  merged.sort((a, b) => {
    const pa = priceOf(a);
    const pb = priceOf(b);
    if (pa === null && pb === null) return 0;
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pa - pb;
  });
  const sources = [];
  merged.forEach((offer) => {
    const s = offer.source || 'unknown';
    if (sources.indexOf(s) === -1) sources.push(s);
  });
  return { offers: merged, sources };
}
