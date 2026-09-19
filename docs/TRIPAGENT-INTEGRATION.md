# TripAgent Integration

How the browser extension, the web app and the backend fit together, and
what the contract between them is.

## Why it is shaped this way

The planner's value is its cost model: options grouped per leg, ranked
combinations, date windows that never mix price-research rounds. Capture is
in service of that — its only job is to stop you retyping what you already
found in a browser tab.

So captured data is **staged, never applied**. Offers land in a review panel;
rows only enter your plan when you click Add. A scraper that misreads a page
costs you a glance, not a rewritten itinerary.

## Architecture

```
┌──────────────────────┐         ┌──────────────────────┐
│  Booking site tab    │         │  TripAgent extension │
│  kayak, booking.com, │         │                      │
│  skyscanner, …       │         │  scrapers.js         │
│                      │◀────────│  content.js          │
│  DOM                 │ scrape  │      │               │
└──────────────────────┘         │      ▼ runtime msg   │
                                 │  background.js       │
                                 │  (staging store)     │
                                 │      │               │
                                 └──────┼───────────────┘
                                        │ chrome.tabs.sendMessage
                                        ▼
                             ┌─────────────────────────┐
                             │ Planner tab             │
                             │                         │
                             │  bridge.js  (isolated)  │
                             │      │ window.postMessage
                             │      ▼                  │
                             │  tripAgentBridge.js     │
                             │      │                  │
                             │      ▼                  │
                             │  tripAgentOffers.js ◀───┼──── backend
                             │   (normalize → rows)    │   /api/flights
                             │      │                  │
                             │      ▼                  │
                             │  TripAgentPanel (stage) │
                             │      │ user clicks Add  │
                             │      ▼                  │
                             │  the plan table         │
                             └─────────────────────────┘
```

A content script runs in an isolated world, so it cannot call into the page's
JavaScript and the page cannot call into it. `window.postMessage` is the only
channel between them, and `extension/bridge.js` is the only thing that
relays across it.

## The offer shape

Every source — scraper or API — produces *raw* offers. `normalizeOffer()` in
`src/utils/tripAgentOffers.js` turns those into the canonical shape. Raw
input is permissive (it accepts `from`/`origin`/`departureAirport`, a price
as a number, a string or an object); canonical output is not.

```js
{
  id: 'ta_1k2j3h',                 // stable: derived from the offer's content
  kind: 'flight',                  // flight | train | bus | ferry | car | hotel | stay | activity
  category: 'travel',              // travel | stay | activity — the planner's own buckets
  group: 'IST → MUC',              // leg for travel, place for a stay
  carrier: 'Turkish Airlines',
  departure: '06:45',              // always HH:MM, or ''
  arrival: '11:30',
  duration: '3h 45m',
  stops: 0,
  price: { low: 2100, high: 2100, currency: 'EUR' },
  perNight: false,
  nights: 1,
  window: '14-19 Aug',             // date-window tag; see the app's WINDOW: notes
  label: '', detail: '',
  source: 'kayak',
  sourceUrl: 'https://…',
  capturedAt: '2026-08-01T10:00:00.000Z',
}
```

`offerToRow()` then produces exactly the row shape the planner already
edits — `{id, category, group, option, timeText, costText, detail, window}` —
so a captured option is indistinguishable from a typed one downstream, and
takes part in combinations, totals and export unchanged.

### The one seam that matters

The planner reads cost from a row's **text** (`parseCost` in
`parseTripNotes.js`), which understands `€2100`, `€250-350`, `€140/night x3`
and `free`. So `offerCostText()` must emit something that parses back
identically, and it only does that for EUR, USD and GBP.

For any other currency the cost cell is left **empty** and the captured
amount is written into the row's detail as `price TRY 45000 (enter
manually)`. A wrong number in a total is worse than a missing one, and the
panel flags these rows before you add them.

## Message protocol

Envelopes carry `source` and `protocol` tags, and both sides check
`event.source === window` and `event.origin === window.location.origin`.
Anything else is dropped — an embedded frame cannot drive the extension, and
a third-party script cannot inject offers.

**Extension → page** (`source: 'tripagent-extension'`, `protocol: 'tripagent/v1'`):

| `type`   | payload                                | meaning                          |
|----------|----------------------------------------|----------------------------------|
| `OFFERS` | `offers[]`, `captureSource`, `sourceUrl` | newly captured or replayed offers |
| `STATUS` | `version`, `capturedCount`             | reply to the page's `READY`      |

**Page → extension** (`source: 'tripagent-page'`):

| `type`            | meaning                                      |
|-------------------|----------------------------------------------|
| `READY`           | the panel mounted; send status and anything staged |
| `REQUEST_OFFERS`  | re-send what the extension has staged        |
| `CLEAR_OFFERS`    | drop the extension's staging store           |

## Backend

`backend/server.mjs` is a dependency-free proxy in front of a flight-search
API. It exists so credentials never reach the browser, and so the app sees
one offer shape no matter which provider is behind it.

```
GET /api/health
GET /api/flights?from=IST&to=MUC&date=2026-08-14[&returnDate=][&adults=1][&currency=EUR]
```

With no credentials configured it answers with **sample data**, flagged
`live: false` and labelled in the UI. That keeps the whole pipeline testable
without an API key; it is not a fallback you would ever want to mistake for
a quote. See [backend/README.md](../backend/README.md).

## Setup

```bash
npm install
npm start                       # the planner, http://localhost:3000
npm run backend                 # optional, http://localhost:8787
```

Load the extension: `chrome://extensions` → Developer mode →
**Load unpacked** → select `extension/`. See
[extension/README.md](../extension/README.md).

Point the app at a non-default backend with
`REACT_APP_TRIPAGENT_API=https://… npm start` (Create React App reads
`REACT_APP_*` at build time).

## Testing

```bash
npm run tripagent:selftest      # data pipeline, no browser or API key needed
node scripts/tripagent-browser-test.mjs [--backend]   # needs the app running + Playwright
```

The self-test covers time/price parsing, the offer→row conversion, the
cost round-trip, dedupe, the Amadeus mapping, request validation, the
scrapers against a synthetic DOM, and a full run through the planner's own
cost and combination logic. The browser test covers the bridge, its origin
checks, and that staging never writes to the plan by itself.

## Known limits

- **Scrapers are best-effort.** Booking sites change markup constantly. The
  scrapers avoid class names and read JSON-LD or rendered text instead, but
  a redesign can still break one. The failure mode is "nothing captured",
  not "wrong data captured" — and the popup's manual capture with route
  overrides is always there.
- **Airport codes vs. city names.** Scraped routes come from the URL when it
  has them; otherwise the popup's override fills them in. Nothing is guessed.
- **Round trips are priced once.** Amadeus quotes one price per offer, so it
  is attributed to the outbound leg and the return is marked
  `return (priced with outbound)`. Pricing both would double the total.
- **No persistence.** Captured offers live in the extension's session store
  and the panel's React state. Closing the tab loses staging; the plan table
  is what you export.

## Next steps

Not built, in rough order of usefulness:

1. Hotel search in the backend (Amadeus has a hotel API; the offer shape
   already supports `perNight`/`nights`).
2. Saved trips — the export in `buildExportData()` is already a complete
   snapshot, so persistence is a storage decision, not a modelling one.
3. Per-site scraper adapters where the heuristic proves too loose.
4. Currency conversion, which would let non-EUR/USD/GBP captures total
   automatically instead of being flagged for manual entry.
