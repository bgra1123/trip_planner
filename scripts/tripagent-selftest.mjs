#!/usr/bin/env node
// End-to-end check of the TripAgent pipeline, without a browser or an API
// key: raw scraper/API payloads -> canonical offers -> editable table rows
// -> the planner's own grouping, cost totals and export.
//
// The point is the seam: the planner's cost logic only understands the
// shorthand in a row's cost cell, so an offer whose price does not survive
// that round-trip is a silently-wrong total. These assertions are what
// keep that from happening.
//
//   npm run tripagent:selftest

import {
  normalizeTime, normalizePrice, normalizeOffer, normalizeOffers,
  offerToRow, offersToRows, offerCostText, rowCostIsParseable, mergeOffers,
} from '../src/utils/tripAgentOffers.js';
import { groupRows, defaultSelection, buildExportData, parseCost } from '../src/utils/parseTripNotes.js';
import { toOffers, humanDuration } from '../backend/amadeus.mjs';
import { sampleFlights } from '../backend/sample.mjs';
import { validateFlightQuery } from '../backend/server.mjs';
import { createRequire } from 'node:module';

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failures.push(`${name}\n    expected: ${e}\n    actual:   ${a}`);
}

function ok(name, condition, detail) {
  if (condition) { passed += 1; return; }
  failures.push(`${name}${detail ? `\n    ${detail}` : ''}`);
}

// ---- time parsing --------------------------------------------------------
check('normalizeTime 24h', normalizeTime('18:05'), '18:05');
check('normalizeTime pads', normalizeTime('6:45'), '06:45');
check('normalizeTime pm', normalizeTime('6:45 PM'), '18:45');
check('normalizeTime 12am', normalizeTime('12:30 AM'), '00:30');
check('normalizeTime 12pm', normalizeTime('12:30 PM'), '12:30');
check('normalizeTime iso timestamp', normalizeTime('2026-08-14T06:45:00'), '06:45');
check('normalizeTime iso with space', normalizeTime('2026-08-14 18:05'), '18:05');
check('normalizeTime junk', normalizeTime('sometime tomorrow'), '');
check('normalizeTime impossible', normalizeTime('99:99'), '');

// ---- price parsing -------------------------------------------------------
check('normalizePrice number', normalizePrice(2100), { low: 2100, high: 2100, currency: 'EUR' });
check('normalizePrice euro string', normalizePrice('€2,100'), { low: 2100, high: 2100, currency: 'EUR' });
check('normalizePrice usd cents', normalizePrice('$1,234.56'), { low: 1234.56, high: 1234.56, currency: 'USD' });
check('normalizePrice de grouping', normalizePrice('1.234,56 EUR'), { low: 1234.56, high: 1234.56, currency: 'EUR' });
check('normalizePrice code wins', normalizePrice('45000 TRY'), { low: 45000, high: 45000, currency: 'TRY' });
check('normalizePrice range object', normalizePrice({ low: 350, high: 250, currency: 'eur' }), { low: 250, high: 350, currency: 'EUR' });
check('normalizePrice empty', normalizePrice(''), null);

// ---- offer normalization -------------------------------------------------
ok('normalizeOffer drops an empty payload', normalizeOffer({ kind: 'flight' }) === null);
ok('normalizeOffer drops a non-object', normalizeOffer('nope') === null);

const flight = normalizeOffer({
  kind: 'flight', from: 'ist', to: 'MUC', departure: '6:45 AM', arrival: '11:30',
  carrier: 'Turkish Airlines', price: '€2100', stops: 0, duration: '3h 45m',
  source: 'kayak', window: '14-19 Aug',
});
check('flight group', flight.group, 'ist → MUC');
check('flight departure', flight.departure, '06:45');
check('flight price', flight.price, { low: 2100, high: 2100, currency: 'EUR' });

const flightRow = offerToRow(flight, 'row-1');
check('flight row category', flightRow.category, 'travel');
check('flight row time', flightRow.timeText, '06:45-11:30');
check('flight row cost', flightRow.costText, '€2100');
check('flight row window', flightRow.window, '14-19 Aug');
ok('flight row detail mentions the source', flightRow.detail.includes('via kayak'), flightRow.detail);
ok('flight row cost is parseable by the planner', rowCostIsParseable(flightRow));

const hotel = normalizeOffer({
  kind: 'hotel', place: 'Milan', label: 'Family room near Duomo',
  price: { amount: 140, currency: 'EUR' }, perNight: true, nights: 3,
});
const hotelRow = offerToRow(hotel, 'row-2');
check('hotel row category', hotelRow.category, 'stay');
check('hotel row group', hotelRow.group, 'Milan');
check('hotel per-night shorthand', hotelRow.costText, '€140/night x3');
// The shorthand must expand to the full stay, not one night — this is the
// assertion that catches a per-night price being totalled as a flat one.
check('hotel cost expands to 3 nights', parseCost(hotelRow.costText).low, 420);

const train = normalizeOffer({ kind: 'train', from: 'MUN', to: 'MILAN', price: { low: 250, high: 350, currency: 'EUR' } });
check('train range shorthand', offerCostText(train), '€250-350');
check('train range parses back', [parseCost(offerCostText(train)).low, parseCost(offerCostText(train)).high], [250, 350]);

// An unsupported currency must not be silently converted or dropped.
const lira = normalizeOffer({ kind: 'flight', from: 'IST', to: 'ESB', price: '45000 TRY' });
const liraRow = offerToRow(lira, 'row-3');
check('unsupported currency leaves the cost cell empty', liraRow.costText, '');
ok('unsupported currency is preserved in the detail', liraRow.detail.includes('TRY 45000'), liraRow.detail);
ok('unsupported currency is flagged as unparseable', !rowCostIsParseable(liraRow));

// ---- dedupe --------------------------------------------------------------
const dupA = normalizeOffer({ kind: 'flight', from: 'IST', to: 'MUC', departure: '06:45', price: '€2100', carrier: 'TK' });
const dupB = normalizeOffer({ kind: 'flight', from: 'IST', to: 'MUC', departure: '06:45', price: '€2100', carrier: 'TK' });
const different = normalizeOffer({ kind: 'flight', from: 'IST', to: 'MUC', departure: '09:15', price: '€2800', carrier: 'LH' });
check('mergeOffers collapses a re-capture', mergeOffers([dupA], [dupB, different]).length, 2);
check('mergeOffers caps the list', mergeOffers([], [dupA, different], 1).length, 1);

// ---- backend mapping -----------------------------------------------------
check('humanDuration', humanDuration('PT7H20M'), '7h 20m');
check('humanDuration days', humanDuration('P1DT2H'), '26h');
const amadeusOffers = toOffers({
  dictionaries: { carriers: { TK: 'TURKISH AIRLINES' } },
  data: [{
    validatingAirlineCodes: ['TK'],
    price: { total: '2100.00', currency: 'EUR' },
    itineraries: [
      { duration: 'PT3H45M', segments: [
        { carrierCode: 'TK', departure: { iataCode: 'IST', at: '2026-08-14T06:45:00' }, arrival: { iataCode: 'VIE', at: '2026-08-14T08:15:00' } },
        { carrierCode: 'TK', departure: { iataCode: 'VIE', at: '2026-08-14T09:30:00' }, arrival: { iataCode: 'MUC', at: '2026-08-14T10:30:00' } },
      ] },
      { duration: 'PT3H40M', segments: [
        { carrierCode: 'TK', departure: { iataCode: 'MUC', at: '2026-08-19T18:00:00' }, arrival: { iataCode: 'IST', at: '2026-08-19T21:40:00' } },
      ] },
    ],
  }],
});
check('amadeus yields both legs', amadeusOffers.length, 2);
check('amadeus counts stops', amadeusOffers[0].stops, 1);
check('amadeus resolves the carrier name', amadeusOffers[0].carrier, 'Turkish Airlines');
// A round trip is quoted once; pricing the return leg too would double it.
ok('amadeus prices only the outbound leg', amadeusOffers[0].price !== null && amadeusOffers[1].price === null);

// ---- request validation --------------------------------------------------
ok('validateFlightQuery accepts a good query', !!validateFlightQuery(new URLSearchParams('from=IST&to=MUC&date=2026-08-14')).query);
ok('validateFlightQuery rejects a bad code', !!validateFlightQuery(new URLSearchParams('from=ISTANBUL&to=MUC&date=2026-08-14')).errors);
ok('validateFlightQuery rejects an identical route', !!validateFlightQuery(new URLSearchParams('from=IST&to=IST&date=2026-08-14')).errors);
ok('validateFlightQuery rejects a backwards return', !!validateFlightQuery(new URLSearchParams('from=IST&to=MUC&date=2026-08-14&returnDate=2026-08-01')).errors);
ok('validateFlightQuery rejects 0 adults', !!validateFlightQuery(new URLSearchParams('from=IST&to=MUC&date=2026-08-14&adults=0')).errors);

// ---- full pipeline -------------------------------------------------------
// Sample backend offers + a scraped hotel, all the way through to the
// planner's own totals.
const pipelineOffers = normalizeOffers(
  sampleFlights({ from: 'IST', to: 'MUC', date: '2026-08-14', adults: 1, currency: 'EUR' }),
  { kind: 'flight', source: 'sample', window: '14-19 Aug' }
).concat([hotel]);

const rows = offersToRows(pipelineOffers);
ok('every offer became a row', rows.length === pipelineOffers.length);
ok('row ids are unique', new Set(rows.map((r) => r.id)).size === rows.length);

const parsed = groupRows(rows, []);
check('flights collapse into one leg with four options', [parsed.travel.length, parsed.travel[0].options.length], [1, 4]);
check('the hotel becomes its own stay group', parsed.stay.length, 1);

const exported = buildExportData(parsed, defaultSelection(parsed), 'IST → MUC');
const cheapestFlight = Math.min(...pipelineOffers.filter((o) => o.kind === 'flight').map((o) => o.price.low));
const firstFlight = pipelineOffers[0].price.low;
check('travel total matches the selected flight', exported.costBreakdown.travel.low, firstFlight);
check('accommodation total is the 3-night stay', exported.costBreakdown.accommodation.low, 420);
check('grand total adds up', exported.costBreakdown.total.low, firstFlight + 420);
ok('a cheaper combination is ranked first',
  exported.combinations.ranked.length > 0 && exported.combinations.ranked[0].low === cheapestFlight + 420,
  `ranked[0].low=${exported.combinations.ranked[0] && exported.combinations.ranked[0].low}, expected ${cheapestFlight + 420}`);

// Window tagging must survive the whole trip, or combinations could mix
// price-research rounds.
ok('the window tag survives into the export',
  exported.currentPick.travel[0].window === '14-19 Aug',
  JSON.stringify(exported.currentPick.travel[0]));

// ---- scrapers ------------------------------------------------------------
// The extension's scrapers are the most fragile part of the system, so they
// are exercised against a synthetic DOM: no real markup, just the shapes
// the heuristic is supposed to accept and reject.
const require = createRequire(import.meta.url);
const scrapers = require('../extension/scrapers.js');

check('detects google flights', scrapers.detectSite('https://www.google.com/travel/flights?q=IST+to+MUC').id, 'google-flights');
check('detects booking.com', scrapers.detectSite('https://www.booking.com/searchresults.html?ss=Milan').id, 'booking-com');
check('unknown host falls back', scrapers.detectSite('https://example.com/whatever').id, 'unknown');
check('route from a kayak url', scrapers.routeFromUrl('https://www.kayak.com/flights/IST-MUC/2026-08-14'), { from: 'IST', to: 'MUC' });
check('route from a skyscanner url', scrapers.routeFromUrl('https://www.skyscanner.net/transport/flights/ist/muc/260814/'), { from: 'IST', to: 'MUC' });
check('route from query params', scrapers.routeFromUrl('https://example.com/search?origin=ist&destination=muc'), { from: 'IST', to: 'MUC' });
check('no route to invent', scrapers.routeFromUrl('https://www.google.com/travel/flights'), null);
check('place from a booking url', scrapers.placeFromUrl('https://www.booking.com/searchresults.html?ss=Milan%2C+Italy'), 'Milan');

function fakeDoc(texts, jsonLd) {
  const nodes = texts.map((textContent) => ({ textContent }));
  const scripts = (jsonLd || []).map((obj) => ({ textContent: JSON.stringify(obj) }));
  return {
    querySelectorAll(selector) {
      if (selector === 'script[type="application/ld+json"]') return scripts;
      if (selector === 'li') return nodes;
      return [];
    },
  };
}

const flightDoc = fakeDoc([
  '06:45 \u2013 11:30 Turkish Airlines 3h 45m Nonstop \u20ac2,100',
  '09:15 \u2013 11:05 Lufthansa 3h 50m 1 stop \u20ac2,800',
  'Sort by price',                       // no price, no times
  'Flights from \u20ac1,950',              // a price but no times
]);
const scraped = scrapers.scrape(flightDoc, 'https://www.kayak.com/flights/IST-MUC/2026-08-14', null);
check('heuristic keeps only real result rows', scraped.length, 2);
check('heuristic reads the route from the url', [scraped[0].from, scraped[0].to], ['IST', 'MUC']);
check('heuristic reads both times', [scraped[0].departure, scraped[0].arrival], ['06:45', '11:30']);
check('heuristic reads the price', scraped[0].price, '\u20ac2,100');
check('heuristic reads nonstop as zero stops', scraped[0].stops, 0);
check('heuristic counts stops', scraped[1].stops, 1);
check('heuristic finds the carrier', scraped[0].carrier, 'Turkish Airlines');

// A scraped row must survive normalization into a usable planner row.
const scrapedRow = offerToRow(normalizeOffer(scraped[0]), 'row-scraped');
check('scraped row group', scrapedRow.group, 'IST \u2192 MUC');
check('scraped row cost', scrapedRow.costText, '\u20ac2100');
ok('scraped row cost is parseable', rowCostIsParseable(scrapedRow));

// A popup override must beat whatever the URL said.
const overridden = scrapers.scrape(flightDoc, 'https://www.kayak.com/flights/IST-MUC/2026-08-14', { from: 'SAW', to: 'MUC', window: '13-18 Aug' });
check('popup override wins over the url', [overridden[0].from, overridden[0].window], ['SAW', '13-18 Aug']);

// JSON-LD is preferred when the page publishes enough of it.
const ldDoc = fakeDoc(['06:45 \u2013 11:30 Turkish Airlines \u20ac2,100'], [
  { '@type': 'Flight', departureAirport: { iataCode: 'IST' }, arrivalAirport: { iataCode: 'MUC' }, departureTime: '2026-08-14T06:45:00', arrivalTime: '2026-08-14T11:30:00', provider: { name: 'Turkish Airlines' }, offers: { price: '2100', priceCurrency: 'EUR' } },
  { '@type': 'Flight', departureAirport: { iataCode: 'IST' }, arrivalAirport: { iataCode: 'MUC' }, departureTime: '2026-08-14T09:15:00', arrivalTime: '2026-08-14T13:50:00', provider: { name: 'Lufthansa' }, offers: { price: '2600', priceCurrency: 'EUR' } },
]);
const ldScraped = scrapers.scrape(ldDoc, 'https://www.google.com/travel/flights', null);
check('json-ld is used when present', ldScraped.length, 2);
check('json-ld carrier', ldScraped[0].carrier, 'Turkish Airlines');
const ldRow = offerToRow(normalizeOffer(ldScraped[0]), 'row-ld');
check('json-ld row time', ldRow.timeText, '06:45-11:30');
check('json-ld row cost', ldRow.costText, '\u20ac2100');

// ---- report --------------------------------------------------------------
if (failures.length) {
  console.error(`\n✗ ${failures.length} failed, ${passed} passed\n`);
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  process.exit(1);
}
console.error(`✓ ${passed} assertions passed`);
