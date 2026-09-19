# TripAgent Capture (Chrome extension)

Captures flight, train and hotel options from booking sites and sends them
to the Trip Planner, where they wait in a review panel until you add them.

## Install

1. `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this `extension/` folder

The toolbar badge shows how many offers are staged.

## Use

Open a flight or hotel search and let the results render. The extension
captures automatically (debounced, and only when the results actually
changed), and pushes to any open planner tab.

When a page is not recognised, or the route is not in its URL, open the
popup:

- **From / To / Window** — overrides. These beat whatever the URL said, and
  are remembered for next time. The `Window` tag is the planner's date-window
  label (`14-19 Aug`), which keeps two rounds of price research from being
  combined with each other.
- **Capture this page** — scrape exactly what is on screen now.
- **Send to planner** — push everything staged to open planner tabs.
- **Clear** — empty the staging store.

## Supported sites

Google Flights, Kayak, Skyscanner, Booking.com, Trainline and DB — see
`matches` in `manifest.json`. "Supported" means the content script is
injected there; whether a given page yields anything depends on its markup.

## How scraping works

Two strategies, in order (`scrapers.js`):

1. **JSON-LD** — the `application/ld+json` blocks sites publish for search
   engines. Stable and unambiguous, but not on every page.
2. **A rendered-text heuristic** — walk candidate result containers and keep
   the ones that contain a price *and*, for travel, two clock times. Carrier,
   duration and stop count are pulled out of the same text.

Nothing keys off a class name, because those change weekly. The heuristic is
deliberately conservative: a container that does not look like a result row
is skipped, so a redesign usually means "captured nothing" rather than
"captured nonsense". Normalization, validation and dedupe all happen later
in the web app, so a sloppy capture becomes a row you fix by hand — never a
number you cannot see.

### Adding a site

Add an entry to `SITES` in `scrapers.js`:

```js
{ id: 'my-site', kind: 'flight', test: /mysite\.com\/search/i,
  rootSelectors: ['div[data-testid="result-row"]'] }
```

`rootSelectors` is only a hint about where result rows live — the generic
fallbacks still apply. Then add the URL pattern to `content_scripts[0].matches`
in `manifest.json`. Cover it in `scripts/tripagent-selftest.mjs`, which tests
scrapers against a synthetic DOM.

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest: permissions, matches, service worker |
| `scrapers.js` | site detection and the two scraping strategies |
| `content.js` | runs on booking sites; debounced capture + on-demand scrape |
| `background.js` | service worker: staging store, dedupe, push to planner tabs |
| `bridge.js` | runs on the planner origin; the only page↔extension relay |
| `popup.html` / `popup.js` | manual capture, overrides, staged list |

## Permissions

- `storage` — the staging store (`chrome.storage.session`, so captures are
  not written to the profile on disk and are cleared on browser restart).
- `tabs` — to find open planner tabs and push offers to them.
- Host permissions — the booking sites listed in `matches`, plus the planner
  origins (`localhost:3000`, `127.0.0.1:3000`, the GitHub Pages URL).

Captured data goes to the planner tab and nowhere else. The extension makes
no network requests of its own.

## Pointing at a different planner URL

Deployed somewhere else? Add the origin in two places in `manifest.json`
(`host_permissions` and `content_scripts[1].matches`) and to `PLANNER_URLS`
in `background.js`, then reload the extension.
