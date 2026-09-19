// Client for the TripAgent backend (backend/server.mjs).
//
// The backend is optional: when it is not running, every call here rejects
// with a readable message and the app carries on as a purely manual
// planner. Nothing in the app blocks on it.

import { normalizeOffers } from './tripAgentOffers.js';

const DEFAULT_BASE = 'http://localhost:8787';

export function apiBase() {
  if (typeof process !== 'undefined' && process.env && process.env.REACT_APP_TRIPAGENT_API) {
    return String(process.env.REACT_APP_TRIPAGENT_API).replace(/\/+$/, '');
  }
  return DEFAULT_BASE;
}

async function getJson(path, params) {
  const url = new URL(apiBase() + path);
  Object.keys(params || {}).forEach((k) => {
    if (params[k] !== undefined && params[k] !== null && params[k] !== '') url.searchParams.set(k, params[k]);
  });
  let response;
  try {
    response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  } catch (err) {
    throw new Error(`Cannot reach the TripAgent backend at ${apiBase()} — start it with "npm run backend".`);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && body.error ? body.error : `${response.status} ${response.statusText}`;
    throw new Error(`Backend error: ${message}`);
  }
  return body;
}

export async function checkBackend() {
  const body = await getJson('/api/health', {});
  return { ok: true, live: !!(body && body.live), provider: body ? body.provider : null };
}

// { from, to, date, returnDate, adults, currency, window } -> canonical offers.
export async function searchFlights(query) {
  const body = await getJson('/api/flights', {
    from: query.from,
    to: query.to,
    date: query.date,
    returnDate: query.returnDate,
    adults: query.adults,
    currency: query.currency,
  });
  const offers = normalizeOffers(body && body.offers, {
    kind: 'flight',
    source: (body && body.provider) || 'backend',
    window: query.window || '',
  });
  return { offers, live: !!(body && body.live), provider: body ? body.provider : null };
}
