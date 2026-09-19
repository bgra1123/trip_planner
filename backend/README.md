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
anything reaches a paid API. A provider failure is `502` with the provider's
own message — a 400 from a bad IATA code and a 401 from stale credentials
need very different fixes.

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
| `AMADEUS_CLIENT_ID` | — | enables live mode when set with the secret |
| `AMADEUS_CLIENT_SECRET` | — | |
| `AMADEUS_HOSTNAME` | `test` | `test` or `production` |

CORS echoes back only origins on the allowlist; there is no wildcard,
because with credentials configured that would let any page the user visits
spend their API quota.

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
| `amadeus.mjs` | Amadeus auth (cached token) and offer mapping |
| `sample.mjs` | deterministic sample offers for credential-free runs |
