# Trip Planner Capture (browser extension)

Right-click any price on any travel site and queue it for your trip notes — no per-site integration, no API, works everywhere the MCP connectors don't reach.

## Install (unpacked, for now — not published to a store)

**Chrome / Edge / Brave:**
1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this `extension/` folder

**Firefox:**
1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on** and select `extension/manifest.json`
   (temporary add-ons are removed when Firefox restarts — reload after each restart)

## Use it

1. On any page, select the price/fare/rate text you want to keep (e.g. a flight card's price, a hotel's nightly rate)
2. Right-click → **Add "…" to Trip Planner**
3. Click the extension's toolbar icon to open the queue
4. For each capture: pick the right category (Flight/Train/Hotel/Activity/Note) and clean up the text if needed — the popup flags anything with no recognizable price so you don't copy a dud line
5. Click **Copy as trip notes**
6. Paste into the trip planner's "Edit trip data" notes box (works the same in the React app, the Claude artifact, or a `notes.txt` file for the CLI) and click **Convert notes to table**

Nothing is sent anywhere — captures live in the extension's local storage until you copy or clear them.

## Why clipboard hand-off instead of direct integration

The three existing trip-planner surfaces (React app, Claude artifact, CLI) don't share a fixed URL or a running server this extension could talk to, and the Claude artifact's sandbox blocks incoming cross-origin messages anyway. Plain-text notes-syntax over the clipboard works identically across all three without assuming any of them are open in a particular tab.

## Files

- `manifest.json` — MV3 manifest (permissions: `contextMenus`, `storage` only)
- `background.js` — service worker; creates the context-menu item and queues captures
- `popup.html` / `popup.js` / `popup.css` — the review/edit/copy UI
- `lib/capture.js` — category guessing + cost detection + line formatting, shared by both

`lib/capture.js` is a small standalone copy of the tag vocabulary and cost-detection idea in `../src/utils/parseTripNotes.js` — an extension can't import that ES module directly, so it's mirrored here the same way the Claude artifact mirrors it in vanilla JS.
