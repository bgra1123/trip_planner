// The extension's service worker (extension/background.js) run in Node with a
// stubbed `chrome` API, posting to the real TripAgent worker in workerd.
// (Loading an unpacked extension into the sandbox's Chromium isn't possible, so
// this exercises the logic; the popup wiring and a real install are checked by hand.)
//
//   node mcp-server/test/extension-background.test.mjs

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, rmSync } from 'node:fs';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, '../../extension');
const PORT = 8797;
const TOKEN = 'ext-token-0123456789abcdef';
const WORKER = `http://127.0.0.1:${PORT}`;
const CONNECTOR_URL = `${WORKER}/mcp/${TOKEN}`;

const results = [];
const record = (name, pass, detail) => results.push({ name, pass, detail });

function startWorker() {
  const state = path.join(here, '.wrangler-ext-state');
  rmSync(state, { recursive: true, force: true });
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--var', `TRIP_TOKEN:${TOKEN}`, '--persist-to', state], {
      cwd: path.join(here, '..'),
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let log = '';
    const timer = setTimeout(() => { try { process.kill(-proc.pid); } catch { /* gone */ } reject(new Error(`wrangler dev did not start:\n${log}`)); }, 60_000);
    const onData = (d) => { log += d.toString(); if (/Ready on/i.test(log)) { clearTimeout(timer); resolve(proc); } };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`wrangler dev exited (${code}):\n${log}`)); });
  });
}

const H = { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' };
const api = async (p, init = {}) => (await fetch(`${WORKER}/api/${TOKEN}${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } })).json();

// ---- a minimal chrome.* ----
function makeChrome() {
  const area = () => { const m = {}; return { get: async (k) => (typeof k === 'string' ? (k in m ? { [k]: m[k] } : {}) : { ...m }), set: async (o) => { Object.assign(m, o); }, remove: async (k) => { delete m[k]; }, _m: m }; };
  const listeners = [];
  const pushed = [];
  const chrome = {
    storage: { local: area(), session: area() },
    runtime: {
      onMessage: { addListener: (fn) => listeners.push(fn) },
      onInstalled: { addListener: () => {} },
      getManifest: () => ({ version: 'test' }),
    },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    contextMenus: { create: () => {}, onClicked: { addListener: () => {} } },
    tabs: {
      query: async () => [{ id: 1, url: 'http://localhost:3000/' }], // one open planner tab
      sendMessage: async (id, msg) => { pushed.push(msg); },
    },
    scripting: {},
  };
  return { chrome, listeners, pushed };
}

function loadBackground() {
  const { chrome, listeners, pushed } = makeChrome();
  const sandbox = {
    chrome, fetch, URL, console, setTimeout, clearTimeout, Promise, JSON, Date, Math,
    importScripts: (...files) => files.forEach((f) => vm.runInContext(readFileSync(path.join(EXT, f), 'utf8'), sandbox, { filename: f })),
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(path.join(EXT, 'background.js'), 'utf8'), sandbox, { filename: 'background.js' });
  const send = (message) => new Promise((resolve) => {
    const keep = listeners[0](message, { id: 'self' }, resolve);
    if (!keep) resolve(undefined);
  });
  return { chrome, send, pushed };
}

const OFFERS = [
  { kind: 'flight', from: 'NYC', to: 'PAR', departure: '18:30', arrival: '07:45', carrier: 'Air France', price: { low: 612, high: 612, currency: 'USD' }, source: 'Kayak' },
  { kind: 'flight', from: 'NYC', to: 'PAR', departure: '22:10', arrival: '11:30', carrier: 'Delta', price: { low: 548, high: 548, currency: 'USD' }, source: 'Kayak' },
];
const seed = (chrome, offers = OFFERS) => chrome.storage.session.set({ 'tripagent.offers': offers });

const worker = await startWorker();
try {
  // A trip is open in the planner.
  await api('/trips/tripOPEN001', { method: 'PUT', body: JSON.stringify({ title: 'Paris', snapshot: { rows: [], notes: [], rateRows: [] } }) });
  await api('/active', { method: 'PUT', body: JSON.stringify({ tripId: 'tripOPEN001' }) });
  const pending = async () => (await api('/trips/tripOPEN001/pending')).offers;

  // -- configuring the connector --
  {
    const { chrome, send } = loadBackground();
    record('GET_STATE reports no connector at first', (await send({ type: 'GET_STATE' })).connectorUrl === '');
    const bad = await send({ type: 'SET_CONNECTOR', url: 'https://example.com/not-a-connector' });
    record('SET_CONNECTOR refuses a URL that is not a TripAgent connector', bad.ok === false && /TripAgent URL/.test(bad.error));
    record('SET_CONNECTOR refuses plain http to a real host', (await send({ type: 'SET_CONNECTOR', url: 'http://evil.example/mcp/abcdefghij' })).ok === false);
    record('SET_CONNECTOR accepts localhost for testing', (await send({ type: 'SET_CONNECTOR', url: CONNECTOR_URL })).ok === true);
    record('the URL is saved and reported', (await send({ type: 'GET_STATE' })).connectorUrl === CONNECTOR_URL);
    await send({ type: 'PAGE_CONNECTOR', url: 'http://127.0.0.1:1/mcp/zzzzzzzzzzzz' });
    record('a page announcement never replaces a saved URL', (await send({ type: 'GET_STATE' })).connectorUrl === CONNECTOR_URL);
    await send({ type: 'SET_CONNECTOR', url: '' });
    record('an empty URL clears it', (await send({ type: 'GET_STATE' })).connectorUrl === '');
    await send({ type: 'PAGE_CONNECTOR', url: 'not a url' });
    record('a malformed announcement is ignored', (await send({ type: 'GET_STATE' })).connectorUrl === '');
    await send({ type: 'PAGE_CONNECTOR', url: CONNECTOR_URL });
    record('with no saved URL, the planner\'s announcement fills it in', (await send({ type: 'GET_STATE' })).connectorUrl === CONNECTOR_URL);
    void chrome;
  }

  // -- sending scraped offers --
  {
    const { chrome, send, pushed } = loadBackground();
    await send({ type: 'SET_CONNECTOR', url: CONNECTOR_URL });
    await seed(chrome);
    const reply = await send({ type: 'SEND_OFFERS_TO_PLANNER' });
    record('sending goes to TripAgent, naming the trip', reply.ok && reply.server.ok && reply.server.title === 'Paris' && reply.server.recorded === 2, JSON.stringify(reply));
    record('…and is not also pushed to the planner tab (no duplicates)', reply.delivered === 0 && pushed.length === 0);
    const waiting = await pending();
    record('the offers wait on the server in the open trip', waiting.length === 2 && waiting.some((o) => o.carrier === 'Air France' && o.price.low === 612 && o.price.currency === 'USD'));
    record('the scraper\'s source is kept', waiting.every((o) => o.source === 'Kayak'));
    await send({ type: 'SEND_OFFERS_TO_PLANNER' });
    record('sending again does not duplicate', (await pending()).length === 2);
  }

  // -- selected text --
  {
    const { send, pushed } = loadBackground();
    await send({ type: 'SET_CONNECTOR', url: CONNECTOR_URL });
    const reply = await send({ type: 'SEND_NOTES_TO_PLANNER', notes: 'Flight: IST → MUN, 06:45-09:10, €210' });
    record('selected text goes to TripAgent too', reply.server.ok && reply.delivered === 0 && pushed.length === 0, JSON.stringify(reply));
    record('…and is parsed by the planner\'s grammar', (await pending()).some((o) => o.group === 'IST → MUN' && o.price.currency === 'EUR'));
  }

  // -- automatic capture on a known travel site (content script) --
  {
    const { send, pushed } = loadBackground();
    await send({ type: 'SET_CONNECTOR', url: CONNECTOR_URL });
    await api('/trips/tripAUTO001', { method: 'PUT', body: JSON.stringify({ title: 'Auto', snapshot: { rows: [], notes: [], rateRows: [] } }) });
    await api('/active', { method: 'PUT', body: JSON.stringify({ tripId: 'tripAUTO001' }) });
    const auto = [{ kind: 'flight', from: 'LHR', to: 'JFK', departure: '09:00', arrival: '12:00', carrier: 'BA', price: { low: 410, high: 410, currency: 'GBP' }, source: 'kayak' }];
    const first = await send({ type: 'CAPTURED', offers: auto, site: 'kayak' });
    const waiting = (await api('/trips/tripAUTO001/pending')).offers;
    record('an automatic capture goes to TripAgent', first.ok && first.added === 1 && waiting.length === 1 && waiting[0].price.currency === 'GBP', JSON.stringify(waiting));
    record('…and is not also pushed to the planner tab', pushed.length === 0);
    await send({ type: 'CAPTURED', offers: auto, site: 'kayak' });
    record('the same page seen again is not re-posted or duplicated', (await api('/trips/tripAUTO001/pending')).offers.length === 1);
    await api('/trips/tripAUTO001', { method: 'DELETE' });
    await api('/trips/tripOPEN001', { method: 'PUT', body: JSON.stringify({ title: 'Paris', snapshot: { rows: [], notes: [], rateRows: [] } }) });
    await api('/active', { method: 'PUT', body: JSON.stringify({ tripId: 'tripOPEN001' }) });
  }

  // -- per-traveler totals: only when the user says so --
  {
    const { chrome, send } = loadBackground();
    await send({ type: 'SET_CONNECTOR', url: CONNECTOR_URL });
    await api('/trips/tripTRAV001', { method: 'PUT', body: JSON.stringify({ title: 'Travelers', snapshot: { rows: [], notes: [], rateRows: [] } }) });
    await api('/active', { method: 'PUT', body: JSON.stringify({ tripId: 'tripTRAV001' }) });
    const flight = (price, source = 'capital-one') => ({ kind: 'flight', from: 'NYC', to: 'PAR', departure: '6:05 PM', arrival: '6:10 AM', carrier: 'Delta', price, source, detail: 'fare: Delta Main Basic' });
    const waiting = async () => (await api('/trips/tripTRAV001/pending')).offers;
    const setOpts = (travelers, perTraveler) => send({ type: 'SET_OPTIONS', options: { from: '', to: '', window: '', travelers, perTraveler } });

    // Nothing is assumed: with no setting the price is exactly as shown.
    await send({ type: 'CAPTURED', offers: [flight('$1,062')], site: 'capital-one' });
    let got = await waiting();
    record('with no setting a portal price is kept exactly as shown', got.length === 1 && got[0].price.low === 1062 && !/per traveler/.test(got[0].detail), JSON.stringify(got));

    await setOpts('2', false);
    await send({ type: 'CAPTURED', offers: [flight('$555')], site: 'capital-one' });
    got = await waiting();
    record('Travelers alone does not multiply (the user has not said it is per traveler)', got.some((o) => o.price.low === 555));

    await setOpts('2', true);
    await send({ type: 'CAPTURED', offers: [flight('$1,062.50'), flight('$809')], site: 'capital-one' });
    got = await waiting();
    const two = got.find((o) => o.price.low === 2125);
    record('ticking per traveler with 2 travelers doubles a bank-portal flight price', !!two && two.price.currency === 'USD', JSON.stringify(got.map((o) => o.price)));
    record('…keeping the dollar sign and cents', got.some((o) => o.price.low === 1618));
    record('…and saying how it was totalled', !!two && /\$1,062\.50 per traveler × 2/.test(two.detail) && /fare: Delta Main Basic/.test(two.detail), two && two.detail);

    await send({ type: 'CAPTURED', offers: [flight('$410', 'amex')], site: 'amex' });
    got = await waiting();
    record('Amex is a bank portal too, so the same setting applies', got.some((o) => o.price.low === 820));

    await send({ type: 'CAPTURED', offers: [flight('$500', 'kayak')], site: 'kayak' });
    got = await waiting();
    record('another site\'s price is never multiplied', got.some((o) => o.price.low === 500));

    await send({ type: 'CAPTURED', offers: [{ kind: 'hotel', place: 'Paris', label: 'H', price: '$300', source: 'capital-one' }], site: 'capital-one' });
    got = await waiting();
    record('a hotel is not multiplied (a room is not per traveler)', got.some((o) => o.category === 'stay' && o.price.low === 300));

    await setOpts('1', true);
    await send({ type: 'CAPTURED', offers: [flight('$777')], site: 'capital-one' });
    got = await waiting();
    record('one traveler leaves the price as shown', got.some((o) => o.price.low === 777 && !/per traveler/.test(o.detail)));

    await setOpts('3', true);
    await send({ type: 'CAPTURED', offers: [flight('Price on request')], site: 'capital-one' });
    void chrome;
    await api('/trips/tripTRAV001', { method: 'DELETE' });
    await api('/trips/tripOPEN001', { method: 'PUT', body: JSON.stringify({ title: 'Paris', snapshot: { rows: [], notes: [], rateRows: [] } }) });
    await api('/active', { method: 'PUT', body: JSON.stringify({ tripId: 'tripOPEN001' }) });
  }

  // -- following the open trip --
  {
    const { chrome, send } = loadBackground();
    await send({ type: 'SET_CONNECTOR', url: CONNECTOR_URL });
    await api('/trips/tripOTHER02', { method: 'PUT', body: JSON.stringify({ title: 'Rome', snapshot: { rows: [], notes: [], rateRows: [] } }) });
    await api('/active', { method: 'PUT', body: JSON.stringify({ tripId: 'tripOTHER02' }) });
    await seed(chrome, [{ kind: 'hotel', place: 'Rome', label: 'Hotel Tiber', price: { low: 200, high: 200, currency: 'EUR' } }]);
    const reply = await send({ type: 'SEND_OFFERS_TO_PLANNER' });
    record('after the user opens another trip, captures follow it', reply.server.ok && reply.server.title === 'Rome', JSON.stringify(reply));
    record('…and the first trip did not receive it', !(await pending()).some((o) => o.label === 'Hotel Tiber'));
  }

  // -- fallbacks --
  {
    const { chrome, send, pushed } = loadBackground();
    await seed(chrome);
    const none = await send({ type: 'SEND_OFFERS_TO_PLANNER' });
    record('with no URL set, offers go to the open planner tab as before', none.server.notConfigured === true && none.delivered === 1 && pushed.length === 1 && pushed[0].type === 'PUSH_OFFERS');

    await send({ type: 'SET_CONNECTOR', url: 'http://127.0.0.1:9/mcp/dead-token-0123456789' });
    const dead = await send({ type: 'SEND_OFFERS_TO_PLANNER' });
    record('an unreachable server is reported with a reason', dead.server.ok === false && /Could not reach TripAgent/.test(dead.server.error));
    record('…and the planner tab still gets the offers', dead.delivered === 1 && pushed.length === 2);

    await send({ type: 'SET_CONNECTOR', url: `${WORKER}/mcp/wrong-token-0123456789abc` });
    const wrong = await send({ type: 'SEND_OFFERS_TO_PLANNER' });
    record('a wrong token is reported as an unrecognized URL', wrong.server.ok === false && /did not recognize/.test(wrong.server.error), JSON.stringify(wrong.server));

    await send({ type: 'SET_CONNECTOR', url: CONNECTOR_URL });
    await api('/trips/tripOPEN001', { method: 'DELETE' });
    await api('/trips/tripOTHER02', { method: 'DELETE' });
    const noTrip = await send({ type: 'SEND_OFFERS_TO_PLANNER' });
    record('with no trip to send to, the server\'s reason is shown', noTrip.server.ok === false && /Open a trip in the planner/.test(noTrip.server.error), JSON.stringify(noTrip.server));
    record('…and the planner tab still gets the offers', noTrip.delivered === 1);
  }
} catch (err) {
  record('unexpected error', false, err.stack || String(err));
} finally {
  try { process.kill(-worker.pid, 'SIGTERM'); } catch { worker.kill('SIGTERM'); }
}

let failed = 0;
results.forEach((r) => { if (!r.pass) failed += 1; console.error(`${r.pass ? '✓' : '✗'} ${r.name}${!r.pass && r.detail ? `\n    ${r.detail}` : ''}`); });
console.error(failed ? `\n✗ ${failed} of ${results.length} failed` : `\n✓ ${results.length} extension background checks passed`);
process.exit(failed ? 1 : 0);
