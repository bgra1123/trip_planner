/* global chrome */
// Service worker: the extension's staging area.
//
// Captured offers are held here (not pushed straight into the planner)
// because the planner tab may not be open yet, and because the user should
// decide what enters their plan. MV3 service workers are killed between
// events, so nothing lives in memory — state is chrome.storage.

const STORE_KEY = 'tripagent.offers';
const OPTIONS_KEY = 'tripagent.options';
const MAX_OFFERS = 200;

const PLANNER_URLS = [
  'http://localhost:3000/*',
  'http://127.0.0.1:3000/*',
  'https://bgra1123.github.io/trip_planner/*',
];

// chrome.storage.session keeps captures out of the profile on disk, but is
// cleared on browser restart; fall back to local where it is unavailable.
function area() {
  return chrome.storage.session || chrome.storage.local;
}

async function readOffers() {
  const store = await area().get(STORE_KEY);
  return Array.isArray(store[STORE_KEY]) ? store[STORE_KEY] : [];
}

async function writeOffers(offers) {
  await area().set({ [STORE_KEY]: offers.slice(0, MAX_OFFERS) });
  updateBadge(offers.length);
}

async function readOptions() {
  const store = await chrome.storage.local.get(OPTIONS_KEY);
  return store[OPTIONS_KEY] || { from: '', to: '', window: '' };
}

function updateBadge(count) {
  const text = count > 0 ? String(Math.min(count, 999)) : '';
  chrome.action.setBadgeText({ text }).catch(() => {});
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

// Push into every open planner tab. Tabs that have no bridge yet (still
// loading) simply reject the message; the page asks again on READY.
async function pushToPlanner(offers) {
  if (!offers.length) return 0;
  const tabs = await plannerTabs();
  let delivered = 0;
  await Promise.all(tabs.map(async (tab) => {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'PUSH_OFFERS', offers });
      delivered += 1;
    } catch (err) { /* no bridge in that tab yet */ }
  }));
  return delivered;
}

function version() {
  return chrome.runtime.getManifest().version;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return undefined;

  (async () => {
    switch (message.type) {
      case 'CAPTURED': {
        const result = await addOffers(message.offers || []);
        if (result.added) await pushToPlanner(message.offers);
        sendResponse({ ok: true, ...result });
        break;
      }
      case 'PAGE_READY': {
        const offers = await readOffers();
        sendResponse({ ok: true, version: version(), offers });
        break;
      }
      case 'PAGE_REQUEST_OFFERS': {
        sendResponse({ ok: true, offers: await readOffers() });
        break;
      }
      case 'PAGE_CLEAR_OFFERS':
      case 'CLEAR': {
        await writeOffers([]);
        sendResponse({ ok: true, offers: [] });
        break;
      }
      case 'GET_STATE': {
        const [offers, options, tabs] = await Promise.all([readOffers(), readOptions(), plannerTabs()]);
        sendResponse({ ok: true, version: version(), offers, options, plannerTabs: tabs.length });
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
          reply = await chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_NOW', overrides: message.overrides || {} });
        } catch (err) {
          sendResponse({ ok: false, error: 'This page has no TripAgent scraper — open a supported booking site.' });
          break;
        }
        const offers = (reply && reply.offers) || [];
        const result = await addOffers(offers);
        if (result.added) await pushToPlanner(offers);
        sendResponse({ ok: true, captured: offers.length, ...result });
        break;
      }
      case 'SEND_TO_PLANNER': {
        const offers = await readOffers();
        const delivered = await pushToPlanner(offers);
        sendResponse({ ok: true, delivered, count: offers.length });
        break;
      }
      default:
        sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
    }
  })().catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));

  return true; // keep the channel open for the async reply
});

chrome.runtime.onInstalled.addListener(async () => {
  updateBadge((await readOffers()).length);
});
