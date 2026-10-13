// The extension's service worker (extension/background.js) run in Node with a
// stubbed `chrome` API, posting to the real TripBuddy worker in workerd.
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
    record('SET_CONNECTOR refuses a URL that is not a TripBuddy connector', bad.ok === false && /TripBuddy URL/.test(bad.error));
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
    record('sending goes to TripBuddy, naming the trip', reply.ok && reply.server.ok && reply.server.title === 'Paris' && reply.server.recorded === 2, JSON.stringify(reply));
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
    record('selected text goes to TripBuddy too', reply.server.ok && reply.delivered === 0 && pushed.length === 0, JSON.stringify(reply));
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
    record('an automatic capture goes to TripBuddy', first.ok && first.added === 1 && waiting.length === 1 && waiting[0].price.currency === 'GBP', JSON.stringify(waiting));
    record('…and is not also pushed to the planner tab', pushed.length === 0);
    await send({ type: 'CAPTURED', offers: auto, site: 'kayak' });
    record('the same page seen again is not re-posted or duplicated', (await api('/trips/tripAUTO001/pending')).offers.length === 1);
    await api('/trips/tripAUTO001', { method: 'DELETE' });
    await api('/trips/tripOPEN001', { method: 'PUT', body: JSON.stringify({ title: 'Paris', snapshot: { rows: [], notes: [], rateRows: [] } }) });
    await api('/active', { method: 'PUT', body: JSON.stringify({ tripId: 'tripOPEN001' }) });
  }

  // -- bank-portal prices are held until the user says what they cover --
  {
    const { chrome, send, pushed } = loadBackground();
    await send({ type: 'SET_CONNECTOR', url: CONNECTOR_URL });
    await api('/trips/tripTRAV001', { method: 'PUT', body: JSON.stringify({ title: 'Travelers', snapshot: { rows: [], notes: [], rateRows: [] } }) });
    await api('/active', { method: 'PUT', body: JSON.stringify({ tripId: 'tripTRAV001' }) });
    const flight = (price, source = 'capital-one', dep = '6:05 PM') => ({ kind: 'flight', from: 'NYC', to: 'PAR', departure: dep, arrival: '6:10 AM', carrier: 'Delta', price, source, detail: 'fare: Delta Main Basic' });
    const waiting = async () => (await api('/trips/tripTRAV001/pending')).offers;

    // 1. Nothing is assumed: no answer yet, nothing leaves the extension.
    const first = await send({ type: 'CAPTURED', offers: [flight('$1,062'), flight('$809', 'capital-one', '11:00 PM')], site: 'capital-one' });
    record('a Capital One capture is held, and the popup is told to ask', first.ok && first.held.length === 1 && first.held[0].source === 'capital-one' && first.held[0].count === 2, JSON.stringify(first.held));
    record('…nothing reached TripBuddy', (await waiting()).length === 0);
    record('…nor the planner tab', pushed.length === 0);
    const state = await send({ type: 'GET_STATE' });
    record('the popup state lists what is waiting for an answer', state.held.length === 1 && state.held[0].count === 2 && Object.keys(state.pricing).length === 0);
    const asked = await send({ type: 'PAGE_READY' });
    record('an opening planner tab is not handed unconfirmed prices either', asked.offers.length === 0);
    const resend = await send({ type: 'SEND_OFFERS_TO_PLANNER' });
    record('"Send to planner" holds them too and says so', resend.count === 0 && resend.held.length === 1 && (await waiting()).length === 0 && pushed.length === 0);

    // 2. Everything else is not affected.
    await send({ type: 'CAPTURED', offers: [flight('$500', 'kayak')], site: 'kayak' });
    await send({ type: 'CAPTURED', offers: [{ kind: 'hotel', place: 'Paris', label: 'H', price: '$300', source: 'capital-one' }], site: 'capital-one' });
    let got = await waiting();
    record('other sites and bank-portal hotels are sent without a question', got.some((o) => o.price.low === 500) && got.some((o) => o.category === 'stay' && o.price.low === 300) && got.length === 2);

    // 3. Bad answers are refused.
    record('an unknown portal is refused', (await send({ type: 'CONFIRM_PRICING', source: 'evil', basis: 'total' })).ok === false);
    record('no choice is refused', (await send({ type: 'CONFIRM_PRICING', source: 'capital-one', basis: '' })).ok === false);
    record('per traveler without a count is refused', (await send({ type: 'CONFIRM_PRICING', source: 'capital-one', basis: 'per_traveler' })).ok === false);
    record('…and none of that sent anything', (await waiting()).length === 2);

    // 4. The user answers: per traveler, 2 people.
    const ok2 = await send({ type: 'CONFIRM_PRICING', source: 'capital-one', basis: 'per_traveler', travelers: 2 });
    got = await waiting();
    const doubled = got.find((o) => o.price.low === 2124);
    record('confirming sends the held flights, totalled', ok2.ok && ok2.count >= 2 && !!doubled && got.some((o) => o.price.low === 1618), JSON.stringify(got.map((o) => o.price)));
    record('…noting how each was totalled', !!doubled && /\$1,062 per traveler × 2/.test(doubled.detail) && /fare: Delta Main Basic/.test(doubled.detail), doubled && doubled.detail);
    record('the answer is shown back to the user, not hidden', (await send({ type: 'GET_STATE' })).pricing['capital-one'].travelers === 2 && (await send({ type: 'GET_STATE' })).held.length === 0);

    // 5. Later captures are not asked again.
    const later = await send({ type: 'CAPTURED', offers: [flight('$410', 'capital-one', '9:00 AM')], site: 'capital-one' });
    record('a later capture is totalled without asking again', later.held.length === 0 && (await waiting()).some((o) => o.price.low === 820));

    // 6. Amex is its own question.
    const amex = await send({ type: 'CAPTURED', offers: [flight('$350', 'amex')], site: 'amex' });
    record('Amex is asked separately', amex.held.length === 1 && amex.held[0].source === 'amex' && !(await waiting()).some((o) => o.price.low === 350 || o.price.low === 700));
    await send({ type: 'CONFIRM_PRICING', source: 'amex', basis: 'total' });
    record('"total for everyone" sends the price exactly as shown', (await waiting()).some((o) => o.price.low === 350 && !/per traveler/.test(o.detail)));

    // 7. Change: the next capture asks again.
    await send({ type: 'CLEAR_PRICING', source: 'capital-one' });
    const again = await send({ type: 'CAPTURED', offers: [flight('$999', 'capital-one', '1:00 PM')], site: 'capital-one' });
    record('after Change the next capture is held again', again.held.length === 1 && !(await waiting()).some((o) => o.price.low === 999 || o.price.low === 1998));
    await send({ type: 'CONFIRM_PRICING', source: 'capital-one', basis: 'per_traveler', travelers: 1 });
    record('one traveler leaves the price as shown', (await waiting()).some((o) => o.price.low === 999 && !/per traveler/.test(o.detail)));

    // 8. A price that cannot be totalled is never sent wrong.
    await send({ type: 'CONFIRM_PRICING', source: 'capital-one', basis: 'per_traveler', travelers: 3 });
    const odd = await send({ type: 'CAPTURED', offers: [flight('Price on request', 'capital-one', '3:00 PM')], site: 'capital-one' });
    record('a price that cannot be totalled stays held', odd.held.length === 1);
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
    record('an unreachable server is reported with a reason', dead.server.ok === false && /Could not reach TripBuddy/.test(dead.server.error));
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
