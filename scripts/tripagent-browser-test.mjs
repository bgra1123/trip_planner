#!/usr/bin/env node
// Browser-level check of the TripAgent integration against a running app.
// The Node self-test covers the data pipeline; this covers the parts only a
// real browser has — the postMessage bridge, its origin checks, and the
// staging panel's refusal to touch the plan until the user says so.
//
// Playwright is not a dependency of this project (the app itself does not
// need it), so this script skips cleanly when it is not installed.
//
//   npm start                                  # in another terminal
//   node scripts/tripagent-browser-test.mjs
//   node scripts/tripagent-browser-test.mjs --url http://localhost:4322/app/
//   node scripts/tripagent-browser-test.mjs --backend    # also test /api/flights

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
}
const BASE = flag('url', 'http://localhost:3000');
const WITH_BACKEND = args.includes('--backend');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (err) {
  console.error('Playwright is not installed — skipping the browser test.');
  console.error('  npx playwright install chromium && npm i -D playwright');
  process.exit(0);
}

// The same page on a different host is a different origin, which is all we
// need to prove the bridge's origin check actually rejects a foreign frame.
function crossOriginUrl(url) {
  const parsed = new URL(url);
  parsed.hostname = parsed.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  return parsed.toString();
}

const results = [];
const record = (name, pass, detail) => results.push({ name, pass, detail });

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.addInitScript(() => {
  window.__tripagentSent = [];
  window.addEventListener('message', (e) => {
    if (e.data && e.data.source === 'tripagent-page') window.__tripagentSent.push(e.data.type);
  });
});

try {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20_000 });
} catch (err) {
  console.error(`Could not load ${BASE} — is the app running? (npm start)`);
  await browser.close();
  process.exit(1);
}

record('page announces READY to the extension on mount',
  (await page.evaluate(() => window.__tripagentSent)).includes('READY'));

// The capture panel must be usable without opening the data-entry tools.
const editCollapsed = await page.getByRole('button', { name: /Edit trip data/ }).count();
record('the capture panel is reachable with the edit panel collapsed', editCollapsed > 0);

await page.getByRole('button', { name: /TripAgent capture/i }).click();

const addAll = () => page.getByRole('button', { name: /Add all \d+ to table/ });
async function addAllLabel() {
  return (await addAll().count()) ? addAll().innerText() : '(nothing staged)';
}

async function postOffers(offers, extra = {}) {
  await page.evaluate(([list, rest]) => {
    window.postMessage({ source: 'tripagent-extension', protocol: 'tripagent/v1', type: 'OFFERS', offers: list, ...rest }, window.location.origin);
  }, [offers, extra]);
  await page.waitForTimeout(350);
}

const FLIGHT = {
  kind: 'flight', from: 'IST', to: 'MUC', departure: '06:45', arrival: '11:30',
  carrier: 'Turkish Airlines', price: '€2,100', stops: 0, window: '14-19 Aug',
  sourceUrl: 'https://www.kayak.com/flights/IST-MUC/2026-08-14',
};
const HOTEL = {
  kind: 'hotel', place: 'Milan', label: 'Family room near Duomo',
  price: { amount: 140, currency: 'EUR' }, perNight: true, nights: 3,
};

await postOffers([FLIGHT, HOTEL], { captureSource: 'kayak' });
record('both offers are staged', /Add all 2 to table/.test(await addAllLabel()), await addAllLabel());

await postOffers([FLIGHT], { captureSource: 'kayak' });
record('a re-capture does not duplicate', /Add all 2 to table/.test(await addAllLabel()), await addAllLabel());

// The second capture path: trip-notes lines from a reviewed text selection.
await page.evaluate(() => {
  window.postMessage({
    source: 'tripagent-extension', protocol: 'tripagent/v1', type: 'NOTES',
    captureSource: 'selection',
    notes: 'RATE: TRY 0.01814\nFLIGHT: SAW to VIE, 08:00-10:15, TRY38000, Pegasus',
  }, window.location.origin);
});
await page.waitForTimeout(400);
const afterNotes = await addAllLabel();
record('a NOTES envelope is parsed and staged', /Add all 3 to table/.test(afterNotes), afterNotes);
const notesBody = await page.locator('body').innerText();
record('a captured lira fare keeps its currency', /\u20ba38000|₺38000/.test(notesBody));

// Envelopes that fail any part of the contract must be dropped silently.
await page.evaluate(() => {
  const origin = window.location.origin;
  window.postMessage({ source: 'tripagent-extension', protocol: 'tripagent/v1', type: 'OFFERS', offers: 'not-an-array' }, origin);
  window.postMessage({ source: 'tripagent-extension', protocol: 'wrong/v9', type: 'OFFERS', offers: [{ kind: 'flight', from: 'XX', to: 'YY', price: '€99999' }] }, origin);
  window.postMessage({ source: 'someone-else', protocol: 'tripagent/v1', type: 'OFFERS', offers: [{ kind: 'flight', from: 'XX', to: 'YY', price: '€88888' }] }, origin);
});
await page.waitForTimeout(350);
record('malformed, wrong-protocol and wrong-source envelopes are ignored',
  /Add all 3 to table/.test(await addAllLabel()), await addAllLabel());

// A frame on another origin must not be able to inject offers.
await page.evaluate((url) => {
  const frame = document.createElement('iframe');
  frame.src = url;
  frame.id = 'tripagent-foreign-frame';
  frame.style.display = 'none';
  document.body.append(frame);
}, crossOriginUrl(BASE));
await page.waitForTimeout(800);
await page.frameLocator('#tripagent-foreign-frame').locator('body').evaluate(() => {
  window.parent.postMessage({ source: 'tripagent-extension', protocol: 'tripagent/v1', type: 'OFFERS',
    offers: [{ kind: 'flight', from: 'EVL', to: 'HAX', price: '€1' }] }, '*');
}).catch(() => { /* the frame may be blocked from loading at all, which is also a pass */ });
await page.waitForTimeout(400);

const beforeAdd = await page.locator('body').innerText();
record('a cross-origin frame cannot inject offers',
  /Add all 3 to table/.test(await addAllLabel()) && !/EVL/.test(beforeAdd), await addAllLabel());

// The editable plan table lives inside the collapsible "Edit trip data"
// panel, so it has to be opened before the rows can be counted. The capture
// panel deliberately sits outside it — an offer can arrive while this is shut.
const editToggle = page.getByRole('button', { name: /Edit trip data|Hide trip data/ });
if (await editToggle.count()) {
  const label = await editToggle.innerText();
  if (/Edit trip data/.test(label)) await editToggle.click();
  await page.waitForTimeout(300);
}
const planTable = page.locator('table').filter({ has: page.locator('th', { hasText: 'Group / Leg' }) });
const rowsBefore = await planTable.locator('tbody tr').count();
record('staged offers do not reach the plan on their own',
  !(await planTable.locator('tbody tr').filter({ hasText: 'Turkish Airlines' }).count()));

await addAll().click();
await page.waitForTimeout(400);
const rowsAfter = await planTable.locator('tbody tr').count();
const afterAdd = await page.locator('body').innerText();

record('adding grows the plan table by three rows', rowsAfter === rowsBefore + 3, `${rowsBefore} -> ${rowsAfter}`);
record('the captured flight lands in the table', /Turkish Airlines/.test(afterAdd));
record('the window tag survives into the table', /14-19 Aug/.test(afterAdd));
record('the staging list empties once added', !/Add all \d+ to table/.test(afterAdd));

if (WITH_BACKEND) {
  const api = flag('api', 'http://localhost:8787');

  // Stand in for the extension scraping an authenticated bank portal: post
  // captured flights to the aggregator, then confirm a search in the app
  // surfaces them alongside the API results. This is the whole point of the
  // ingest path — the server can never reach that portal itself.
  let ingested = false;
  try {
    const res = await fetch(`${api}/api/flights/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'capital-one',
        searchParams: { from: 'IST', to: 'MUC', date: '2026-08-14' },
        flights: [{
          kind: 'flight', from: 'IST', to: 'MUC', departure: '10:30', arrival: '12:20',
          carrier: 'Bank Portal Air', stops: 0, price: { amount: 111, currency: 'EUR' },
        }],
      }),
    });
    ingested = res.ok;
  } catch (err) { /* no backend running */ }
  record('bank-portal data can be ingested by the aggregator', ingested,
    ingested ? '' : `no backend at ${api} — start it with npm run backend`);

  // Scoped and exact: the planner's activity checkboxes carry labels like
  // "Duomo rooftop terraces", and a loose substring match on "To" hits them.
  const searchForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Search flights' }) });
  await searchForm.getByLabel('From', { exact: true }).fill('IST');
  await searchForm.getByLabel('To', { exact: true }).fill('MUC');
  await searchForm.getByLabel('Date', { exact: true }).fill('2026-08-14');
  await searchForm.getByLabel('Window tag', { exact: true }).fill('14-19 Aug');
  await page.getByRole('button', { name: 'Search flights' }).click();
  await page.waitForTimeout(2500);
  const searched = await page.locator('body').innerText();

  record('the backend returns offers into staging', /Add all \d+ to table/.test(searched),
    searched.includes('Cannot reach') ? 'backend unreachable — start it with npm run backend' : '');
  record('ingested bank-portal data reaches the app', /Bank Portal Air/.test(searched),
    searched.includes('capital-one') ? 'source shown but carrier missing' : '');
  record('the answering sources are named', /Answered by/.test(searched));
  record('the cheapest offer is ranked first',
    searched.indexOf('Bank Portal Air') !== -1);
}

record('no uncaught page errors', pageErrors.length === 0, pageErrors.join('\n'));

await browser.close();

let failed = 0;
results.forEach((r) => {
  if (!r.pass) failed += 1;
  console.error(`${r.pass ? '✓' : '✗'} ${r.name}${!r.pass && r.detail ? `\n    ${r.detail}` : ''}`);
});
console.error(failed ? `\n✗ ${failed} of ${results.length} failed` : `\n✓ ${results.length} browser checks passed`);
process.exit(failed ? 1 : 0);
