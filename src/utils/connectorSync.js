// Planner side of the TripAgent server (mcp-server/). One server holds the
// user's trips for both Claude and the planner: the planner saves each trip's
// snapshot there, Claude reads it and records options into it, and the
// planner pulls those options into its review list and tells the server which
// ones the user added or dismissed.
//
// The user pastes the same URL here that they gave Claude as a connector:
//   https://<worker>.workers.dev/mcp/<TOKEN>
// and the planner API lives beside it at /api/<TOKEN>/...

export function apiBaseFromConnectorUrl(connectorUrl) {
  let url;
  try {
    url = new URL(String(connectorUrl || '').trim());
  } catch {
    return null;
  }
  const match = url.pathname.match(/^\/mcp\/([^/]+)\/?$/);
  if (!match || (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1')) return null;
  return `${url.origin}/api/${match[1]}`;
}

function baseOrThrow(connectorUrl) {
  const apiBase = apiBaseFromConnectorUrl(connectorUrl);
  if (!apiBase) throw new Error('That is not a connector URL — it should look like https://…/mcp/<token>.');
  return apiBase;
}

// `allow404` is for "this trip isn't on the server (yet)" — the server answers
// the same 404 for a wrong token, so a missing trip is only reported as such
// when the caller asked about one specific trip.
async function request(apiBase, path, init, { allow404 = false } = {}) {
  let res;
  try {
    res = await fetch(`${apiBase}${path}`, init);
  } catch {
    throw new Error('Could not reach TripAgent — check the URL and your connection.');
  }
  if (res.status === 404) {
    if (allow404) return null;
    throw new Error('TripAgent did not recognize that URL — check it matches the one added in Claude.');
  }
  if (!res.ok) throw new Error(`TripAgent answered ${res.status}.`);
  return res.json();
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const tripPath = (id) => `/trips/${encodeURIComponent(id)}`;

export async function listRemoteTrips(connectorUrl) {
  const body = await request(baseOrThrow(connectorUrl), '/trips', { headers: { Accept: 'application/json' } });
  return Array.isArray(body && body.trips) ? body.trips : [];
}

// Resolves null when the server doesn't have that trip.
export function getRemoteTrip(connectorUrl, id) {
  return request(baseOrThrow(connectorUrl), tripPath(id), { headers: { Accept: 'application/json' } }, { allow404: true });
}

export function putRemoteTrip(connectorUrl, trip) {
  return request(baseOrThrow(connectorUrl), tripPath(trip.id), {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ title: trip.title, snapshot: trip.snapshot, updatedAt: trip.updatedAt }),
  });
}

export function deleteRemoteTrip(connectorUrl, id) {
  return request(baseOrThrow(connectorUrl), tripPath(id), { method: 'DELETE' });
}

// Options Claude recorded in this trip. A trip the server doesn't have yet has
// nothing waiting, which is not an error.
export async function fetchPendingOffers(connectorUrl, tripId) {
  const body = await request(baseOrThrow(connectorUrl), `${tripPath(tripId)}/pending`, { headers: { Accept: 'application/json' } }, { allow404: true });
  return Array.isArray(body && body.offers) ? body.offers : [];
}

export async function ackOffers(connectorUrl, tripId, ids) {
  const apiBase = apiBaseFromConnectorUrl(connectorUrl);
  if (!apiBase || !ids.length) return null;
  return request(apiBase, `${tripPath(tripId)}/ack`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ ids }) }, { allow404: true });
}

// Tell the server which trip is open here, so captures from tools that have no
// trip of their own (the browser extension) land in it. Best effort: a failure
// only means captures go to the server's fallback (the only trip), or are
// refused with a clear message.
export function setActiveRemoteTrip(connectorUrl, id) {
  return request(baseOrThrow(connectorUrl), '/active', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ tripId: id }) });
}
