// Direct tests of the Worker's fetch handler: MCP protocol, both tools, the
// planner API, and the token gate. An in-memory map stands in for KV.
//
//   node mcp-server/test/worker.test.mjs

import worker from '../src/worker.js';

let passed = 0;
const failures = [];
const ok = (name, cond, detail) => { if (cond) passed += 1; else failures.push(`${name}${detail ? `\n    ${detail}` : ''}`); };

const TOKEN = 'test-token-0123456789abcdef';
function makeEnv(extra = {}) {
  const store = new Map();
  return {
    TRIP_TOKEN: TOKEN,
    TRIPS: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } },
    _store: store,
    ...extra,
  };
}

const BASE = 'https://trip.example.workers.dev';
async function rpc(env, method, params, id = 1) {
  const res = await worker.fetch(new Request(`${BASE}/mcp/${TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
  }), env);
  return { status: res.status, body: res.status === 202 ? null : await res.json() };
}
const callTool = (env, name, args) => rpc(env, 'tools/call', { name, arguments: args });
const text = (r) => r.body.result.content.map((c) => c.text).join('\n');

// ---- token gate ----
{
  const env = makeEnv();
  const res = await worker.fetch(new Request(`${BASE}/mcp/wrong-token-0123456789abc`, { method: 'POST', body: '{}' }), env);
  ok('a wrong token is a plain 404', res.status === 404);
  const noToken = await worker.fetch(new Request(`${BASE}/mcp`, { method: 'POST', body: '{}' }), env);
  ok('a missing token is a plain 404', noToken.status === 404);
  const unconfigured = await worker.fetch(new Request(`${BASE}/mcp/${TOKEN}`, { method: 'POST', body: '{}' }), makeEnv({ TRIP_TOKEN: 'short' }));
  ok('a missing/short TRIP_TOKEN refuses to run', unconfigured.status === 500);
}

// ---- protocol ----
{
  const env = makeEnv();
  const init = await rpc(env, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  ok('initialize echoes a supported protocol version', init.body.result.protocolVersion === '2025-06-18');
  ok('initialize advertises tools', !!init.body.result.capabilities.tools);
  ok('initialize carries usage instructions', /screenshot/.test(init.body.result.instructions));
  const future = await rpc(env, 'initialize', { protocolVersion: '2099-01-01' });
  ok('an unknown protocol version gets our latest', future.body.result.protocolVersion === '2025-11-25');

  const note = await worker.fetch(new Request(`${BASE}/mcp/${TOKEN}`, {
    method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  }), env);
  ok('a notification gets 202 with no body', note.status === 202);

  const list = await rpc(env, 'tools/list');
  const names = list.body.result.tools.map((t) => t.name);
  ok('tools/list offers add + list', JSON.stringify(names) === JSON.stringify(['add_trip_options', 'list_pending_options']), JSON.stringify(names));
  ok('the add tool has a strict schema', list.body.result.tools[0].inputSchema.additionalProperties === false);

  ok('ping answers', (await rpc(env, 'ping')).body.result !== undefined);
  ok('an unknown method is -32601', (await rpc(env, 'nope')).body.error.code === -32601);
  ok('an unknown tool is -32602', (await callTool(env, 'nope', {})).body.error.code === -32602);

  const get = await worker.fetch(new Request(`${BASE}/mcp/${TOKEN}`, { method: 'GET' }), env);
  ok('GET on the MCP endpoint is 405 (no server stream)', get.status === 405);
  const bad = await worker.fetch(new Request(`${BASE}/mcp/${TOKEN}`, { method: 'POST', body: '{not json' }), env);
  ok('malformed JSON is a -32700 parse error', bad.status === 400 && (await bad.json()).error.code === -32700);

  const batch = await worker.fetch(new Request(`${BASE}/mcp/${TOKEN}`, {
    method: 'POST',
    body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]),
  }), env);
  const batchBody = await batch.json();
  ok('a batch answers each request and skips notifications', Array.isArray(batchBody) && batchBody.length === 2);
}

// ---- add_trip_options ----
{
  const env = makeEnv();
  const added = await callTool(env, 'add_trip_options', {
    source: 'Capital One Travel',
    window: '21-24 Oct',
    options: [
      { kind: 'flight', from: 'NYC', to: 'PAR', departure: '18:30', arrival: '07:45', carrier: 'Air France', stops: 0, price: 612, currency: 'USD' },
      { kind: 'hotel', place: 'Paris', name: 'Le Marais Boutique', price: 280, currency: 'USD', per_night: true, nights: 3, note: 'Amex FHR' },
      { kind: 'flight', from: 'NYC', to: 'PAR', departure: '22:10', arrival: '11:30', note: '45,000 points' },
      { kind: 'activity', name: 'Louvre late opening' },
      { kind: 'flight', from: 'NYC', to: 'PAR', price: 500 },
    ],
  });
  const msg = text(added);
  ok('valid options are recorded', /Recorded 4 options/.test(msg), msg);
  ok('a price with no currency is refused, not guessed', /#5: price given without a currency/.test(msg), msg);
  ok('a partial success is not an error result', !added.body.result.isError);

  const stored = JSON.parse(env._store.get(`pending:${TOKEN}`));
  ok('four options are stored as pending', stored.length === 4, String(stored.length));
  const flight = stored.find((o) => o.carrier === 'Air France');
  ok('the flight keeps its route as the group', flight && flight.group === 'NYC → PAR');
  ok('the flight keeps its dollar price', flight && flight.price.currency === 'USD' && flight.price.low === 612);
  ok('the window label is applied', stored.every((o) => o.window === '21-24 Oct'));
  ok('the source names Claude and the portal', flight && flight.source === 'claude · Capital One Travel', flight && flight.source);
  const hotel = stored.find((o) => o.category === 'stay');
  ok('the hotel groups under its city, not its name', hotel && hotel.group === 'Paris' && hotel.label === 'Le Marais Boutique');
  ok('a per-night price keeps its nights', hotel && hotel.perNight && hotel.nights === 3);
  const points = stored.find((o) => o.departure === '22:10');
  ok('a points-only fare has no cash price', points && points.price === null && /points/.test(points.detail));
  ok('a free activity is accepted by name', stored.some((o) => o.category === 'activity' && o.label === 'Louvre late opening'));

  const again = await callTool(env, 'add_trip_options', { window: '21-24 Oct', options: [{ kind: 'flight', from: 'NYC', to: 'PAR', departure: '18:30', arrival: '07:45', carrier: 'Air France', stops: 0, price: 612, currency: 'USD' }] });
  ok('re-recording the same option does not duplicate it', JSON.parse(env._store.get(`pending:${TOKEN}`)).length === 4, text(again));

  const allBad = await callTool(env, 'add_trip_options', { options: [{ kind: 'flight', price: 1 }] });
  ok('nothing valid is an error result', allBad.body.result.isError === true);
  const empty = await callTool(env, 'add_trip_options', { options: [] });
  ok('no options is an error result', empty.body.result.isError === true);

  const listed = text(await callTool(env, 'list_pending_options', {}));
  ok('list shows what is waiting', /4 options waiting/.test(listed) && /Air France/.test(listed), listed);
}

// ---- planner API ----
{
  const env = makeEnv();
  await callTool(env, 'add_trip_options', { options: [
    { kind: 'flight', from: 'NYC', to: 'PAR', price: 612, currency: 'USD' },
    { kind: 'hotel', place: 'Paris', name: 'Hotel A', price: 200, currency: 'EUR' },
  ] });
  const origin = 'https://bgra1123.github.io';
  const pre = await worker.fetch(new Request(`${BASE}/api/${TOKEN}/pending`, { method: 'OPTIONS', headers: { Origin: origin } }), env);
  ok('preflight from the planner origin is allowed', pre.status === 204 && pre.headers.get('Access-Control-Allow-Origin') === origin);
  const foreign = await worker.fetch(new Request(`${BASE}/api/${TOKEN}/pending`, { headers: { Origin: 'https://evil.example' } }), env);
  ok('a foreign origin gets no CORS grant', !foreign.headers.get('Access-Control-Allow-Origin'));

  const pending = await (await worker.fetch(new Request(`${BASE}/api/${TOKEN}/pending`, { headers: { Origin: origin } }), env)).json();
  ok('the planner can read pending options', pending.offers.length === 2);
  const ack = await (await worker.fetch(new Request(`${BASE}/api/${TOKEN}/ack`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [pending.offers[0].id] }),
  }), env)).json();
  ok('ack removes exactly the acknowledged option', ack.removed === 1 && ack.remaining === 1, JSON.stringify(ack));
  const badAck = await worker.fetch(new Request(`${BASE}/api/${TOKEN}/ack`, { method: 'POST', body: 'nope' }), env);
  ok('a malformed ack is a 400, not a crash', badAck.status === 400);
}

if (failures.length) {
  console.error(`\n✗ ${failures.length} failed, ${passed} passed\n`);
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  process.exit(1);
}
console.error(`✓ ${passed} worker checks passed`);
