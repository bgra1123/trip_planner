#!/usr/bin/env node
// TripAgent backend: a small proxy in front of a flight-search API.
//
// It exists so API credentials never reach the browser, and so the app has
// one stable offer shape regardless of which provider is behind it. No
// dependencies — Node 18+ only.
//
//   npm run backend                 # sample data, no credentials needed
//   AMADEUS_CLIENT_ID=... AMADEUS_CLIENT_SECRET=... npm run backend
//
// Endpoints:
//   GET  /api/health
//   GET  /api/flights?from=IST&to=MUC&date=2026-08-14[&returnDate=][&adults=1][&currency=EUR]
//   POST /api/flights/search   { from, to, date, returnDate, adults, currency }
//   POST /api/flights/ingest   { source, offers|flights, searchParams }
//   GET  /api/flights/ingested?from=&to=&date=
//
// The ingest endpoint exists because a bank travel portal cannot be queried
// from here: it needs the user's authenticated browser session. The extension
// scrapes it there and posts the result, and a later search folds it in.

import { createServer } from 'node:http';
import { argv } from 'node:process';
import { pathToFileURL } from 'node:url';
import { isConfigured, searchFlights } from './amadeus.mjs';
import { sampleFlights } from './sample.mjs';
import { ingest, cachedFor, aggregate, summary } from './aggregator.mjs';

const PORT = Number(process.env.PORT || 8787);
const DEFAULT_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

function allowedOrigins() {
  if (!process.env.ALLOWED_ORIGINS) return DEFAULT_ORIGINS;
  return process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
}

// An installed browser extension has an unstable id while unpacked, so it
// cannot be named in an allowlist. Extension origins are accepted as a class:
// reaching this server at all requires the user to have installed that
// extension themselves. Set ALLOW_EXTENSION_ORIGINS=false to refuse them.
function originAllowed(origin) {
  if (!origin) return false;
  if (allowedOrigins().includes(origin)) return true;
  if (process.env.ALLOW_EXTENSION_ORIGINS === 'false') return false;
  return /^(chrome-extension|moz-extension|safari-web-extension):\/\//.test(origin);
}

// Echo back only origins that pass. A wildcard would let any page the user
// visits drive this server — and with credentials configured, spend their API
// quota.
function corsHeaders(request) {
  const origin = request.headers.origin;
  const headers = { Vary: 'Origin' };
  if (originAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Accept, Content-Type';
    headers['Access-Control-Max-Age'] = '600';
  }
  return headers;
}

const MAX_BODY_BYTES = 1_000_000;

// Read and parse a JSON body, refusing anything oversized rather than
// buffering it — a scraper bug should not be able to exhaust memory here.
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes.`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) { resolve({}); return; }
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch (err) {
        reject(new Error('Body is not valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function send(response, status, body, extraHeaders) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  response.end(payload);
}

// Reject anything that is not obviously a well-formed query before it
// reaches a paid API.
function validateFlightQuery(params) {
  const from = String(params.get('from') || '').trim().toUpperCase();
  const to = String(params.get('to') || '').trim().toUpperCase();
  const date = String(params.get('date') || '').trim();
  const returnDate = String(params.get('returnDate') || '').trim();
  const adults = Number(params.get('adults') || 1);
  const currency = String(params.get('currency') || 'EUR').trim().toUpperCase();

  const errors = [];
  if (!/^[A-Z]{3}$/.test(from)) errors.push('"from" must be a 3-letter IATA code');
  if (!/^[A-Z]{3}$/.test(to)) errors.push('"to" must be a 3-letter IATA code');
  if (from && from === to) errors.push('"from" and "to" must differ');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('"date" must be YYYY-MM-DD');
  if (returnDate && !/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) errors.push('"returnDate" must be YYYY-MM-DD');
  if (returnDate && date && returnDate < date) errors.push('"returnDate" must not precede "date"');
  if (!Number.isInteger(adults) || adults < 1 || adults > 9) errors.push('"adults" must be an integer between 1 and 9');
  if (!/^[A-Z]{3}$/.test(currency)) errors.push('"currency" must be a 3-letter code');

  if (errors.length) return { errors };
  return { query: { from, to, date, returnDate: returnDate || null, adults, currency } };
}

async function handleFlights(params) {
  const { errors, query } = validateFlightQuery(params);
  if (errors) return { status: 400, body: { error: errors.join('; ') } };

  // Whatever the extension scraped for this route is available regardless of
  // whether the API call succeeds, so it is gathered first.
  const ingested = cachedFor(query);

  let providerOffers = [];
  let live = false;
  let provider = 'sample';
  let note = null;
  let providerError = null;

  if (!isConfigured()) {
    providerOffers = sampleFlights(query);
    note = 'No AMADEUS_CLIENT_ID/AMADEUS_CLIENT_SECRET configured — API results are sample data.';
  } else {
    provider = 'amadeus';
    try {
      providerOffers = await searchFlights(query);
      live = true;
    } catch (err) {
      // A failed API call must not discard scraped portal data, which is
      // often the only source for a route a bank portal prices differently.
      providerError = err.message;
    }
  }

  const { offers, sources } = aggregate([ingested, providerOffers]);

  // Only a total failure is an error: if the API died but the extension had
  // captured something, the user still gets answers.
  if (providerError && !offers.length) {
    return { status: 502, body: { error: providerError, provider, live: false, query, offers: [], sources: [] } };
  }

  return {
    status: 200,
    body: {
      live,
      provider,
      query,
      offers,
      sources,
      ingested: { count: ingested.length, sources: summary().bySource },
      ...(note ? { note } : {}),
      ...(providerError ? { providerError } : {}),
    },
  };
}

// Normalize the guide's POST shape onto the same validated query the GET
// endpoint uses, so both paths share one validator.
function paramsFromBody(body) {
  const params = new URLSearchParams();
  const map = {
    from: ['from', 'origin'],
    to: ['to', 'destination'],
    date: ['date', 'departDate'],
    returnDate: ['returnDate'],
    adults: ['adults', 'passengers'],
    currency: ['currency'],
  };
  Object.keys(map).forEach((key) => {
    for (const alias of map[key]) {
      if (body[alias] !== undefined && body[alias] !== null && body[alias] !== '') {
        params.set(key, String(body[alias]));
        return;
      }
    }
  });
  return params;
}

function handleIngest(body) {
  const source = String(body.source || '').trim();
  if (!source) return { status: 400, body: { error: '"source" is required (e.g. "capital-one").' } };
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/i.test(source)) {
    return { status: 400, body: { error: '"source" must be a short slug like "capital-one".' } };
  }
  // The guide's extension posts `flights`; the scrapers here produce `offers`.
  // Accept either rather than making the caller care.
  const offers = Array.isArray(body.offers) ? body.offers
    : (Array.isArray(body.flights) ? body.flights : null);
  if (!offers) return { status: 400, body: { error: '"offers" (or "flights") must be an array.' } };
  if (!offers.length) return { status: 400, body: { error: 'Nothing to ingest — the array is empty.' } };

  const searchParams = body.searchParams && typeof body.searchParams === 'object' ? body.searchParams : {};
  const result = ingest(source, offers, searchParams);
  return { status: 200, body: { ok: true, source, ...result, ttlMinutes: summary().ttlMinutes } };
}

const server = createServer(async (request, response) => {
  const cors = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors);
    response.end();
    return;
  }
  if (request.method !== 'GET' && request.method !== 'POST') {
    send(response, 405, { error: 'Only GET and POST are supported.' }, cors);
    return;
  }

  let url;
  try {
    url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  } catch (err) {
    send(response, 400, { error: 'Malformed request URL.' }, cors);
    return;
  }

  if (url.pathname === '/api/health') {
    send(response, 200, {
      ok: true,
      live: isConfigured(),
      provider: isConfigured() ? 'amadeus' : 'sample',
      allowedOrigins: allowedOrigins(),
      ingested: summary(),
    }, cors);
    return;
  }

  if (url.pathname === '/api/flights' && request.method === 'GET') {
    const result = await handleFlights(url.searchParams);
    send(response, result.status, result.body, cors);
    return;
  }

  if (url.pathname === '/api/flights/search' && request.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(request);
    } catch (err) {
      send(response, 400, { error: err.message }, cors);
      return;
    }
    const result = await handleFlights(paramsFromBody(body));
    send(response, result.status, { success: result.status === 200, ...result.body }, cors);
    return;
  }

  if (url.pathname === '/api/flights/ingest' && request.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(request);
    } catch (err) {
      send(response, 400, { error: err.message }, cors);
      return;
    }
    const result = handleIngest(body);
    send(response, result.status, result.body, cors);
    return;
  }

  if (url.pathname === '/api/flights/ingested' && request.method === 'GET') {
    const offers = cachedFor({
      from: (url.searchParams.get('from') || '').toUpperCase(),
      to: (url.searchParams.get('to') || '').toUpperCase(),
      date: url.searchParams.get('date') || '',
      returnDate: url.searchParams.get('returnDate') || '',
    });
    send(response, 200, { ok: true, offers, summary: summary() }, cors);
    return;
  }

  send(response, 404, { error: `No route for ${url.pathname}` }, cors);
});

// Only bind a port when run as a program — the self-test imports this
// module for its validation and routing logic.
if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  server.listen(PORT, () => {
    const mode = isConfigured() ? 'live (amadeus)' : 'sample data (no credentials configured)';
    console.error(`TripAgent backend listening on http://localhost:${PORT} — ${mode}`);
    console.error(`CORS allowlist: ${allowedOrigins().join(', ')}`);
  });
}

export { server, validateFlightQuery, handleFlights, handleIngest, paramsFromBody };
