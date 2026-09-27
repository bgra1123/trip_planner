# TripAgent Capture (browser extension)

Two ways to get a price out of a browser tab and into your trip plan, because
no single mechanism covers every site.

| | Selected prices | Scraped offers |
|---|---|---|
| **Works on** | any page, anywhere | supported booking + bank travel portals |
| **You do** | select a price, right-click | nothing — or click *Capture this page* |
| **You get** | a text line you review and fix | structured route/time/price rows |
| **Breaks when** | never | a site redesigns its markup |

The first always works and needs a moment of your attention. The second needs
no attention and sometimes stops working. Having both means a site redesign
costs you convenience, not the ability to capture at all.

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

Open a flight or hotel search on a supported site and let the results render.
The extension captures automatically (debounced, and only when the results
actually changed) and pushes to any open planner tab.

When a page isn't recognised, or its URL doesn't carry the route, use the
popup:

- **From / To / Window** — overrides. These beat whatever the URL said and are
  remembered. `Window` is the planner's date-window label (`14-19 Aug`), which
  keeps two rounds of price research from being combined with each other.
- **Capture this page** — scrape exactly what's on screen now.
- **Send to planner** / **Clear**.

Scraped offers are reproducible by re-scraping, so they live in
`chrome.storage.session` and are dropped on browser restart.

### Supported sites

Google Flights, Kayak, Skyscanner, Booking.com, Trainline, DB, and the
Capital One and Amex travel portals — see `matches` in `manifest.json`.
"Supported" means the content script is injected; whether a page yields
anything depends on its markup.

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
   the ones holding a price *and*, for travel, two clock times.

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
- Host permissions — the sites in `matches`, plus the planner origins.

Captured data goes to the planner tab (or your clipboard) and nowhere else.
The extension makes no network requests of its own.

## Pointing at a different planner URL

Deployed elsewhere? Add the origin in two places in `manifest.json`
(`host_permissions` and `content_scripts[1].matches`) and to `PLANNER_URLS` in
`background.js`, then reload the extension.
