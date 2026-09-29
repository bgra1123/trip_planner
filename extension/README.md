# TripAgent Capture (browser extension)

Gets prices out of a browser tab and into your trip plan. **It works on
whatever page you have open** — there is no list of supported sites you have to
stay inside.

| | Right-click a price | Capture this page | Automatic |
|---|---|---|---|
| **Works on** | any page | any page | known travel sites |
| **You do** | select, right-click | click one button | nothing |
| **You get** | a text line you review and fix | structured route/time/price rows | the same rows |
| **Breaks when** | never | a page has no readable prices | a site redesigns |

Only the last row is site-specific, and it is just a convenience: on Kayak or
Booking.com the results are picked up as they load, so there is nothing to
click. Everywhere else, *Capture this page* reads the page you are on.

That works without the extension asking for access to every site you visit.
Clicking the toolbar icon grants it `activeTab` — permission for that one tab,
for that one moment — and the scraper is injected there on demand. Nothing runs
on your other tabs.

## Install

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this `extension/` folder

Firefox: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** →
pick `manifest.json` (temporary add-ons are removed when Firefox restarts).

The toolbar badge shows how many items are waiting across both queues.

## Selected prices

1. Select the price/fare/rate text on any page
2. Right-click → **Add "…" to Trip Planner**
3. Open the popup and, for each capture, pick the category
   (Flight/Train/Hotel/Activity/Note) and clean up the text. Anything with no
   recognizable price is flagged so you don't carry over a dud line.
4. Either **Copy as trip notes** and paste into the planner's notes box, or
   **Send to planner** to push straight into an open planner tab.

Captures are hand-corrected work, so they live in `chrome.storage.local` and
survive a browser restart. They are sent as trip-notes lines, which the page
parses with its own notes grammar — the extension never reimplements it.

## Scraped offers

Open any flight or hotel search and click **Capture this page**. On the known
travel sites you don't even need that — results are picked up as they render
(debounced, and only when they actually changed) and pushed to any open planner
tab.

On a site nobody wrote an adapter for, the extension works out what the page is
selling from its URL and title, so a small hotel's booking page produces *stay*
rows rather than flights. A page with priced rows and no clock times still
captures; on the known flight sites two times are required, or their filter and
navigation chrome would be captured as results.

Some pages are off limits to every extension, whatever its permissions —
`chrome://` pages, the Web Store, DevTools. The popup says so plainly rather
than failing silently.

Use the popup's fields when a page's URL doesn't carry the route:

- **From / To / Window** — overrides. These beat whatever the URL said and are
  remembered. `Window` is the planner's date-window label (`14-19 Aug`), which
  keeps two rounds of price research from being combined with each other.
- **Capture this page** — scrape exactly what's on screen now.
- **Send to planner** / **Clear**.

Scraped offers are reproducible by re-scraping, so they live in
`chrome.storage.session` and are dropped on browser restart.

### Sites with automatic capture

Google Flights, Kayak, Skyscanner, Booking.com, Trainline, DB, and the
Capital One and Amex travel portals — see `matches` in `manifest.json`. These
are the only ones where a content script runs on page load; everywhere else
capture happens when you ask for it. Adding a site to that list buys automatic
capture and a tuned adapter, not the ability to capture there at all.

Bank travel portals require you to be logged in. The extension runs in your
browser with your session, so authentication is simply yours — nothing about
your credentials is read, stored or transmitted, and the backend never sees
them.

### How scraping works

Three strategies, in order (`scrapers.js`):

1. **Portal adapters** — for the bank travel portals, which render a
   predictable card layout worth reading field by field.
2. **JSON-LD** — the `application/ld+json` blocks sites publish for search
   engines. Stable and unambiguous, but not on every page.
3. **A rendered-text heuristic** — walk candidate result containers and keep
   the ones holding a price. On a known travel site two clock times are also
   required; on an unrecognized page the price alone qualifies a row, since
   there is no structure there to lean on.

Nothing keys off a class name alone, because those change weekly. The
heuristic is deliberately conservative, so a redesign usually means "captured
nothing" rather than "captured nonsense". Normalization and dedupe happen in
the web app, so a sloppy capture becomes a row you fix by hand — never a
number you can't see.

### Adding a site

Add an entry to `SITES` in `scrapers.js`:

```js
{ id: 'my-site', kind: 'flight', test: /mysite\.com\/search/i,
  rootSelectors: ['div[data-testid="result-row"]'] }
```

`rootSelectors` is only a hint about where result rows live — the generic
fallbacks still apply. Then add the URL pattern to
`content_scripts[0].matches` in `manifest.json`, and cover it in
`scripts/tripagent-selftest.mjs`, which tests scrapers against a synthetic DOM.

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest: permissions, matches, service worker |
| `background.js` | service worker: both staging stores, dedupe, push to planner tabs |
| `lib/capture.js` | category guessing, price detection, notes-line formatting |
| `scrapers.js` | site detection, portal adapters, JSON-LD + text strategies |
| `content.js` | runs on supported sites; debounced capture + on-demand scrape |
| `bridge.js` | runs on the planner origin; the only page↔extension relay |
| `popup.html` / `popup.js` / `popup.css` | both queues, review UI, overrides |

## Permissions

- `contextMenus` — the right-click capture item.
- `storage` — the two staging queues and your saved overrides.
- `tabs` — to find open planner tabs and push to them.
- `activeTab` + `scripting` — to read the page you are looking at **when you
  click Capture**, and only then. This is what makes capture universal without
  requesting access to every site: `activeTab` is granted per invocation, for
  one tab, and expires. The alternative — an `<all_urls>` content script —
  would mean running on every page you ever load.
- Host permissions — the sites with automatic capture, the planner origins, and
  `localhost:8787` for the optional backend.

Captured data goes to the planner tab (or your clipboard) and nowhere else.
The extension makes no network requests of its own.

## On iPhone

Chrome extensions don't run on iOS — not even in Chrome for iPhone, which is
Safari's engine under the hood and has no extension API. The only real path
is a **Safari Web Extension**, a separate packaging (via
`xcrun safari-web-extension-converter`) that requires a Mac with Xcode and
ships through the App Store, not as an unpacked folder.

Even with that conversion, right-click capture has no iOS equivalent — touch
screens have no right-click. The planner's own **Add to Home Screen**
install (see the main [README](../README.md#-add-to-your-iphone-home-screen))
covers the everything-but-capture experience today; capturing portal offers
on iPhone still means using a laptop for that step, or typing the offer by
hand into the planner's notes.

## Pointing at a different planner URL

Deployed elsewhere? Add the origin in two places in `manifest.json`
(`host_permissions` and `content_scripts[1].matches`) and to `PLANNER_URLS` in
`background.js`, then reload the extension.
