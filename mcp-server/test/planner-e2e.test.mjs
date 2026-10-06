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
    });
    let log = '';
    const timer = setTimeout(() => { proc.kill(); reject(new Error(`wrangler dev did not start:\n${log}`)); }, 60_000);
    const onData = (d) => { log += d.toString(); if (/Ready on/i.test(log)) { clearTimeout(timer); resolve(proc); } };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`wrangler dev exited (${code}):\n${log}`)); });
  });
}

const pendingCount = async () => (await (await fetch(`${WORKER}/api/${TOKEN}/pending`)).json()).offers.length;

const worker = await startWorker();
const browser = await chromium.launch();
try {
  // Claude's side: record three options from a "screenshot".
  const claude = new Client({ name: 'claude-stand-in', version: '1.0.0' });
  await claude.connect(new StreamableHTTPClientTransport(new URL(CONNECTOR_URL)));
  await claude.callTool({
    name: 'add_trip_options',
    arguments: {
      source: 'Capital One Travel',
      options: [
        { kind: 'flight', from: 'NYC', to: 'PAR', departure: '18:30', arrival: '07:45', carrier: 'Air France', price: 612, currency: 'USD' },
        { kind: 'flight', from: 'NYC', to: 'PAR', departure: '22:10', arrival: '11:30', carrier: 'Delta', price: 548, currency: 'USD' },
        { kind: 'hotel', place: 'Paris', name: 'Le Marais Boutique', price: 280, currency: 'USD', per_night: true, nights: 3 },
      ],
    },
  });
  await claude.close();
  record('Claude-side records three options', (await pendingCount()) === 3);

  // The planner: connect once, options appear in staging.
  const page = await browser.newPage();
  await page.goto(PLANNER, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /TripAgent capture/i }).click();
  await page.locator('input[placeholder^="https://…workers.dev"]').fill(CONNECTOR_URL);
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.getByText(/3 options from Claude waiting/).waitFor({ timeout: 10_000 }).catch(() => {});
  const body = await page.locator('body').innerText();
  record('connecting pulls Claude\'s options into staging', /3 options from Claude waiting/.test(body) && /Add all 3 to table/.test(body),
    (body.match(/(\d+ options? from Claude[^\n]*|Could not[^\n]*|did not recognize[^\n]*)/) || [])[0]);
  record('the staged flight shows its dollar price', /\$612/.test(body) && /\$548/.test(body));
  record('pulling into staging does not consume them on the connector', (await pendingCount()) === 3);

  // Add one, dismiss one — both are forgotten on the connector; the third stays.
  const staged = page.locator('table').filter({ has: page.locator('th', { hasText: 'Source' }) });
  await staged.locator('tbody tr', { hasText: '$612' }).getByRole('button', { name: 'Add' }).click();
  await staged.locator('tbody tr', { hasText: '$548' }).getByRole('button', { name: 'Dismiss offer' }).click();
  await page.waitForTimeout(800);
  record('added and dismissed options are cleared on the connector', (await pendingCount()) === 1, `${await pendingCount()} pending`);

  // A reload loses the in-memory staging list — the unreviewed hotel must come back.
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /TripAgent capture/i }).click();
  await page.getByText(/1 option from Claude waiting/).waitFor({ timeout: 10_000 }).catch(() => {});
  const afterReload = await page.locator('body').innerText();
  record('an unreviewed option survives a reload', /1 option from Claude waiting/.test(afterReload) && /Le Marais Boutique/.test(afterReload));
  record('the connector URL is remembered across reloads', /Claude connector on/.test(afterReload));
  record('the added flight is in the plan', /\$612|USD612|612/.test(afterReload));

  // Disconnect: no more pulls, URL forgotten.
  await page.getByRole('button', { name: 'Disconnect' }).click();
  record('disconnect forgets the URL', await page.locator('input[placeholder^="https://…workers.dev"]').count() === 1);
} catch (err) {
  record('unexpected error', false, err.stack || String(err));
} finally {
  await browser.close();
  worker.kill('SIGTERM');
}

let failed = 0;
results.forEach((r) => { if (!r.pass) failed += 1; console.error(`${r.pass ? '✓' : '✗'} ${r.name}${!r.pass && r.detail ? `\n    ${r.detail}` : ''}`); });
console.error(failed ? `\n✗ ${failed} of ${results.length} failed` : `\n✓ ${results.length} end-to-end checks passed`);
process.exit(failed ? 1 : 0);
