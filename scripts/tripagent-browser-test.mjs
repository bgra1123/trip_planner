#!/usr/bin/env node
// Browser-level check of the TripBuddy integration against a running app.
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

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
}
const BASE = flag('url', 'http://localhost:3000');

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

await page.getByRole('button', { name: /TripBuddy capture/i }).click();

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


// The fourth capture path: a screenshot read by Claude, for pages only the
// user can see. api.anthropic.com is intercepted with a canned reply, so this
// runs the real SDK in the real browser with no key and no cost — and checks
// what actually leaves the page: the user's key, the image, the model.
{
  const shotPage = await browser.newPage();
  let apiRequest = null;
  await shotPage.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
    if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return; }
    apiRequest = { headers: req.headers(), body: JSON.parse(req.postData() || '{}') };
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
        stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'text', text: 'FLIGHT: NYC to PAR, 18:30-07:45, USD612, Air France\nHOTEL: Paris - Le Marais room, USD280/night x3' }],
      }),
    });
  });
  await shotPage.goto(BASE, { waitUntil: 'networkidle', timeout: 20_000 });
  await shotPage.getByRole('button', { name: /TripBuddy capture/i }).click();
  await shotPage.locator('input[placeholder="sk-ant-..."]').fill('sk-ant-test-key');
  // A real (1x1) PNG, so the browser's own image decode + canvas re-encode runs.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await shotPage.locator('input[type="file"]').setInputFiles({ name: 'portal.png', mimeType: 'image/png', buffer: png });
  // It does not guess what the prices cover: the button stays off until asked.
  const readBtn = shotPage.getByRole('button', { name: 'Read screenshot' });
  record('reading is disabled until the user says what the prices cover', await readBtn.isDisabled());
  await shotPage.getByLabel('What the prices in the screenshot cover').selectOption('per_traveler');
  record('per traveler also needs a traveler count', await readBtn.isDisabled());
  await shotPage.getByLabel('How many travelers').fill('2');
  record('answered: reading is enabled', await readBtn.isEnabled());
  await readBtn.click();
  await shotPage.getByText(/Found \d+ option/).waitFor({ timeout: 15_000 }).catch(() => {});

  const shotBody = await shotPage.locator('body').innerText();
  record('a screenshot is read and its options are staged for review', /Found 2 options/.test(shotBody),
    shotBody.match(/(Found .*|The API.*|Could not.*|API error.*)/)?.[0] || '(no status message)');
  record('the screenshot\'s flight reaches staging with its own currency', /NYC → PAR/.test(shotBody) && /\$1,?224|\$1224/.test(shotBody), (shotBody.match(/\$\d[\d,]*/g) || []).join(' '));
  record('per traveler x 2 doubled the flight and said so', /USD612 per traveler|USD 612 per traveler|\$612 per traveler/.test(shotBody) || /612 per traveler × 2/.test(shotBody), (shotBody.match(/[^\n]*per traveler[^\n]*/) || [''])[0]);
  record('the hotel (a room) was not doubled', /\$280|USD280/.test(shotBody));
  record('the request carries the user\'s own key, sent only to the API', apiRequest && apiRequest.headers['x-api-key'] === 'sk-ant-test-key');
  record('the request asks for the cheapest model, with no effort setting (Haiku rejects it)',
    apiRequest && apiRequest.body.model === 'claude-haiku-4-5' && !apiRequest.body.output_config);
  record('the image is re-encoded as JPEG before upload (metadata stripped)',
    apiRequest && apiRequest.body.messages[0].content[0].source.media_type === 'image/jpeg');
  record('nothing from the screenshot reaches the plan until Add',
    !(await shotPage.locator('table').filter({ has: shotPage.locator('th', { hasText: 'Group / Leg' }) }).locator('tbody tr').filter({ hasText: 'Air France' }).count()));
  await shotPage.close();
}

// The free path: page text pasted into the planner and read locally.
{
  const pastePage = await browser.newPage();
  const apiCalls = [];
  await pastePage.route('https://api.anthropic.com/**', (route) => { apiCalls.push(route.request().url()); route.abort(); });
  await pastePage.goto(BASE, { waitUntil: 'networkidle', timeout: 20_000 });
  await pastePage.getByRole('button', { name: /TripBuddy capture/i }).click();
  const pasted = ['$938', 'Delta', 'Delta', 'EWR - CDG', 'Delta Main Basic', 'Nonstop', 'Earn 5X miles on flights', '', 'Best Price',
    '12:25 AM', '28h', '9:25 AM', '$735', 'TAP', 'TAP', 'EWR - ORY', 'Discount', '1 stop', 'Earn 5X miles on flights', '',
    '5:30 PM', '7h 15m', '5:45 AM', '$962', 'Delta', 'Delta', 'JFK - CDG', 'Delta Main Basic', 'Nonstop', 'Earn 5X miles on flights', '',
    '7:30 PM', '7h 25m', '7:55 AM', '$962', 'Delta', 'Delta', 'JFK - CDG', 'Delta Main Basic', 'Nonstop'].join('\n');
  await pastePage.getByLabel('Pasted results text').fill(pasted);
  const readPaste = pastePage.getByRole('button', { name: 'Read pasted text' });
  record('pasted text is not read until the user says what the prices cover', await readPaste.isDisabled());
  await pastePage.getByLabel('What the prices in the screenshot cover').selectOption('per_traveler');
  await pastePage.getByLabel('How many travelers').fill('2');
  record('answered: reading is enabled', await readPaste.isEnabled());
  await readPaste.click();
  await pastePage.getByText(/Read 3 flights/).waitFor({ timeout: 5000 }).catch(() => {});
  const pbody = await pastePage.locator('body').innerText();
  record('three flights read, the cut-off one skipped and reported', /Read 3 flights from the pasted text; skipped 1 cut-off result/.test(pbody), (pbody.match(/Read .*/) || ['(no message)'])[0]);
  record('per traveler x 2 is applied to the shown prices', /\$1,?470/.test(pbody) && /\$1,?924/.test(pbody), (pbody.match(/\$\d[\d,]*/g) || []).join(' '));
  record('every result is one NYC → PAR leg', (pbody.match(/NYC → PAR/g) || []).length >= 3);
  record('the review list shows fare, airports and how it was totalled', /fare: Discount/.test(pbody) && /airports: EWR → ORY/.test(pbody) && /USD 735 per traveler × 2/.test(pbody), (pbody.match(/[^\n]*fare: Discount[^\n]*/) || ['(no detail line)'])[0]);
  record('the page\'s own dates are not invented when none were pasted', !/window "/.test(pbody));
  record('no AI request was made', apiCalls.length === 0, apiCalls.join(','));
  await pastePage.getByLabel('Pasted results text').fill('hello world, nothing here');
  await readPaste.click();
  await pastePage.getByText(/Couldn't find flight results/).waitFor({ timeout: 3000 }).catch(() => {});
  record('text with no flight results is refused with a way forward', /Couldn't find flight results/.test(await pastePage.locator('body').innerText()));
  await pastePage.close();
}

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

// Input cards: the guided way in. Nothing assumed; refusals are specific.
{
  const cardPage = await browser.newPage();
  cardPage.on('pageerror', (e) => pageErrors.push(String(e)));
  await cardPage.goto(BASE, { waitUntil: 'networkidle', timeout: 20_000 });
  await cardPage.getByRole('button', { name: /TripBuddy capture/i }).click();
  const card = (label) => cardPage.getByLabel(`Card: ${label}`, { exact: true });
  const addFlight = cardPage.getByRole('button', { name: 'Add flight to review list' });
  const staged = () => cardPage.locator('table').filter({ has: cardPage.locator('th', { hasText: 'Source' }) });

  await card('From').fill('New York');
  await card('To').fill('Paris');
  await card('Departs').fill('6:30 pm');
  await card('Arrives').fill('7:45 am');
  await card('Airline').fill('Air France');
  await card('Fare or class').fill('Main Basic');
  await card('Price').fill('612');
  await addFlight.click();
  let body = await cardPage.locator('body').innerText();
  record('a price with no currency is refused with a reason', /Choose the currency/.test(body) && (await staged().count()) === 0);
  await card('Currency').selectOption('USD');
  await addFlight.click();
  body = await cardPage.locator('body').innerText();
  record('a flight price with no per-traveler answer is refused', /per traveler, or the total for everyone/.test(body) && (await staged().count()) === 0);
  await card('Price is').selectOption('per_traveler');
  await addFlight.click();
  body = await cardPage.locator('body').innerText();
  record('per traveler asks how many people', /How many people are travelling/.test(body) && (await staged().count()) === 0);
  await card('Travelers').fill('2');
  await addFlight.click();
  await cardPage.getByText(/Added the flight to the review list/).waitFor({ timeout: 5000 }).catch(() => {});
  body = await cardPage.locator('body').innerText();
  record('with every answer given, the flight is staged for review', /Added the flight to the review list/.test(body) && (await staged().count()) === 1);
  record('it is one NYC → PAR leg, doubled for two travelers', /NYC → PAR/.test(body) && /\$1,?224/.test(body), (body.match(/\$\d[\d,]*/g) || []).join(' '));
  record('the review list shows the fare and how it was totalled', /fare: Main Basic/.test(body) && /USD 612 per traveler × 2/.test(body));
  record('nothing reached the plan table', !(await cardPage.locator('table').filter({ has: cardPage.locator('th', { hasText: 'Group / Leg' }) }).locator('tbody tr').filter({ hasText: 'Air France' }).count()));
  record('the form keeps the route and your answers for the next flight', (await card('From').inputValue()) === 'New York' && (await card('Currency').inputValue()) === 'USD' && (await card('Price is').inputValue()) === 'per_traveler' && (await card('Price').inputValue()) === '');

  // One sentence fills the card; the user still answers anything it can't know.
  await card('describe it in a sentence').fill('flight from New York to Paris, leaves 9 pm, lands 9:10 am, Delta, 540 dollars for two travelers');
  await cardPage.getByRole('button', { name: 'Fill the card' }).click();
  record('a sentence fills the route, times, airline and price', (await card('To').inputValue()) === 'Paris' && (await card('Departs').inputValue()) === '9:00 pm' && (await card('Airline').inputValue()) === 'Delta' && (await card('Price').inputValue()) === '540' && (await card('Currency').inputValue()) === 'USD');
  await card('Price is').selectOption('');
  await addFlight.click();
  record('"for two travelers" did not decide per traveler vs total for the user', /per traveler, or the total for everyone/.test(await cardPage.locator('body').innerText()));
  await card('Price is').selectOption('total');
  await addFlight.click();
  await cardPage.getByText(/Added the flight/).waitFor({ timeout: 3000 }).catch(() => {});
  record('answered "total", the second flight is staged at the price as given', (await staged().locator('tbody tr').count()) === 2 && /\$540/.test(await cardPage.locator('body').innerText()));

  // Hotel card: per night needs the nights; a hotel is never "per traveler".
  await cardPage.getByRole('tab', { name: 'Hotel' }).click();
  await card('describe it in a sentence').fill('Hotel Le Marais in Paris, 280 euros a night for 3 nights');
  await cardPage.getByRole('button', { name: 'Fill the card' }).click();
  record('a hotel sentence fills city, name, price, per night and nights', (await card('City').inputValue()) === 'Paris' && (await card('Hotel name').inputValue()) === 'Hotel Le Marais' && (await card('Price is').inputValue()) === 'per_night' && (await card('Nights').inputValue()) === '3');
  record('a hotel card has no per-traveler question', (await cardPage.getByLabel('Card: Travelers', { exact: true }).count()) === 0);
  await cardPage.getByRole('button', { name: 'Add hotel to review list' }).click();
  await cardPage.getByText(/Added the hotel/).waitFor({ timeout: 3000 }).catch(() => {});
  body = await cardPage.locator('body').innerText();
  const hotelRow = staged().locator('tbody tr').filter({ hasText: 'Hotel Le Marais' });
  record('the hotel is staged under its city, €280 a night for 3 nights', (await hotelRow.locator('input').first().inputValue()) === 'Paris' && /€280\/night x3/.test(await hotelRow.innerText()) && (await staged().locator('tbody tr').count()) === 3, await hotelRow.innerText());

  // Activity: a name is required; the price is for everyone.
  await cardPage.getByRole('tab', { name: 'Activity' }).click();
  await cardPage.getByRole('button', { name: 'Add activity to review list' }).click();
  record('an activity with no name is refused', /What is the activity/.test(await cardPage.locator('body').innerText()));
  await cardPage.close();
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
