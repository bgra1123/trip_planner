# The iPhone capture bookmarklet

Why this exists: Chrome on iPhone has no extension system at all — not a
restricted one, none. Apple requires every browser on iOS, Chrome included,
to run on Apple's own WebKit engine rather than the browser's real one, so
the Chromium extension APIs the `extension/` folder depends on simply never
run there. That held true even after the EU's Digital Markets Act forced
Apple to theoretically allow alternative engines; as of this writing no
vendor has shipped one with extension support on iOS. A Safari Web
Extension (a real port, via `xcrun safari-web-extension-converter`) is the
only way to get an actual installed extension on iOS, and that needs a Mac
with Xcode to build.

The bookmarklet is the substitute that needs none of that: a Safari bookmark
whose URL is JavaScript instead of a link. Tapping it runs that JavaScript
in the page you're looking at — which is enough to run the *exact same*
`extension/scrapers.js`, unmodified, against the portal page, then hand the
result to the planner.

## How it works

1. `scripts/build-bookmarklet.mjs` reads `extension/scrapers.js` verbatim,
   appends a small capture-and-redirect wrapper, and minifies the combined
   source with [terser](https://github.com/terser/terser) into one
   `javascript:` URI. (Terser, not a hand-rolled comment strip: one of the
   site adapters' regexes ends in `\//i` — an escaped slash immediately
   before the closing delimiter — which contains a literal `//` that a
   naive line-based stripper reads as a comment start, truncating the
   regex. A real parser can't make that mistake.)
2. Tapping the bookmarklet runs `TripAgentScrapers.scrape(...)` against the
   current page, then opens the planner in a new tab with the result
   base64'd into the URL hash (`#capture=...`) — the only channel available,
   since a bookmarklet has no persistent connection to post a message
   through the way a real extension's content script does.
3. `src/utils/tripAgentBridge.js`'s `consumeBookmarkletCapture()` reads that
   hash once on load, clears it (so a reload or a shared link never replays
   it), and re-posts it as a normal extension `OFFERS` envelope — the exact
   same `window.postMessage` shape `extension/bridge.js` sends. Staging,
   normalization and dedupe are all the one path; the bookmarklet is a
   second way in, never a second pipeline to keep in sync.

## Building it

```bash
npm run bookmarklet                           # targets the production URL
node scripts/build-bookmarklet.mjs <url>      # or a specific one, e.g. for local testing
```

Runs automatically before every `npm run build` (and therefore every
`npm run deploy`), via the `prebuild` script, so the generated bookmarklet
always targets whatever `homepage` in `package.json` currently points at.

Output: `public/bookmarklet.js` (the raw code, for reading) and
`public/capture.html` (the install page — open `/capture.html` on the
deployed site for copy-paste-into-a-bookmark instructions).

## What it can't do

- No right-click capture (no right-click on a touchscreen) and no automatic
  capture-on-page-load (a bookmarklet only runs when tapped) — every
  capture on iPhone is a deliberate tap, not ambient.
- `activeTab`-style scoped permissions don't apply; the bookmarklet simply
  runs with whatever access the page itself has, same as any other
  bookmarklet.
- If a page's markup hides its prices from a generic reader (rare, but the
  same risk the desktop "Capture this page" path has), the alert says so
  honestly rather than guessing — the **Quick Add** form in the TripAgent
  panel is the fallback either way, on any device.
