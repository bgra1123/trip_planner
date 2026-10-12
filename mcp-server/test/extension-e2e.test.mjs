// The Chrome extension, loaded for real, posting captures to the TripAgent
// server running in workerd — with the real planner in the same browser.
//
// Needs the planner running:   npm start            (in the repo root)
// Then:                        xvfb-run -a node mcp-server/test/extension-e2e.test.mjs
//                              (on a machine with a display: just node …)

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { rmSync, mkdtempSync } from 'node:fs';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, '../../extension');
const PORT = 8797;
const TOKEN = 'ext-token-0123456789abcdef';
const WORKER = `http://127.0.0.1:${PORT}`;
const CONNECTOR_URL = `${WORKER}/mcp/${TOKEN}`;
const PLANNER = process.env.PLANNER_URL || 'http://localhost:3000';

let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  console.error('Playwright is not installed — skipping the extension e2e test.');
  process.exit(0);
}

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

const H = { Origin: 'http://localhost:3000' };
const api = async (p, init = {}) => (await fetch(`${WORKER}/api/${TOKEN}${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } })).json();
const until = async (fn, ms = 12_000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };

const worker = await startWorker();
const profile = mkdtempSync(path.join(os.tmpdir(), 'tripagent-ext-'));
let ctx;
try {
  ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: false, // Chrome only loads extensions in a headed browser
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15_000 });
  const extId = new URL(sw.url()).host;
  const stored = (key) => sw.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key);
  record('the extension loads', !!extId);

  // 1. The planner announces its connector; the extension needs no setup of its own.
  const planner = await ctx.newPage();
  await planner.goto(PLANNER, { waitUntil: 'networkidle' });
  await planner.getByRole('button', { name: /TripAgent capture/i }).click();
  record('before connecting, the extension has no TripAgent URL', !(await stored('tripagent:connector-url')));
  await planner.locator('input[placeholder^="https://…workers.dev"]').fill(CONNECTOR_URL);
  await planner.getByRole('button', { name: 'Connect' }).click();
  record('connecting the planner configures the extension', await until(async () => (await stored('tripagent:connector-url')) === CONNECTOR_URL));
  record('the planner reports its open trip to the server', await until(async () => !!(await api('/active')).tripId));
  const openTripId = (await api('/active')).tripId;
  record('…which is the trip the planner has open', (await api('/trips')).trips.some((t) => t.id === openTripId));

  // 2. Send scraped offers from the popup: they go to the server, not a tab.
  await sw.evaluate(async () => {
    await (chrome.storage.session || chrome.storage.local).set({ 'tripagent.offers': [
      { kind: 'flight', from: 'NYC', to: 'PAR', departure: '18:30', arrival: '07:45', carrier: 'Air France', price: { low: 612, high: 612, currency: 'USD' }, source: 'Kayak' },
      { kind: 'flight', from: 'NYC', to: 'PAR', departure: '22:10', arrival: '11:30', carrier: 'Delta', price: { low: 548, high: 548, currency: 'USD' }, source: 'Kayak' },
    ] });
  });
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  record('the popup shows TripAgent as connected', await popup.locator('#server-on').isVisible());
  await popup.locator('#send-offers-btn').click();
  record('the popup says it went to TripAgent', await until(async () => /on TripAgent/.test(await popup.locator('#status').innerText().catch(() => ''))), await popup.locator('#status').innerText().catch(() => ''));
  record('the offers are on the server for that trip', (await api(`/trips/${openTripId}/pending`)).offers.length === 2);

  // 3. The planner (still open) pulls them when it is looked at again.
  await planner.bringToFront();
  await planner.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await planner.getByRole('button', { name: 'Check now' }).click().catch(() => {});
  await planner.getByText(/2 options from Claude waiting/).waitFor({ timeout: 10_000 }).catch(() => {});
  const body = await planner.locator('body').innerText();
  record('the planner shows them for review, with their dollar prices', /\$612/.test(body) && /\$548/.test(body), (body.match(/(\d+ options? from Claude[^\n]*)/) || [])[0]);
  record('nothing was pushed straight into the planner (no duplicates)', /2 options from Claude waiting/.test(body) && !/4 options/.test(body));

  // 4. Selected text goes through the same path.
  await sw.evaluate(async () => { await chrome.storage.local.set({ captures: [{ id: 'c1', text: 'Flight: IST → MUN, 06:45-09:10, €210', category: 'flight', sourceTitle: 't', sourceUrl: '', createdAt: new Date().toISOString() }] }); });
  await popup.reload();
  await popup.locator('#send-notes-btn').click();
  record('selected text is sent to TripAgent too', await until(async () => (await api(`/trips/${openTripId}/pending`)).offers.some((o) => o.group === 'IST → MUN')));

  // 5. Fallbacks: a dead server falls back to the open planner tab, with a reason.
  await popup.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'SET_CONNECTOR', url: 'http://127.0.0.1:9/mcp/dead-token-0123456789' }, r)));
  await popup.reload();
  await popup.locator('#send-offers-btn').click();
  const dead = await until(async () => /Could not reach TripAgent/.test(await popup.locator('#status').innerText().catch(() => '')));
  record('an unreachable server is reported, not silent', dead, await popup.locator('#status').innerText().catch(() => ''));
  record('…and the offers still reach the open planner tab', /planner tab/.test(await popup.locator('#status').innerText().catch(() => '')));

  // 6. With no TripAgent set, the old behaviour is unchanged.
  await popup.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'SET_CONNECTOR', url: '' }, r)));
  await popup.reload();
  record('with no URL the popup asks for one', await popup.locator('#server-off').isVisible());
  await popup.locator('#send-offers-btn').click();
  record('with no URL, offers still go to an open planner tab', await until(async () => /planner tab/.test(await popup.locator('#status').innerText().catch(() => ''))));

  // 7. A page cannot overwrite a URL the user chose.
  await popup.evaluate((u) => new Promise((r) => chrome.runtime.sendMessage({ type: 'SET_CONNECTOR', url: u }, r)), CONNECTOR_URL);
  await planner.evaluate(() => window.postMessage({ source: 'tripagent-page', protocol: 'tripagent/v1', type: 'CONNECTOR', url: 'https://evil.example.workers.dev/mcp/aaaaaaaaaaaaaaaaaaaa' }, window.location.origin));
  await new Promise((r) => setTimeout(r, 800));
  record('a page announcement never replaces a saved URL', (await stored('tripagent:connector-url')) === CONNECTOR_URL);
  await popup.locator('#server-change-btn').click();
  record('"Change" clears the saved URL', await until(async () => !(await stored('tripagent:connector-url'))));
  await popup.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'PAGE_CONNECTOR', url: 'not a url' }, r)));
  record('a malformed announcement is ignored', !(await stored('tripagent:connector-url')));
} catch (err) {
  record('unexpected error', false, err.stack || String(err));
} finally {
  if (ctx) await ctx.close().catch(() => {});
  try { process.kill(-worker.pid, 'SIGTERM'); } catch { worker.kill('SIGTERM'); }
}

let failed = 0;
results.forEach((r) => { if (!r.pass) failed += 1; console.error(`${r.pass ? '✓' : '✗'} ${r.name}${!r.pass && r.detail ? `\n    ${r.detail}` : ''}`); });
console.error(failed ? `\n✗ ${failed} of ${results.length} failed` : `\n✓ ${results.length} extension end-to-end checks passed`);
process.exit(failed ? 1 : 0);
