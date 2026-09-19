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
//   GET /api/health
//   GET /api/flights?from=IST&to=MUC&date=2026-08-14[&returnDate=][&adults=1][&currency=EUR]

import { createServer } from 'node:http';
import { argv } from 'node:process';
import { pathToFileURL } from 'node:url';
import { isConfigured, searchFlights } from './amadeus.mjs';
import { sampleFlights } from './sample.mjs';

const PORT = Number(process.env.PORT || 8787);
const DEFAULT_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

function allowedOrigins() {
  if (!process.env.ALLOWED_ORIGINS) return DEFAULT_ORIGINS;
  return process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
}

// Echo back only origins on the allowlist. A wildcard would let any page
// the user visits drive this server — and with credentials configured,
// spend their API quota.
function corsHeaders(request) {
  const origin = request.headers.origin;
  const headers = { Vary: 'Origin' };
  if (origin && allowedOrigins().includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Accept, Content-Type';
    headers['Access-Control-Max-Age'] = '600';
  }
  return headers;
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

  if (!isConfigured()) {
    return {
      status: 200,
      body: {
        live: false,
        provider: 'sample',
        query,
        offers: sampleFlights(query),
        note: 'No AMADEUS_CLIENT_ID/AMADEUS_CLIENT_SECRET configured — returning sample data.',
      },
    };
  }

  try {
    const offers = await searchFlights(query);
    return { status: 200, body: { live: true, provider: 'amadeus', query, offers } };
  } catch (err) {
    // Surface the provider's own message: a 400 from a bad IATA code and a
    // 401 from stale credentials need very different fixes.
    return { status: 502, body: { error: err.message, provider: 'amadeus', live: false, query, offers: [] } };
  }
}

const server = createServer(async (request, response) => {
  const cors = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors);
    response.end();
    return;
  }
  if (request.method !== 'GET') {
    send(response, 405, { error: 'Only GET is supported.' }, cors);
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
    }, cors);
    return;
  }

  if (url.pathname === '/api/flights') {
    const result = await handleFlights(url.searchParams);
    send(response, result.status, result.body, cors);
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

export { server, validateFlightQuery, handleFlights };
