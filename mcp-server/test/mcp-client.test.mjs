// Interop test: the Worker running in Cloudflare's real runtime (wrangler dev,
// local mode — no Cloudflare account needed), driven by the official MCP SDK
// client over Streamable HTTP. If this passes, a standard MCP client — which
// is what Claude uses — can connect, list the tools, and record options.
//
//   node mcp-server/test/mcp-client.test.mjs

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8799;
const TOKEN = 'interop-token-0123456789abcdef';
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
const failures = [];
const ok = (name, cond, detail) => { if (cond) passed += 1; else failures.push(`${name}${detail ? `\n    ${detail}` : ''}`); };

function startWorker() {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--var', `TRIP_TOKEN:${TOKEN}`, '--persist-to', path.join(here, '.wrangler-test-state')], {
      cwd: path.join(here, '..'),
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => { proc.kill(); reject(new Error(`wrangler dev did not start:\n${log}`)); }, 60_000);
    const onData = (d) => {
      log += d.toString();
      if (/Ready on/i.test(log)) { clearTimeout(timer); resolve(proc); }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`wrangler dev exited (${code}):\n${log}`)); });
  });
}

const proc = await startWorker();
try {
  const client = new Client({ name: 'trip-planner-interop-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/${TOKEN}`)));
  ok('the official MCP client connects and initializes', client.getServerVersion()?.name === 'trip-planner');
  ok('server instructions reach the client', /screenshot/.test(client.getInstructions() || ''));

  const { tools } = await client.listTools();
  ok('the client sees both tools', tools.map((t) => t.name).sort().join(',') === 'add_trip_options,list_pending_options');

  const added = await client.callTool({
    name: 'add_trip_options',
    arguments: {
      source: 'Capital One Travel',
      window: '21-24 Oct',
      options: [
        { kind: 'flight', from: 'NYC', to: 'PAR', departure: '18:30', arrival: '07:45', carrier: 'Air France', price: 612, currency: 'USD' },
        { kind: 'hotel', place: 'Paris', name: 'Le Marais Boutique', price: 280, currency: 'USD', per_night: true, nights: 3 },
      ],
    },
  });
  const addedText = added.content.map((c) => c.text).join('\n');
  ok('a tool call records options in the real runtime', /Recorded 2 options/.test(addedText) && !added.isError, addedText);

  const listed = await client.callTool({ name: 'list_pending_options', arguments: {} });
  ok('recorded options persist in KV between calls', /2 options waiting/.test(listed.content[0].text), listed.content[0].text);

  const pending = await (await fetch(`${BASE}/api/${TOKEN}/pending`, { headers: { Origin: 'http://localhost:3000' } })).json();
  ok('the planner API sees what Claude recorded', pending.offers.length === 2 && pending.offers.some((o) => o.carrier === 'Air France'));

  const ack = await (await fetch(`${BASE}/api/${TOKEN}/ack`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ ids: pending.offers.map((o) => o.id) }),
  })).json();
  ok('acknowledged options are cleared', ack.remaining === 0, JSON.stringify(ack));

  const wrong = await fetch(`${BASE}/mcp/not-the-token-0123456789`, { method: 'POST', body: '{}' });
  ok('a wrong token is refused in the real runtime too', wrong.status === 404);

  await client.close();
} catch (err) {
  failures.push(`unexpected error: ${err.stack || err}`);
} finally {
  proc.kill('SIGTERM');
}

if (failures.length) {
  console.error(`\n✗ ${failures.length} failed, ${passed} passed\n`);
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  process.exit(1);
}
console.error(`✓ ${passed} interop checks passed (official MCP client ↔ worker in workerd)`);
process.exit(0);
