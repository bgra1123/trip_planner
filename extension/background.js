/* global chrome, importScripts, TripCapture */
// Service worker: the extension's staging area for both capture paths.
//
//   selection captures — text the user right-clicked on any page. Free-form,
//                        reviewed and corrected in the popup, handed over as
//                        trip-notes lines.
//   scraped offers     — structured rows lifted from a supported booking or
//                        bank travel portal by content.js.
//
// Both are staged here rather than pushed straight into the plan: the
// planner tab may not even be open, and the user should decide what enters
// their itinerary. MV3 service workers are killed between events, so nothing
// lives in memory — state is chrome.storage.

importScripts('lib/capture.js');

const OFFERS_KEY = 'tripagent.offers';
const CAPTURES_KEY = 'captures';
const OPTIONS_KEY = 'tripagent.options';
const MAX_OFFERS = 200;
const MENU_ID = 'trip-planner-capture';

// ---- TripBuddy server -------------------------------------------------------
// The one place trips live. Captures are posted to whichever trip is open in
// the planner and wait there for the user's Add, so they show up on any
// device and Claude can see them — and no planner tab needs to be open. If it
// is unset or unreachable we fall back to pushing into an open planner tab,
// exactly as before.
const CONNECTOR_KEY = 'tripagent:connector-url';

// https://host/mcp/TOKEN  ->  https://host/api/TOKEN
function apiBaseOf(connectorUrl) {
  try {
    var url = new URL(String(connectorUrl || '').trim());
    var match = url.pathname.match(/^\/mcp\/([^/]+)\/?$/);
    var local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (!match || (url.protocol !== 'https:' && !local)) return null;
    return url.origin + '/api/' + match[1];
  } catch (err) {
    return null;
  }
}

async function readConnector() {
  const store = await chrome.storage.local.get(CONNECTOR_KEY);
  return typeof store[CONNECTOR_KEY] === 'string' ? store[CONNECTOR_KEY] : '';
}

// Post a capture to the open trip. Resolves { ok, title, recorded } or
// { ok: false, error, notConfigured }.
async function sendToServer(payload) {
  const url = await readConnector();
  const base = apiBaseOf(url);
  if (!base) return { ok: false, notConfigured: true, error: 'TripBuddy is not set up in this extension.' };
  let res;
  try {
    res = await fetch(base + '/trips/active/offers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { ok: false, error: 'Could not reach TripBuddy.' };
  }
  let body = null;
  try { body = await res.json(); } catch (err) { /* non-JSON error page */ }
  if (res.ok && body) return { ok: true, title: body.title, recorded: body.recorded };
  if (res.status === 404) return { ok: false, error: 'TripBuddy did not recognize the saved URL.' };
  return { ok: false, error: (body && body.message) || ('TripBuddy answered ' + res.status + '.') };
}

const PLANNER_URLS = [
  'http://localhost:3000/*',
  'http://127.0.0.1:3000/*',
  'https://bgra1123.github.io/trip_planner/*',
];

// Scraped offers go in session storage: they are bulky, reproducible by
// re-scraping, and not worth writing to the profile on disk. Selection
// captures are hand-corrected work, so they live in local storage and
// survive a browser restart.
function offerArea() {
  return chrome.storage.session || chrome.storage.local;
}

async function readOffers() {
  const store = await offerArea().get(OFFERS_KEY);
  return Array.isArray(store[OFFERS_KEY]) ? store[OFFERS_KEY] : [];
}

async function readCaptures() {
  const store = await chrome.storage.local.get(CAPTURES_KEY);
  return Array.isArray(store[CAPTURES_KEY]) ? store[CAPTURES_KEY] : [];
}

async function writeOffers(offers) {
  await offerArea().set({ [OFFERS_KEY]: offers.slice(0, MAX_OFFERS) });
  await refreshBadge();
}

async function writeCaptures(captures) {
  await chrome.storage.local.set({ [CAPTURES_KEY]: captures });
  await refreshBadge();
}

async function readOptions() {
  const store = await chrome.storage.local.get(OPTIONS_KEY);
  return store[OPTIONS_KEY] || { from: '', to: '', window: '' };
}

// One badge for both queues — the user cares how much is waiting, not which
// mechanism produced it.
async function refreshBadge() {
  const [offers, captures] = await Promise.all([readOffers(), readCaptures()]);
  const count = offers.length + captures.length;
  chrome.action.setBadgeText({ text: count ? String(Math.min(count, 999)) : '' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: '#2563eb' }).catch(() => {});
}

// Same identity rule the web app uses, so an offer re-captured on a page
// reload does not pile up a second copy here either.
function offerKey(offer) {
  return [
    offer.kind || '',
    offer.from || '', offer.to || '', offer.place || '',
    offer.departure || '', offer.arrival || '',
    typeof offer.price === 'object' && offer.price ? JSON.stringify(offer.price) : (offer.price || ''),
    offer.label || '',
  ].join('|');
}

// ---- what a bank portal's price covers: the user says, we never guess ------
// Capital One / Amex flight prices may be per traveler or for everyone, and the
// page rarely says which. The planner adds prices up as shown, so a wrong
// assumption either way is a silently wrong total. So bank-portal flights are
// held back until the user answers in the popup, and only then sent.
const BANK_SOURCES = ['capital-one', 'amex'];
const PRICING_KEY = 'tripagent.pricing';

async function readPricing() {
  const store = await chrome.storage.local.get(PRICING_KEY);
  return store[PRICING_KEY] && typeof store[PRICING_KEY] === 'object' ? store[PRICING_KEY] : {};
}

const needsBasis = (o) => !!o && o.kind === 'flight' && BANK_SOURCES.indexOf(o.source) !== -1 && !!o.price;

// "$1,062" x 2 -> "$2,124". Anything that isn't a plain symbol-or-code + amount
// can't be totalled, so it is held back rather than sent wrong.
function scalePrice(price, n) {
  if (typeof price !== 'string') return null;
  const m = /^\s*([€$£₺]|[A-Z]{3}\s?)\s?(\d[\d,]*(?:\.\d+)?)\s*$/.exec(price);
  if (!m) return null;
  const amount = parseFloat(m[2].replace(/,/g, '')) * n;
  return { price: m[1] + amount.toLocaleString('en-US', { maximumFractionDigits: 2 }), each: m[1] + m[2] };
}

// Split offers into those that can be sent now (everything that isn't a
// bank-portal flight, and bank-portal flights whose basis the user confirmed,
// totalled accordingly) and those still waiting for an answer.
async function applyPricing(offers) {
  const pricing = await readPricing();
  const ready = [];
  const held = [];
  offers.forEach((o) => {
    if (!needsBasis(o)) { ready.push(o); return; }
    const p = pricing[o.source];
    if (!p) { held.push(o); return; }
    if (p.basis === 'total' || !(p.travelers >= 2)) { ready.push(o); return; }
    const scaled = scalePrice(o.price, p.travelers);
    if (!scaled) { held.push(o); return; }
    ready.push({
      ...o,
      price: scaled.price,
      detail: [o.detail, scaled.each + ' per traveler \u00d7 ' + p.travelers].filter(Boolean).join(' \u00b7 '),
    });
  });
  return { ready, held };
}

function heldSources(held) {
  const counts = {};
  held.forEach((o) => { counts[o.source] = (counts[o.source] || 0) + 1; });
  return Object.keys(counts).map((source) => ({ source, count: counts[source] }));
}

// Deliver offers: TripBuddy first; an open planner tab only if that fails.
async function deliver(offers) {
  if (!offers.length) return { server: { ok: false, notConfigured: true }, delivered: 0 };
  const server = await sendToServer({ offers, source: 'extension' });
  const delivered = server.ok ? 0 : await pushToPlanner({ type: 'PUSH_OFFERS', offers });
  return { server, delivered };
}

async function addOffers(incoming) {
  const existing = await readOffers();
  const seen = new Set(existing.map(offerKey));
  const fresh = incoming.filter((o) => {
    const key = offerKey(o);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!fresh.length) return { added: 0, total: existing.length };
  const merged = [...fresh, ...existing];
  await writeOffers(merged);
  return { added: fresh.length, total: merged.length };
}

async function plannerTabs() {
  try {
    return await chrome.tabs.query({ url: PLANNER_URLS });
  } catch (err) {
    return [];
  }
}

// Push into every open planner tab. Tabs with no bridge yet (still loading)
// simply reject the message; the page asks again on READY.
async function pushToPlanner(message) {
  const tabs = await plannerTabs();
  let delivered = 0;
  await Promise.all(tabs.map(async (tab) => {
    try {
      await chrome.tabs.sendMessage(tab.id, message);
      delivered += 1;
    } catch (err) { /* no bridge in that tab yet */ }
  }));
  return delivered;
}

function version() {
  return chrome.runtime.getManifest().version;
}

// ---- selection captures (context menu) -----------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Add “%s” to Trip Planner',
    contexts: ['selection'],
  }, () => { void chrome.runtime.lastError; });
  await refreshBadge();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;
  const text = TripCapture.cleanText(info.selectionText);
  const captures = await readCaptures();
  captures.push({
    id: `c${Date.now()}${Math.floor(Math.random() * 1000)}`,
    text,
    category: TripCapture.guessCategory(text, tab && tab.title, tab && tab.url),
    sourceTitle: tab ? tab.title : '',
    sourceUrl: tab ? tab.url : '',
    createdAt: new Date().toISOString(),
  });
  await writeCaptures(captures);
});

// ---- capture on any page -------------------------------------------------
// Only a handful of sites get a content script declared up front, because that
// means running on every page load forever. Everywhere else the scraper is
// injected on demand: opening this popup grants `activeTab` for the tab the
// user is looking at, which is exactly the scope needed and nothing wider.
//
// So capture works on whatever page is open, without the extension asking for
// permission to read every site the user ever visits.
async function captureFromTab(tab, overrides) {
  // A declared content script is already there on the known sites; use it, so
  // its debounce state and page observation stay intact.
  try {
    const reply = await chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_NOW', overrides });
    if (reply) return reply;
  } catch (err) {
    // No content script in this tab — fall through and inject one.
  }

  const url = tab.url || '';
  // Pages no extension may touch, whatever its permissions. Saying which is
  // more useful than a generic failure the user can only guess at.
  if (/^(chrome|edge|about|moz-extension|chrome-extension|devtools|view-source):/i.test(url)
      || /^https:\/\/chromewebstore\.google\.com/i.test(url)
      || /^https:\/\/chrome\.google\.com\/webstore/i.test(url)) {
    throw new Error('Chrome blocks extensions on this page. Open the travel site in a normal tab.');
  }

  try {
    // Two steps on purpose: the file defines TripAgentScrapers in this
    // extension's isolated world, and the function below then runs in that
    // same world, so it can call it.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['scrapers.js'] });
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [overrides],
      func: (opts) => {
        // eslint-disable-next-line no-undef
        const scrapers = TripAgentScrapers;
        const site = scrapers.detectSite(location.href, document);
        return {
          offers: scrapers.scrape(document, location.href, opts),
          site: site.id,
          kind: site.kind,
          sourceUrl: location.href,
        };
      },
    });
    return injected && injected.result ? injected.result : { offers: [] };
  } catch (err) {
    // activeTab covers the top frame of the invoked tab; anything else (a
    // sandboxed frame, a page still loading) lands here.
    throw new Error(`Couldn't read this page (${err.message}). Right-click a price to capture it by hand.`);
  }
}

// ---- message router ------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return undefined;

  (async () => {
    switch (message.type) {
      case 'CAPTURED': {
        const offers = message.offers || [];
        const result = await addOffers(offers);
        const { ready, held } = await applyPricing(offers);
        // Only when something new was found: automatic capture fires on every
        // page change, and the same results shouldn't be re-posted each time.
        if (result.added) await deliver(ready);
        sendResponse({ ok: true, held: heldSources(held), ...result });
        break;
      }
      case 'PAGE_READY': {
        sendResponse({ ok: true, version: version(), offers: (await applyPricing(await readOffers())).ready });
        break;
      }
      case 'PAGE_REQUEST_OFFERS': {
        sendResponse({ ok: true, offers: (await applyPricing(await readOffers())).ready });
        break;
      }
      case 'PAGE_CLEAR_OFFERS':
      case 'CLEAR_OFFERS': {
        await writeOffers([]);
        sendResponse({ ok: true, offers: [] });
        break;
      }
      case 'CLEAR_CAPTURES': {
        await writeCaptures([]);
        sendResponse({ ok: true });
        break;
      }
      case 'SET_CAPTURES': {
        await writeCaptures(Array.isArray(message.captures) ? message.captures : []);
        sendResponse({ ok: true });
        break;
      }
      case 'GET_STATE': {
        const [offers, captures, options, tabs, connectorUrl, pricing] = await Promise.all([
          readOffers(), readCaptures(), readOptions(), plannerTabs(), readConnector(), readPricing(),
        ]);
        const { held } = await applyPricing(offers);
        sendResponse({ ok: true, version: version(), offers, captures, options, plannerTabs: tabs.length, connectorUrl, pricing, held: heldSources(held) });
        break;
      }
      case 'SET_CONNECTOR': {
        const url = String(message.url || '').trim();
        if (url && !apiBaseOf(url)) { sendResponse({ ok: false, error: 'That is not a TripBuddy URL \u2014 it should look like https://\u2026/mcp/<token>.' }); break; }
        if (url) await chrome.storage.local.set({ [CONNECTOR_KEY]: url });
        else await chrome.storage.local.remove(CONNECTOR_KEY);
        sendResponse({ ok: true });
        break;
      }
      // The planner page announces its connector. It only fills in a blank:
      // a URL the user chose in the popup is never overwritten by a page.
      case 'PAGE_CONNECTOR': {
        if (!(await readConnector()) && apiBaseOf(message.url)) {
          await chrome.storage.local.set({ [CONNECTOR_KEY]: String(message.url).trim() });
        }
        sendResponse({ ok: true });
        break;
      }
      // The user's answer to "per traveler or total?" for one portal. Held
      // offers from it are sent now; anything captured later is not asked again
      // until they choose Change.
      case 'CONFIRM_PRICING': {
        const basis = message.basis;
        const travelers = Math.round(Number(message.travelers));
        if (BANK_SOURCES.indexOf(message.source) === -1) { sendResponse({ ok: false, error: 'Unknown portal.' }); break; }
        if (basis !== 'total' && basis !== 'per_traveler') { sendResponse({ ok: false, error: 'Choose per traveler or total for everyone.' }); break; }
        if (basis === 'per_traveler' && !(travelers >= 1 && travelers <= 20)) { sendResponse({ ok: false, error: 'Say how many people are travelling.' }); break; }
        const pricing = await readPricing();
        pricing[message.source] = basis === 'total' ? { basis } : { basis, travelers };
        await chrome.storage.local.set({ [PRICING_KEY]: pricing });
        const queued = (await readOffers()).filter((o) => o.source === message.source);
        const { ready } = await applyPricing(queued);
        const sent = await deliver(ready);
        sendResponse({ ok: true, count: ready.length, server: sent.server, delivered: sent.delivered });
        break;
      }
      case 'CLEAR_PRICING': {
        const pricing = await readPricing();
        delete pricing[message.source];
        await chrome.storage.local.set({ [PRICING_KEY]: pricing });
        sendResponse({ ok: true });
        break;
      }
      case 'SET_OPTIONS': {
        await chrome.storage.local.set({ [OPTIONS_KEY]: message.options || {} });
        sendResponse({ ok: true });
        break;
      }
      case 'CAPTURE_ACTIVE_TAB': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) { sendResponse({ ok: false, error: 'No active tab.' }); break; }
        let reply;
        try {
          reply = await captureFromTab(tab, message.overrides || {});
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
          break;
        }
        const offers = (reply && reply.offers) || [];
        const result = await addOffers(offers);
        // TripBuddy first (dedupes server-side, so everything found is sent);
        // bank-portal flights wait until the user says what their prices cover.
        const { ready, held } = await applyPricing(offers);
        const sent = ready.length ? await deliver(ready) : { server: { ok: false, notConfigured: true }, delivered: 0 };
        sendResponse({ ok: true, captured: offers.length, site: reply && reply.site, server: sent.server, held: heldSources(held), ...result });
        break;
      }
      case 'SEND_OFFERS_TO_PLANNER': {
        const queued = await readOffers();
        if (!queued.length) { sendResponse({ ok: true, delivered: 0, count: 0 }); break; }
        const { ready, held } = await applyPricing(queued);
        const sent = await deliver(ready);
        sendResponse({ ok: true, server: sent.server, delivered: sent.delivered, count: ready.length, held: heldSources(held) });
        break;
      }
      // Selection captures reach the planner as trip-notes lines, which the
      // page parses with its own linesToRows() — the extension never has to
      // reimplement the notes grammar.
      case 'SEND_NOTES_TO_PLANNER': {
        const notes = String(message.notes || '');
        if (!notes.trim()) { sendResponse({ ok: true, delivered: 0 }); break; }
        const server = await sendToServer({ notes, source: 'selection' });
        sendResponse({ ok: true, server, delivered: server.ok ? 0 : await pushToPlanner({ type: 'PUSH_NOTES', notes }) });
        break;
      }
      default:
        sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
    }
  })().catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));

  return true; // keep the channel open for the async reply
});

refreshBadge();
