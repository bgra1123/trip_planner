# TripAgent backend

A small proxy in front of a flight-search API. It exists so API credentials
never reach the browser, and so the app sees one offer shape regardless of
the provider behind it.

No dependencies — Node 18+ only.

## Run

```bash
npm run backend                 # http://localhost:8787, sample data
```

With live prices:

```bash
export AMADEUS_CLIENT_ID=your-key
export AMADEUS_CLIENT_SECRET=your-secret
npm run backend
```

Free test credentials: <https://developers.amadeus.com/> → Self-Service →
create an app. The test environment returns real routes against cached
prices; set `AMADEUS_HOSTNAME=production` once you have production keys.

## Why there is an ingest endpoint

A public API can be queried from here. A bank travel portal cannot: it needs
the user's authenticated session, which exists only in their browser. So the
extension scrapes those portals there and POSTs what it found to
`/api/flights/ingest`, and a later search folds it in beside the API results.

That data is stale by construction, so every entry records when it was
captured and expires after two hours.

## Endpoints

### `GET /api/health`

```json
{ "ok": true, "live": false, "provider": "sample",
  "allowedOrigins": ["http://localhost:3000", "http://127.0.0.1:3000"] }
```

`live` is whether credentials are configured.

### `GET /api/flights`

| Param | Required | Format |
|-------|----------|--------|
| `from` | yes | 3-letter IATA code |
| `to` | yes | 3-letter IATA code, different from `from` |
| `date` | yes | `YYYY-MM-DD` |
| `returnDate` | no | `YYYY-MM-DD`, not before `date` |
| `adults` | no | integer 1–9 (default 1) |
| `currency` | no | 3-letter code (default `EUR`) |

```bash
curl 'http://localhost:8787/api/flights?from=IST&to=MUC&date=2026-08-14&adults=2'
```

```json
{
  "live": false,
  "provider": "sample",
  "query": { "from": "IST", "to": "MUC", "date": "2026-08-14", "adults": 2, "currency": "EUR" },
  "offers": [
    { "kind": "flight", "from": "IST", "to": "MUC", "departure": "06:45", "arrival": "11:30",
      "duration": "3h 45m", "stops": 0, "carrier": "Turkish Airlines",
      "price": { "amount": 734, "currency": "EUR" }, "source": "sample" }
  ]
}
```

Bad input is rejected with `400` and every problem listed at once, before
anything reaches a paid API.

A provider failure is only fatal if nothing else answered. When the API fails
but the extension had captured portal data for that route, the response is
`200` with those offers and a `providerError` field — results that are real but
incomplete beat no results at all. When nothing answered, it is `502` with the
provider's own message, since a 400 from a bad IATA code and a 401 from stale
credentials need very different fixes.

### `POST /api/flights/search`

The same search as the GET form, accepting the field aliases a client may
already use (`origin`/`destination`/`departDate`/`passengers`). Both paths run
through one validator.

```bash
curl -X POST http://localhost:8787/api/flights/search \
  -H 'Content-Type: application/json' \
  -d '{"origin":"JFK","destination":"LHR","departDate":"2026-10-15","passengers":1}'
```

### `POST /api/flights/ingest`

Where the extension posts what it scraped from an authenticated portal.

```bash
curl -X POST http://localhost:8787/api/flights/ingest \
  -H 'Content-Type: application/json' \
  -d '{"source":"capital-one",
       "searchParams":{"from":"JFK","to":"LHR","date":"2026-10-15"},
       "flights":[{"kind":"flight","from":"JFK","to":"LHR","departure":"10:30",
                   "arrival":"22:45","carrier":"British Airways","stops":0,
                   "price":{"amount":320,"currency":"USD"}}]}'
```

`source` must be a short slug (`capital-one`, `amex`). Either `flights` or
`offers` is accepted for the array. `searchParams` is the route and date the
capture belongs to — it is the cache key, so a capture for one route is never
served for another.

### `GET /api/flights/ingested?from=&to=&date=`

What is currently cached for a route, with each entry's age in minutes. Useful
for checking whether a capture actually landed.

## Aggregation

`aggregator.mjs` merges every source, then:

- **Drops exact repeats within a source.** A page reload that re-scrapes the
  same card should not double it.
- **Keeps the same flight from different sources.** This is deliberate:
  *"Capital One wants \$320 and Amex wants \$340 for this exact flight"* is the
  comparison the feature exists for. Collapsing them would destroy the answer.
- **Ranks cheapest first**, with unpriced offers last rather than discarded — a
  flight you can see but we couldn't price is still information.
- **Expires entries after two hours**, evicted on every read and write since an
  idle process has no timer running.

## Sample mode

Without credentials the server returns four deterministic sample flights,
priced from a hash of the query so the same search always gives the same
numbers. They carry `live: false`, `source: "sample"` and a
`"sample data — not a real quote"` detail, and the app shows a banner. The
point is that the whole pipeline is testable without an API key — not that
the numbers mean anything.

## Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `8787` | listen port |
| `ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | comma-separated CORS allowlist |
| `ALLOW_EXTENSION_ORIGINS` | `true` | set `false` to refuse `chrome-extension://` origins |
| `AMADEUS_CLIENT_ID` | — | enables live mode when set with the secret |
| `AMADEUS_CLIENT_SECRET` | — | |
| `AMADEUS_HOSTNAME` | `test` | `test` or `production` |

CORS echoes back only origins on the allowlist; there is no wildcard, because
with credentials configured that would let any page the user visits spend their
API quota.

Browser-extension origins (`chrome-extension://…`) are accepted as a class,
since an unpacked extension's id is unstable and cannot be named in advance —
and reaching this server from one at all requires the user to have installed
that extension themselves. Set `ALLOW_EXTENSION_ORIGINS=false` to refuse them.

Request bodies are capped at 1 MB and rejected rather than buffered past it, so
a runaway scraper cannot exhaust memory here.

## Adding a provider

1. Write `backend/<provider>.mjs` exporting `isConfigured(env)` and
   `searchFlights(query, env)`, returning raw offers (see the shape in
   `amadeus.mjs`).
2. Select it in `handleFlights()` in `server.mjs`.

Raw offers are permissive — `normalizeOffer()` in
`src/utils/tripAgentOffers.js` is what tightens them up, so a provider module
only has to map fields, not validate them.

## Files

| File | Role |
|------|------|
| `server.mjs` | HTTP server, CORS, request validation, routing |
| `aggregator.mjs` | ingest cache (2h TTL), cross-source merge, dedupe, ranking |
| `amadeus.mjs` | Amadeus auth (cached token) and offer mapping |
| `sample.mjs` | deterministic sample offers for credential-free runs |
