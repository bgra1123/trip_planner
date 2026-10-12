// Direct tests of the Worker's fetch handler: MCP protocol, all tools, the
// planner's trips API, and the token gate. An in-memory map stands in for KV
// (with metadata and prefix listing, like the real thing).
//
//   node mcp-server/test/worker.test.mjs

import worker from '../src/worker.js';
import { normalizeOffers, offersToRows } from '../../src/utils/tripAgentOffers.js';

let passed = 0;
const failures = [];
const ok = (name, cond, detail) => { if (cond) passed += 1; else failures.push(`${name}${detail ? `\n    ${detail}` : ''}`); };

const TOKEN = 'test-token-0123456789abcdef';
function makeEnv(extra = {}) {
  const store = new Map();
  const meta = new Map();
  return {
    TRIP_TOKEN: TOKEN,
    TRIPS: {
      get: async (k) => store.get(k) ?? null,
      put: async (k, v, opts) => { store.set(k, v); if (opts && opts.metadata) meta.set(k, opts.metadata); else meta.delete(k); },
      delete: async (k) => { store.delete(k); meta.delete(k); },
      list: async ({ prefix = '' } = {}) => ({
        keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: meta.get(name) })),
        list_complete: true,
      }),
    },
    _store: store,
    ...extra,
  };
}

const BASE = 'https://trip.example.workers.dev';
const ORIGIN = 'https://bgra1123.github.io';
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
const api = (env, method, path, body) => worker.fetch(new Request(`${BASE}/api/${TOKEN}${path}`, {
  method, headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
}), env);
const pendingOf = (env, id) => JSON.parse(env._store.get(`pend:${TOKEN}:${id}`) || '[]');
const idOf = (msg) => (msg.match(/\[([^\]]+)\]/) || [])[1];

// A planner snapshot built from real normalized offers, as the planner would save it.
function snapshotFrom(rawOffers, extra = {}) {
  const rows = offersToRows(normalizeOffers(rawOffers, { source: 'test' }));
  return { version: 1, notesText: '', rows, notes: [], rateRows: [{ code: 'USD', factor: '0.9' }], selection: { travel: {}, stay: {}, activity: {} }, activeWindow: '', ...extra };
}
const PLAN = [
  { kind: 'flight', from: 'NYC', to: 'PAR', departure: '18:30', arrival: '07:45', carrier: 'Air France', price: { amount: 612, currency: 'USD' } },
  { kind: 'flight', from: 'NYC', to: 'PAR', departure: '22:10', arrival: '11:30', carrier: 'Delta', price: { amount: 548, currency: 'USD' } },
  { kind: 'flight', from: 'PAR', to: 'NYC', departure: '10:00', arrival: '12:30', carrier: 'Delta', price: { amount: 400, currency: 'USD' } },
  { kind: 'hotel', place: 'Paris', label: 'Hotel A', price: { amount: 200, currency: 'USD' } },
  { kind: 'hotel', place: 'Paris', label: 'Hotel B', price: { amount: 340, currency: 'USD' } },
];

// ---- token gate ----
{
  const env = makeEnv();
  const res = await worker.fetch(new Request(`${BASE}/mcp/wrong-token-0123456789abc`, { method: 'POST', body: '{}' }), env);
  ok('a wrong token is a plain 404', res.status === 404);
  const noToken = await worker.fetch(new Request(`${BASE}/mcp`, { method: 'POST', body: '{}' }), env);
  ok('a missing token is a plain 404', noToken.status === 404);
  const apiWrong = await worker.fetch(new Request(`${BASE}/api/wrong-token-0123456789abc/trips`), env);
  ok('the trips API is behind the same token', apiWrong.status === 404);
  const unconfigured = await worker.fetch(new Request(`${BASE}/mcp/${TOKEN}`, { method: 'POST', body: '{}' }), makeEnv({ TRIP_TOKEN: 'short' }));
  ok('a missing/short TRIP_TOKEN refuses to run', unconfigured.status === 500);
}

// ---- protocol ----
{
  const env = makeEnv();
  const init = await rpc(env, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  ok('initialize echoes a supported protocol version', init.body.result.protocolVersion === '2025-06-18');
  ok('initialize names the server TripAgent', init.body.result.serverInfo.name === 'tripagent');
  ok('initialize carries usage instructions', /screenshot/.test(init.body.result.instructions));
  const future = await rpc(env, 'initialize', { protocolVersion: '2099-01-01' });
  ok('an unknown protocol version gets our latest', future.body.result.protocolVersion === '2025-11-25');
  const note = await worker.fetch(new Request(`${BASE}/mcp/${TOKEN}`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }), env);
  ok('a notification gets 202 with no body', note.status === 202);

  const list = await rpc(env, 'tools/list');
  const names = list.body.result.tools.map((t) => t.name).sort().join(',');
  ok('tools/list offers all eight tools', names === 'add_trip_options,create_trip,get_trip_path,list_pending_options,list_trips,optimize_trip,remove_trip_option,update_trip_option', names);
  ok('every tool has a strict schema', list.body.result.tools.every((t) => t.inputSchema.additionalProperties === false));
  ok('ping answers', (await rpc(env, 'ping')).body.result !== undefined);
  ok('an unknown method is -32601', (await rpc(env, 'nope')).body.error.code === -32601);
  ok('an unknown tool is -32602', (await callTool(env, 'nope', {})).body.error.code === -32602);
  const get = await worker.fetch(new Request(`${BASE}/mcp/${TOKEN}`, { method: 'GET' }), env);
  ok('GET on the MCP endpoint is 405', get.status === 405);
  const bad = await worker.fetch(new Request(`${BASE}/mcp/${TOKEN}`, { method: 'POST', body: '{not json' }), env);
  ok('malformed JSON is a -32700 parse error', bad.status === 400 && (await bad.json()).error.code === -32700);
}

// ---- trips: create, list, ambiguity ----
{
  const env = makeEnv();
  ok('with no trips, list_trips says so', /No trips yet/.test(text(await callTool(env, 'list_trips', {}))));
  const noTrip = await callTool(env, 'add_trip_options', { options: [{ kind: 'flight', from: 'NYC', to: 'PAR', price: 1, currency: 'USD' }] });
  ok('recording with no trip is an error that points to create_trip', noTrip.body.result.isError && /create_trip/.test(text(noTrip)), text(noTrip));

  const created = text(await callTool(env, 'create_trip', { title: 'Paris in October' }));
  const id1 = (created.match(/trip (t[\w-]+)/) || [])[1];
  ok('create_trip returns an id', !!id1 && /Paris in October/.test(created), created);
  ok('list_trips shows the new trip', new RegExp(id1).test(text(await callTool(env, 'list_trips', {}))));

  // With exactly one trip, tripId is optional.
  const auto = await callTool(env, 'add_trip_options', { options: [{ kind: 'flight', from: 'NYC', to: 'PAR', price: 612, currency: 'USD' }] });
  ok('one trip is used automatically', /Recorded 1 option/.test(text(auto)) && pendingOf(env, id1).length === 1, text(auto));

  const id2 = (text(await callTool(env, 'create_trip', { title: 'Rome' })).match(/trip (t[\w-]+)/) || [])[1];
  ok('a second trip gets a different id', id2 && id2 !== id1);
  const ambiguous = await callTool(env, 'add_trip_options', { options: [{ kind: 'flight', from: 'NYC', to: 'ROM', price: 1, currency: 'USD' }] });
  ok('several trips and no tripId makes Claude ask', ambiguous.body.result.isError && /ask which one/.test(text(ambiguous)) && text(ambiguous).includes(id1) && text(ambiguous).includes(id2), text(ambiguous));
  ok('nothing was recorded on the ambiguous call', pendingOf(env, id1).length === 1 && pendingOf(env, id2).length === 0);
  const explicit = await callTool(env, 'add_trip_options', { tripId: id2, options: [{ kind: 'flight', from: 'NYC', to: 'ROM', price: 1, currency: 'USD' }] });
  ok('an explicit tripId targets that trip', pendingOf(env, id2).length === 1, text(explicit));
  const missing = await callTool(env, 'list_pending_options', { tripId: 'doesnotexist1' });
  ok('an unknown trip id is an error', missing.body.result.isError && /No trip with id/.test(text(missing)));
  const junk = await callTool(env, 'list_pending_options', { tripId: '../etc' });
  ok('a malformed trip id is refused', junk.body.result.isError);
}

// ---- add / update / remove ----
{
  const env = makeEnv();
  const id = (text(await callTool(env, 'create_trip', { title: 'T' })).match(/trip (t[\w-]+)/) || [])[1];
  const added = await callTool(env, 'add_trip_options', {
    source: 'Capital One Travel', window: '21-24 Oct',
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
  const stored = pendingOf(env, id);
  const flight = stored.find((o) => o.carrier === 'Air France');
  ok('the flight keeps route, dollars, window and source', flight && flight.group === 'NYC → PAR' && flight.price.currency === 'USD' && flight.price.low === 612 && flight.window === '21-24 Oct' && flight.source === 'claude · Capital One Travel');
  const hotel = stored.find((o) => o.category === 'stay');
  ok('the hotel groups under its city', hotel && hotel.group === 'Paris' && hotel.label === 'Le Marais Boutique' && hotel.perNight && hotel.nights === 3);
  ok('a points-only fare has no cash price', stored.find((o) => o.departure === '22:10').price === null);
  const again = await callTool(env, 'add_trip_options', { window: '21-24 Oct', options: [{ kind: 'flight', from: 'NYC', to: 'PAR', departure: '18:30', arrival: '07:45', carrier: 'Air France', stops: 0, price: 612, currency: 'USD' }] });
  ok('re-recording the same option does not duplicate it', pendingOf(env, id).length === 4, text(again));
  ok('nothing valid is an error result', (await callTool(env, 'add_trip_options', { options: [{ kind: 'flight', price: 1 }] })).body.result.isError === true);
  ok('no options is an error result', (await callTool(env, 'add_trip_options', { options: [] })).body.result.isError === true);

  // Spoken correction: "the Air France flight is actually $640, departs 19:00".
  const listed = text(await callTool(env, 'list_pending_options', {}));
  ok('list shows ids and what is waiting', /4 options waiting/.test(listed) && /Air France/.test(listed), listed);
  const afId = stored.find((o) => o.carrier === 'Air France').id;
  ok('the id in the list matches storage', listed.includes(`[${afId}]`));
  const upd = await callTool(env, 'update_trip_option', { optionId: afId, changes: { price: 640, departure: '19:00' } });
  const updMsg = text(upd);
  ok('an update succeeds', !upd.body.result.isError && /Updated/.test(updMsg), updMsg);
  const after = pendingOf(env, id);
  const af2 = after.find((o) => o.carrier === 'Air France');
  ok('price and time changed; currency, route, window kept', af2 && af2.price.low === 640 && af2.price.currency === 'USD' && af2.departure === '19:00' && af2.arrival === '07:45' && af2.group === 'NYC → PAR' && af2.window === '21-24 Oct', JSON.stringify(af2));
  ok('an update replaces, not duplicates', after.length === 4);
  ok('the old id is gone and a new one is reported', !after.some((o) => o.id === afId) && updMsg.includes(`[${af2.id}]`));
  const stale = await callTool(env, 'update_trip_option', { optionId: afId, changes: { price: 1 } });
  ok('updating a stale id is an error, not a silent no-op', stale.body.result.isError && /No option/.test(text(stale)));
  const noCur = await callTool(env, 'update_trip_option', { optionId: af2.id, changes: { currency: 'EUR' } });
  ok('changing only the currency works', !noCur.body.result.isError && pendingOf(env, id).some((o) => o.carrier === 'Air France' && o.price.currency === 'EUR' && o.price.low === 640), text(noCur));
  const pointsOpt = pendingOf(env, id).find((o) => o.departure === '22:10');
  const addPrice = await callTool(env, 'update_trip_option', { optionId: pointsOpt.id, changes: { price: 700 } });
  ok('a price for an option with none needs a currency', addPrice.body.result.isError && /currency/.test(text(addPrice)), text(addPrice));
  const addPrice2 = await callTool(env, 'update_trip_option', { optionId: pointsOpt.id, changes: { price: 700, currency: 'USD' } });
  ok('…and works once given one', !addPrice2.body.result.isError && pendingOf(env, id).some((o) => o.departure === '22:10' && o.price && o.price.low === 700), text(addPrice2));
  ok('empty changes are rejected', (await callTool(env, 'update_trip_option', { optionId: af2.id, changes: {} })).body.result.isError);

  const cur = pendingOf(env, id);
  const hotelId = cur.find((o) => o.category === 'stay').id;
  const rm = await callTool(env, 'remove_trip_option', { optionId: hotelId });
  ok('remove drops exactly that option', !rm.body.result.isError && pendingOf(env, id).length === cur.length - 1 && !pendingOf(env, id).some((o) => o.id === hotelId), text(rm));
  ok('removing it twice is an error', (await callTool(env, 'remove_trip_option', { optionId: hotelId })).body.result.isError);
}

// ---- planner API: sync, pending, ack ----
{
  const env = makeEnv();
  const pre = await worker.fetch(new Request(`${BASE}/api/${TOKEN}/trips/abcdef12`, { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env);
  ok('preflight from the planner origin allows PUT and DELETE', pre.status === 204 && pre.headers.get('Access-Control-Allow-Origin') === ORIGIN && /PUT/.test(pre.headers.get('Access-Control-Allow-Methods')) && /DELETE/.test(pre.headers.get('Access-Control-Allow-Methods')));
  const foreign = await worker.fetch(new Request(`${BASE}/api/${TOKEN}/trips`, { headers: { Origin: 'https://evil.example' } }), env);
  ok('a foreign origin gets no CORS grant', !foreign.headers.get('Access-Control-Allow-Origin'));

  ok('no trips yet', (await (await api(env, 'GET', '/trips')).json()).trips.length === 0);
  const put = await api(env, 'PUT', '/trips/plannerTrip1', { title: 'Paris', snapshot: snapshotFrom(PLAN), updatedAt: 1000 });
  ok('the planner can save a trip', put.status === 200 && (await put.json()).updatedAt === 1000);
  const trips = (await (await api(env, 'GET', '/trips')).json()).trips;
  ok('the list carries title, route and counts', trips.length === 1 && trips[0].id === 'plannerTrip1' && trips[0].title === 'Paris' && trips[0].itemCount === 5 && /NYC.*PAR/.test(trips[0].route), JSON.stringify(trips));
  const got = await (await api(env, 'GET', '/trips/plannerTrip1')).json();
  ok('the snapshot round-trips', got.snapshot.rows.length === 5 && got.title === 'Paris');
  ok('a missing trip is 404', (await api(env, 'GET', '/trips/nosuchtrip1')).status === 404);
  ok('a bad snapshot is a 400', (await api(env, 'PUT', '/trips/plannerTrip2', { title: 'x', snapshot: { rows: 'no' } })).status === 400);
  ok('a malformed trip id is a 404', (await api(env, 'GET', '/trips/..%2Fx')).status === 404);
  ok('an oversize trip is a 413', (await api(env, 'PUT', '/trips/plannerTrip2', { title: 'x', snapshot: { rows: [], pad: 'x'.repeat(600 * 1024) } })).status === 413);

  // Claude sees the planner's trip and records into it.
  ok('Claude sees the trip the planner saved', /plannerTrip1/.test(text(await callTool(env, 'list_trips', {}))));
  await callTool(env, 'add_trip_options', { options: [
    { kind: 'flight', from: 'NYC', to: 'PAR', departure: '23:00', price: 700, currency: 'USD' },
    { kind: 'hotel', place: 'Paris', name: 'Hotel C', price: 250, currency: 'EUR' },
  ] });
  const pend = await (await api(env, 'GET', '/trips/plannerTrip1/pending')).json();
  ok('the planner reads what Claude recorded', pend.offers.length === 2);
  ok('pending for an unknown trip is 404', (await api(env, 'GET', '/trips/nosuchtrip1/pending')).status === 404);
  const ack = await (await api(env, 'POST', '/trips/plannerTrip1/ack', { ids: [pend.offers[0].id] })).json();
  ok('ack removes exactly the acknowledged option', ack.removed === 1 && ack.remaining === 1, JSON.stringify(ack));
  ok('a malformed ack is a 400', (await worker.fetch(new Request(`${BASE}/api/${TOKEN}/trips/plannerTrip1/ack`, { method: 'POST', body: 'nope' }), env)).status === 400);

  // The planner's resync must not touch Claude's pending list.
  await api(env, 'PUT', '/trips/plannerTrip1', { title: 'Paris 2', snapshot: snapshotFrom(PLAN) });
  ok('resyncing the plan leaves pending options alone', pendingOf(env, 'plannerTrip1').length === 1);
  ok('resync can rename', (await (await api(env, 'GET', '/trips/plannerTrip1')).json()).title === 'Paris 2');

  ok('the old single-list routes are gone', (await api(env, 'GET', '/pending')).status === 404);

  const del = await api(env, 'DELETE', '/trips/plannerTrip1');
  ok('the planner can delete a trip', del.status === 200 && (await (await api(env, 'GET', '/trips')).json()).trips.length === 0);
  ok('deleting a trip drops its pending options too', pendingOf(env, 'plannerTrip1').length === 0);
}

// ---- trip path and optimize ----
{
  const env = makeEnv();
  await api(env, 'PUT', '/trips/pathTrip01', { title: 'Paris', snapshot: snapshotFrom(PLAN) });
  const path = text(await callTool(env, 'get_trip_path', {}));
  ok('the path shows the route and picked options', /NYC → PAR/.test(path) && /PAR → NYC/.test(path) && /Stay Paris/.test(path), path);
  ok('the path totals the picks', /Total of the picked options/.test(path) && /\$|€/.test(path), path);
  ok('the path lists the alternatives', /other options/.test(path), path);
  const opt = text(await callTool(env, 'optimize_trip', { limit: 3 }));
  ok('optimize ranks combinations cheapest first', /valid combinations?/.test(opt) && /^1\./m.test(opt), opt);
  const cheapest = (opt.match(/^1\.[^\n]*/m) || [''])[0];
  ok('the cheapest pairs the Delta flight with Hotel A', /Delta/.test(cheapest) && /Hotel A/.test(cheapest), cheapest);
  ok('limit is respected', (opt.match(/^\d+\./gm) || []).length <= 3);

  await api(env, 'PUT', '/trips/emptyTrip01', { title: 'Empty', snapshot: snapshotFrom([]) });
  const empty = await callTool(env, 'get_trip_path', { tripId: 'emptyTrip01' });
  ok('an empty plan is explained, not an error', !empty.body.result.isError && /nothing in its plan/.test(text(empty)), text(empty));
  const created = text(await callTool(env, 'create_trip', { title: 'Fresh' }));
  const freshId = (created.match(/trip (t[\w-]+)/) || [])[1];
  ok('a Claude-created trip (no snapshot yet) is explained too', /nothing in its plan/.test(text(await callTool(env, 'optimize_trip', { tripId: freshId }))));
  const synced = await (await api(env, 'GET', `/trips/${freshId}`)).json();
  ok('the planner can fetch a trip Claude created', synced.id === freshId && synced.snapshot === null);
}

if (failures.length) {
  console.error(`\n✗ ${failures.length} failed, ${passed} passed\n`);
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  process.exit(1);
}
console.error(`✓ ${passed} worker checks passed`);
