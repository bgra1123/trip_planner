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

// Where bank-portal captures are forwarded, so the aggregator can merge them
// with API results later — including when this browser tab is long closed.
// Best-effort only: the extension works perfectly well with no backend, and a
// failed post is never surfaced as an error.
const DEFAULT_BACKEND = 'http://localhost:8787';

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

// Forward to the aggregator's ingest endpoint. Only captures from a source
// worth keeping server-side go here — a bank portal is the case that matters,
// since nothing but this extension can ever reach it.
async function forwardToBackend(source, offers, overrides) {
  if (!source || !offers.length) return;
  const options = await readOptions();
  if (options.backendEnabled === false) return;
  const base = (options.backendUrl || DEFAULT_BACKEND).replace(/\/+$/, '');
  const first = offers[0] || {};
  try {
    await fetch(`${base}/api/flights/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source,
        offers,
        searchParams: {
          from: (overrides && overrides.from) || first.from || '',
          to: (overrides && overrides.to) || first.to || '',
          date: (overrides && overrides.date) || '',
        },
      }),
    });
  } catch (err) {
    // No backend running is the normal case, not a problem worth reporting.
  }
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
          isBankPortal: scrapers.BANK_PORTALS.indexOf(site.id) !== -1,
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
        if (result.added) {
          await pushToPlanner({ type: 'PUSH_OFFERS', offers });
          if (message.isBankPortal) await forwardToBackend(message.site, offers, message.overrides);
        }
        sendResponse({ ok: true, ...result });
        break;
      }
      case 'PAGE_READY': {
        sendResponse({ ok: true, version: version(), offers: await readOffers() });
        break;
      }
      case 'PAGE_REQUEST_OFFERS': {
        sendResponse({ ok: true, offers: await readOffers() });
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
        const [offers, captures, options, tabs] = await Promise.all([
          readOffers(), readCaptures(), readOptions(), plannerTabs(),
        ]);
        sendResponse({ ok: true, version: version(), offers, captures, options, plannerTabs: tabs.length });
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
        if (result.added) {
          await pushToPlanner({ type: 'PUSH_OFFERS', offers });
          if (reply && reply.isBankPortal) await forwardToBackend(reply.site, offers, message.overrides);
        }
        sendResponse({ ok: true, captured: offers.length, site: reply && reply.site, ...result });
        break;
      }
      case 'SEND_OFFERS_TO_PLANNER': {
        const offers = await readOffers();
        if (!offers.length) { sendResponse({ ok: true, delivered: 0, count: 0 }); break; }
        sendResponse({ ok: true, delivered: await pushToPlanner({ type: 'PUSH_OFFERS', offers }), count: offers.length });
        break;
      }
      // Selection captures reach the planner as trip-notes lines, which the
      // page parses with its own linesToRows() — the extension never has to
      // reimplement the notes grammar.
      case 'SEND_NOTES_TO_PLANNER': {
        const notes = String(message.notes || '');
        if (!notes.trim()) { sendResponse({ ok: true, delivered: 0 }); break; }
        sendResponse({ ok: true, delivered: await pushToPlanner({ type: 'PUSH_NOTES', notes }) });
        break;
      }
      default:
        sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
    }
  })().catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));

  return true; // keep the channel open for the async reply
});

refreshBadge();
