// TripAgent MCP connector — a Cloudflare Worker.
//
// Lets Claude (in the Claude app, any device) record travel options straight
// into the trip planner: share a screenshot of a card portal's results with
// Claude, Claude reads it and calls `add_trip_options`, and the options wait
// here until the planner pulls them into its review list. Nothing reaches the
// plan itself until the user taps Add there, same as every other capture.
//
// Why a server at all: the planner keeps the trip in the browser's own
// storage, which nothing outside that browser can write to. This is the
// smallest shared place both sides can reach.
//
// Routes (TOKEN is the TRIP_TOKEN secret — the whole URL is the credential):
//   POST /mcp/TOKEN           MCP, Streamable HTTP transport (stateless JSON)
//   GET  /api/TOKEN/pending   planner: options waiting for review
//   POST /api/TOKEN/ack       planner: { ids } added or dismissed — forget them
//
// Every option goes through the planner's own normalizeOffers(), so what Claude
// sends is validated by exactly the code that will display it.

import { normalizeOffers, mergeOffers, offerCostText } from '../../src/utils/tripAgentOffers.js';

const SERVER_INFO = { name: 'trip-planner', version: '1.0.0' };
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_PENDING = 200;
const MAX_BODY_BYTES = 256 * 1024;
const DEFAULT_ORIGINS = ['https://bgra1123.github.io', 'http://localhost:3000', 'http://127.0.0.1:3000'];

const INSTRUCTIONS = `This server records travel options (flights, trains, buses, ferries, hotels, activities) into the user's trip planner. Typical use: the user shares a screenshot of search results from a booking site or a credit-card travel portal; read every option visible in it and record them with add_trip_options. Only record what is actually shown — never estimate or invent a price, time, or airline. Options land in a review list in the planner; the user adds them to the plan there.`;

const OPTION_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['flight', 'train', 'bus', 'ferry', 'hotel', 'activity'] },
    from: { type: 'string', description: 'Origin city or airport code (travel only), e.g. "NYC" or "JFK".' },
    to: { type: 'string', description: 'Destination city or airport code (travel only).' },
    place: { type: 'string', description: 'City a hotel is in, e.g. "Paris" (hotels only). Hotels with the same place are compared as alternatives.' },
    name: { type: 'string', description: 'Hotel name, activity name, or a short label for the option.' },
    departure: { type: 'string', description: 'Departure time as shown, 24h HH:MM preferred (travel only).' },
    arrival: { type: 'string', description: 'Arrival time as shown, 24h HH:MM preferred (travel only).' },
    carrier: { type: 'string', description: 'Airline or operator, if shown.' },
    stops: { type: 'integer', minimum: 0, description: 'Number of stops, if shown (0 = nonstop).' },
    price: { type: 'number', description: 'Cash price exactly as shown. Omit entirely if no cash price is visible — never estimate one.' },
    currency: { type: 'string', description: 'ISO 4217 code of that price, e.g. "USD", "EUR". Required whenever price is given.' },
    per_night: { type: 'boolean', description: 'True if the hotel price is per night rather than for the whole stay.' },
    nights: { type: 'integer', minimum: 1, description: 'Number of nights, for a per-night hotel price.' },
    note: { type: 'string', description: 'Anything else worth keeping: a points/miles price ("45,000 points" — never put points in price), card program ("Amex FHR"), refundability, cabin.' },
  },
  required: ['kind'],
  additionalProperties: false,
};

const TOOLS = [
  {
    name: 'add_trip_options',
    title: 'Add trip options',
    description: 'Record travel options the user found — usually read from a screenshot of search results on a booking site or card travel portal — into their trip planner for review. Include every option visible, one entry each. Copy prices exactly as shown with their currency; if a price is only in points or miles, leave price out and put the points in note. Do not invent or estimate anything that is not visible.',
    inputSchema: {
      type: 'object',
      properties: {
        options: { type: 'array', minItems: 1, maxItems: 50, items: OPTION_SCHEMA },
        window: { type: 'string', description: 'Optional date-range label like "21-24 Oct". Options with the same label are only compared with each other.' },
        source: { type: 'string', description: 'Where the prices came from, e.g. "Capital One Travel".' },
      },
      required: ['options'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'list_pending_options',
    title: 'List options waiting for review',
    description: 'List the options recorded so far that the user has not yet added or dismissed in the planner.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

// ---- storage -------------------------------------------------------------

const pendingKey = (token) => `pending:${token}`;

async function readPending(env, token) {
  const raw = await env.TRIPS.get(pendingKey(token));
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writePending(env, token, list) {
  return env.TRIPS.put(pendingKey(token), JSON.stringify(list.slice(0, MAX_PENDING)));
}

// ---- tools -----------------------------------------------------------------

// Tool input -> the raw offer shape normalizeOffers() reads. A price with no
// currency is refused rather than defaulted: a "320" assumed to be euros
// would be wrong by the exchange rate, silently.
function toRawOffer(option, args) {
  const problems = [];
  if (option.price !== undefined && option.price !== null && !option.currency) {
    problems.push('price given without a currency');
  }
  const raw = {
    kind: option.kind,
    from: option.from,
    to: option.to,
    // An activity is identified by its name — a free one has no price, and
    // the validator needs one or the other.
    place: option.kind === 'activity' ? (option.place || option.name) : option.place,
    label: option.name,
    departure: option.departure,
    arrival: option.arrival,
    carrier: option.carrier,
    stops: option.stops,
    price: option.price !== undefined && option.price !== null && option.currency
      ? { amount: option.price, currency: option.currency }
      : undefined,
    perNight: option.per_night,
    nights: option.nights,
    detail: option.note,
    window: args.window,
  };
  return { raw, problems };
}

function describeOffer(offer) {
  const where = offer.group || offer.label || offer.kind;
  const when = offer.departure ? ` ${offer.departure}${offer.arrival ? `-${offer.arrival}` : ''}` : '';
  const what = offer.category === 'stay' && offer.label && offer.label !== offer.group ? ` ${offer.label}`
    : (offer.carrier ? ` ${offer.carrier}` : '');
  const price = offerCostText(offer) || (offer.price ? `${offer.price.currency} ${offer.price.low}` : 'no cash price');
  return `- ${offer.kind}: ${where}${what}${when}, ${price}${offer.detail ? ` (${offer.detail})` : ''}`;
}

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

async function addTripOptions(args, env, token) {
  const options = Array.isArray(args && args.options) ? args.options : [];
  if (!options.length) return textResult('No options given — pass at least one entry in "options".', true);

  const accepted = [];
  const rejected = [];
  options.forEach((option, i) => {
    const { raw, problems } = toRawOffer(option || {}, args || {});
    if (problems.length) { rejected.push(`#${i + 1}: ${problems.join(', ')}`); return; }
    const [offer] = normalizeOffers([raw], { source: args.source ? `claude · ${args.source}` : 'claude' });
    if (!offer) { rejected.push(`#${i + 1}: needs a route or place, or a price`); return; }
    accepted.push(offer);
  });

  if (accepted.length) {
    const pending = await readPending(env, token);
    await writePending(env, token, mergeOffers(pending, accepted, MAX_PENDING));
  }

  const lines = [];
  if (accepted.length) {
    lines.push(`Recorded ${accepted.length} option${accepted.length === 1 ? '' : 's'} for review in the trip planner:`);
    accepted.forEach((o) => lines.push(describeOffer(o)));
    lines.push('They appear in the planner\'s TripAgent capture panel the next time it is opened; nothing is added to the plan until the user taps Add.');
  }
  if (rejected.length) {
    lines.push(`Not recorded (${rejected.length}): ${rejected.join('; ')}. Fix these and call add_trip_options again for just those.`);
  }
  return textResult(lines.join('\n'), !accepted.length);
}

async function listPendingOptions(env, token) {
  const pending = await readPending(env, token);
  if (!pending.length) return textResult('Nothing is waiting for review — every recorded option has been added or dismissed in the planner.');
  return textResult([`${pending.length} option${pending.length === 1 ? '' : 's'} waiting for review in the planner:`, ...pending.map(describeOffer)].join('\n'));
}

async function callTool(name, args, env, token) {
  if (name === 'add_trip_options') return addTripOptions(args || {}, env, token);
  if (name === 'list_pending_options') return listPendingOptions(env, token);
  return null;
}

// ---- MCP (JSON-RPC over Streamable HTTP, stateless JSON responses) ---------

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } });

async function handleRpc(msg, env, token) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(msg && msg.id, -32600, 'Invalid Request');
  }
  const isNotification = msg.id === undefined || msg.id === null;
  if (isNotification) return null;

  switch (msg.method) {
    case 'initialize': {
      const requested = msg.params && msg.params.protocolVersion;
      return rpcResult(msg.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, { tools: TOOLS });
    case 'tools/call': {
      const params = msg.params || {};
      try {
        const result = await callTool(params.name, params.arguments, env, token);
        if (!result) return rpcError(msg.id, -32602, `Unknown tool: ${params.name}`);
        return rpcResult(msg.id, result);
      } catch (err) {
        return rpcResult(msg.id, textResult(`The trip planner could not record that: ${err.message}`, true));
      }
    }
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

async function handleMcp(request, env, token) {
  if (request.method !== 'POST') {
    // No server-initiated stream (GET) and no sessions to end (DELETE).
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
  }
  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json(rpcError(null, -32600, 'Request too large'), 413);
    body = JSON.parse(text);
  } catch {
    return json(rpcError(null, -32700, 'Parse error'), 400);
  }
  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map((m) => handleRpc(m, env, token)))).filter(Boolean);
    return replies.length ? json(replies) : new Response(null, { status: 202 });
  }
  const reply = await handleRpc(body, env, token);
  return reply ? json(reply) : new Response(null, { status: 202 });
}

// ---- planner API ---------------------------------------------------------

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()) : DEFAULT_ORIGINS;
  return origin && allowed.includes(origin) ? origin : null;
}

function corsHeaders(origin) {
  return origin
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
    : { Vary: 'Origin' };
}

async function handleApi(request, env, token, action) {
  const cors = corsHeaders(allowedOrigin(request, env));
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (action === 'pending' && request.method === 'GET') {
    return json({ offers: await readPending(env, token) }, 200, cors);
  }
  if (action === 'ack' && request.method === 'POST') {
    let ids = [];
    try {
      const body = await request.json();
      ids = Array.isArray(body && body.ids) ? body.ids.map(String) : [];
    } catch {
      return json({ error: 'Body must be JSON: { "ids": [...] }' }, 400, cors);
    }
    const drop = new Set(ids);
    const pending = await readPending(env, token);
    const remaining = pending.filter((o) => !drop.has(o.id));
    if (remaining.length !== pending.length) await writePending(env, token, remaining);
    return json({ ok: true, removed: pending.length - remaining.length, remaining: remaining.length }, 200, cors);
  }
  return json({ error: 'Not found' }, 404, cors);
}

// ---- entry ---------------------------------------------------------------

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
}

// Constant-time compare, so the token can't be guessed byte by byte from timing.
function sameToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    if (!env.TRIP_TOKEN || env.TRIP_TOKEN.length < 16) {
      return json({ error: 'Server not configured: set a TRIP_TOKEN secret of at least 16 characters.' }, 500);
    }
    const parts = new URL(request.url).pathname.split('/').filter(Boolean);
    const [kind, token, action] = parts;
    // A wrong token looks exactly like a wrong path.
    if (!token || !sameToken(token, env.TRIP_TOKEN)) return json({ error: 'Not found' }, 404);
    if (kind === 'mcp' && parts.length === 2) return handleMcp(request, env, token);
    if (kind === 'api' && parts.length === 3) return handleApi(request, env, token, action);
    return json({ error: 'Not found' }, 404);
  },
};
