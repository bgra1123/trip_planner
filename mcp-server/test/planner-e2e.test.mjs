// End-to-end: Claude-side (official MCP client) records options on the
// Worker running in workerd; the real planner in a real browser connects,
// stages them, and acknowledges what the user adds or dismisses.
//
// Needs the planner running:   npm start            (in the repo root)
// Then:                        node mcp-server/test/planner-e2e.test.mjs

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { rmSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8798;
const TOKEN = 'e2e-token-0123456789abcdef';
const WORKER = `http://127.0.0.1:${PORT}`;
const CONNECTOR_URL = `${WORKER}/mcp/${TOKEN}`;
const PLANNER = process.env.PLANNER_URL || 'http://localhost:3000';

let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  console.error('Playwright is not installed — skipping the planner e2e test.');
  process.exit(0);
}

const results = [];
const record = (name, pass, detail) => results.push({ name, pass, detail });

function startWorker() {
  const state = path.join(here, '.wrangler-e2e-state');
  rmSync(state, { recursive: true, force: true });
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--var', `TRIP_TOKEN:${TOKEN}`, '--persist-to', state], {
      cwd: path.join(here, '..'),
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let log = '';
    const timer = setTimeout(() => { proc.kill(); reject(new Error(`wrangler dev did not start:\n${log}`)); }, 60_000);
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
const browser = await chromium.launch();
const claude = new Client({ name: 'claude-stand-in', version: '1.0.0' });
const say = async (name, args) => {
  const r = await claude.callTool({ name, arguments: args });
  return r.content.map((c) => c.text).join('\n');
};
try {
  await claude.connect(new StreamableHTTPClientTransport(new URL(CONNECTOR_URL)));

  // Claude starts a trip before the planner has ever connected.
  const made = await say('create_trip', { title: 'Rome in May' });
  const romeId = (made.match(/trip (t[\w-]+)/) || [])[1];
  await say('add_trip_options', { tripId: romeId, source: 'Capital One Travel', options: [
    { kind: 'flight', from: 'NYC', to: 'ROM', departure: '18:30', arrival: '07:45', carrier: 'ITA', price: 612, currency: 'USD' },
    { kind: 'flight', from: 'NYC', to: 'ROM', departure: '22:10', arrival: '11:30', carrier: 'Delta', price: 548, currency: 'USD' },
    { kind: 'hotel', place: 'Rome', name: 'Hotel Tiber', price: 280, currency: 'USD', per_night: true, nights: 3 },
  ] });
  record('Claude creates a trip and records three options in it', (await api(`/trips/${romeId}/pending`)).offers.length === 3);

  // The planner connects: it adopts Rome and pushes its own trip.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const dialogs = [];
  page.on('dialog', (d) => { const next = dialogs.shift(); if (next === undefined) d.accept(); else d.accept(next); });
  await page.goto(PLANNER, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /TripAgent capture/i }).click();
  await page.locator('input[placeholder^="https://…workers.dev"]').fill(CONNECTOR_URL);
  await page.getByRole('button', { name: 'Connect' }).click();
  const select = page.getByLabel('Trip', { exact: true });
  const titles = async () => select.locator('option').allInnerTexts();

  record('the trip Claude made appears in the planner', await until(async () => (await titles()).includes('Rome in May')), (await titles()).join(', '));
  record('the planner\'s own trip is saved to the server', await until(async () => (await api('/trips')).trips.some((t) => t.title === 'My trip')));
  record('Claude now sees both trips', await until(async () => /Rome in May/.test(await say('list_trips', {})) && /My trip/.test(await say('list_trips', {}))));
  const ambiguous = await claude.callTool({ name: 'list_pending_options', arguments: {} });
  record('with two trips Claude is told to ask which', ambiguous.isError && /ask which one/.test(ambiguous.content[0].text));

  // Open Rome: Claude's options are staged (and only staged).
  await select.selectOption({ label: 'Rome in May' });
  await page.getByRole('button', { name: /TripAgent capture/i }).click();
  await page.getByText(/3 options from Claude waiting/).waitFor({ timeout: 10_000 }).catch(() => {});
  let body = await page.locator('body').innerText();
  record('opening the trip stages Claude\'s three options', /3 options from Claude waiting/.test(body) && /Add all 3 to table/.test(body));
  record('the staged flight shows its dollar price', /\$612/.test(body) && /\$548/.test(body));
  record('staging does not consume them on the server', (await api(`/trips/${romeId}/pending`)).offers.length === 3);

  // A spoken correction: Claude changes the price and drops the hotel.
  const list = await say('list_pending_options', { tripId: romeId });
  const itaId = (list.match(/\[([^\]]+)\] flight[^\n]*ITA/) || [])[1];
  const hotelId = (list.match(/\[([^\]]+)\] hotel/) || [])[1];
  await say('update_trip_option', { tripId: romeId, optionId: itaId, changes: { price: 640 } });
  await say('remove_trip_option', { tripId: romeId, optionId: hotelId });
  await page.getByRole('button', { name: 'Check now' }).click();
  record('a correction replaces the old option in staging', await until(async () => { const t = await page.locator('body').innerText(); return /\$640/.test(t) && !/\$612/.test(t); }));
  body = await page.locator('body').innerText();
  record('a removed option leaves staging', !/Hotel Tiber/.test(body) && /2 options from Claude waiting/.test(body));

  // Add one, dismiss one: both are forgotten on the server.
  const staged = page.locator('table').filter({ has: page.locator('th', { hasText: 'Source' }) });
  await staged.locator('tbody tr', { hasText: '$640' }).getByRole('button', { name: 'Add' }).click();
  await staged.locator('tbody tr', { hasText: '$548' }).getByRole('button', { name: 'Dismiss offer' }).click();
  record('added and dismissed options are cleared on the server', await until(async () => (await api(`/trips/${romeId}/pending`)).offers.length === 0));

  // The plan Claude can now read comes from what the user added.
  record('the added flight reaches the synced plan Claude reads', await until(async () => /ITA/.test(await say('get_trip_path', { tripId: romeId })) || /640/.test(await say('get_trip_path', { tripId: romeId }))), await say('get_trip_path', { tripId: romeId }));

  // New trip from the planner reaches Claude; deleting it removes it there.
  dialogs.push('Lisbon');
  await page.getByRole('button', { name: 'New trip' }).click();
  record('a new trip is created and opened', await until(async () => (await titles()).includes('Lisbon')) && (await select.inputValue()) !== romeId);
  record('Claude sees the new trip', await until(async () => /Lisbon/.test(await say('list_trips', {}))));
  await page.getByRole('button', { name: 'Delete' }).click();
  record('deleting it removes it for Claude too', await until(async () => !/Lisbon/.test(await say('list_trips', {}))) && !(await titles()).includes('Lisbon'));

  // Reload: trips and the connection persist.
  await page.reload({ waitUntil: 'networkidle' });
  const after = await titles();
  record('trips survive a reload', after.includes('Rome in May') && after.includes('My trip'), after.join(', '));
  record('the connection is remembered across reloads', /Shared with Claude|Connected to TripAgent|Syncing/.test(await page.locator('body').innerText()));

  // A trip deleted by Claude-side API (another device) disappears here on sync.
  await api(`/trips/${romeId}`, { method: 'DELETE' });
  await page.getByRole('button', { name: 'Sync now' }).click();
  record('a trip deleted elsewhere is dropped on sync', await until(async () => !(await titles()).includes('Rome in May')), (await titles()).join(', '));

  // Disconnect: the URL is forgotten and the planner still works locally.
  if (!(await page.getByRole('button', { name: 'Disconnect' }).count())) await page.getByRole('button', { name: /TripAgent capture/i }).click();
  await page.getByRole('button', { name: 'Disconnect' }).click();
  record('disconnect forgets the URL', await page.locator('input[placeholder^="https://…workers.dev"]').count() === 1);
  record('local trips remain after disconnecting', (await titles()).includes('My trip'));
} catch (err) {
  record('unexpected error', false, err.stack || String(err));
} finally {
  await claude.close().catch(() => {});
  await browser.close();
  try { process.kill(-worker.pid, 'SIGTERM'); } catch { worker.kill('SIGTERM'); }
}

let failed = 0;
results.forEach((r) => { if (!r.pass) failed += 1; console.error(`${r.pass ? '✓' : '✗'} ${r.name}${!r.pass && r.detail ? `\n    ${r.detail}` : ''}`); });
console.error(failed ? `\n✗ ${failed} of ${results.length} failed` : `\n✓ ${results.length} end-to-end checks passed`);
process.exit(failed ? 1 : 0);
