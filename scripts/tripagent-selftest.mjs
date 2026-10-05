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
  offersFromNotesText, currenciesNeedingRate, offerFromLink,
} from '../src/utils/tripAgentOffers.js';
import { groupRows, parseNotes, defaultSelection, buildExportData, parseCost, convertToBase } from '../src/utils/parseTripNotes.js';
import {
  HOTEL_CARD_PROGRAMS, detectCardProgram, cardProgramForStay,
} from '../src/utils/hotelCardBenefits.js';
import { toOffers, humanDuration } from '../backend/amadeus.mjs';
import { sampleFlights } from '../backend/sample.mjs';
import { validateFlightQuery, handleIngest, paramsFromBody } from '../backend/server.mjs';
import { ingest, cachedFor, aggregate, summary, clear as clearIngested } from '../backend/aggregator.mjs';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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

// Regression: Number(null) === 0, so a hotel capture (which has no stops
// field at all) was silently mislabeled "nonstop" once that coercion ran.
check('a hotel with no stops field normalizes to null, not 0', hotel.stops, null);
ok('a hotel detail never claims "nonstop"', !hotelRow.detail.includes('nonstop'), hotelRow.detail);
const nonstopFlight = normalizeOffer({ kind: 'flight', from: 'IST', to: 'MUC', price: '€100', stops: 0 });
ok('a flight with a real zero-stops still reads nonstop', offerToRow(nonstopFlight, 'row-ns').detail.includes('nonstop'));

const train = normalizeOffer({ kind: 'train', from: 'MUN', to: 'MILAN', price: { low: 250, high: 350, currency: 'EUR' } });
check('train range shorthand', offerCostText(train), '€250-350');
check('train range parses back', [parseCost(offerCostText(train)).low, parseCost(offerCostText(train)).high], [250, 350]);

// ---- currency ------------------------------------------------------------
// A currency the planner knows is written faithfully, symbol and all. The
// amount must never be quietly relabelled as euros.
const lira = normalizeOffer({ kind: 'flight', from: 'IST', to: 'ESB', price: '45000 TRY' });
const liraRow = offerToRow(lira, 'row-3');
check('a known non-euro currency keeps its own symbol', liraRow.costText, '₺45000');
check('a lira cost parses back as lira', [parseCost(liraRow.costText).low, parseCost(liraRow.costText).currency], [45000, 'TRY']);
ok('a lira cost is parseable', rowCostIsParseable(liraRow));

// Regression: there is no word boundary between "Y" and "4" in "TRY45000",
// so a \b-anchored code pattern silently dropped the currency and defaulted
// the amount to euros.
check('a code glued to its amount is still read', normalizePrice('TRY45000'), { low: 45000, high: 45000, currency: 'TRY' });
check('a symbol glued to its amount is still read', normalizePrice('₺45000'), { low: 45000, high: 45000, currency: 'TRY' });
check('CHF is recognized as a word marker', normalizePrice('CHF 250'), { low: 250, high: 250, currency: 'CHF' });

// Regression: a nights multiplier is a quantity, not a price. "x3" used to be
// scooped up as the low end of a range.
check('a nights multiplier is not a price', normalizePrice('€140/night x3'), { low: 140, high: 140, currency: 'EUR' });
check('a spelled-out nights count is not a price', normalizePrice('€90/night for 3 nights'), { low: 90, high: 90, currency: 'EUR' });

// A currency outside the planner's vocabulary must not be converted or
// dropped: the cost cell stays empty and the amount survives in the detail.
const yen = normalizeOffer({ kind: 'flight', from: 'HND', to: 'IST', price: '145000 JPY' });
const yenRow = offerToRow(yen, 'row-3b');
check('an unknown currency leaves the cost cell empty', yenRow.costText, '');
ok('an unknown currency is preserved in the detail', yenRow.detail.includes('JPY 145000'), yenRow.detail);
ok('an unknown currency is flagged as unparseable', !rowCostIsParseable(yenRow));

// Conversion is gated on a rate being on file — never a silent 1:1 guess.
check('a foreign currency with no rate is reported', currenciesNeedingRate([lira], {}), ['TRY']);
check('a foreign currency with a rate is not reported', currenciesNeedingRate([lira], { TRY: 0.01814 }), []);
check('euro costs never need a rate', currenciesNeedingRate([flight], {}), []);
ok('an unrated cost is excluded from the base total, not guessed',
  convertToBase(parseCost('₺45000'), {}).missingRate === true);
check('a rated cost converts', Math.round(convertToBase(parseCost('₺45000'), { TRY: 0.01814 }).low), 816);

// ---- notes captures ------------------------------------------------------
// A hand-reviewed text selection reaches staging as trip-notes lines, parsed
// by the planner's own grammar rather than reimplemented in the extension.
const captured = offersFromNotesText([
  'RATE: TRY 0.01814',
  'FLIGHT: IST to MUN, 6:45-11:30, TRY45000, Turkish Airlines',
  'HOTEL: Milan - near Duomo, EUR140/night x3',
  'ACTIVITY: Duomo rooftop, EUR40',
].join('\n'));
check('a RATE: line is carried out of the capture', captured.rates, { TRY: 0.01814 });
check('every priced line becomes an offer', captured.offers.length, 3);
check('the notes categories survive', captured.offers.map((o) => o.category), ['travel', 'stay', 'activity']);
const capturedRows = captured.offers.map((o, i) => offerToRow(o, `cap-${i}`));
check('a captured lira flight keeps its currency', capturedRows[0].costText, '₺45000');
// Regression: parseCost expands a per-night price across the stay, so passing
// its result straight back through offerCostText multiplied the nights twice
// (140/night x3 -> 420 -> "€420/night x3" -> 1260).
check('a per-night capture keeps its unit price', capturedRows[1].costText, '€140/night x3');
check('and still totals to the whole stay', parseCost(capturedRows[1].costText).low, 420);
check('a captured route becomes a leg', capturedRows[0].group, 'IST → MUN');
check('the captured rate answers its own currency', currenciesNeedingRate(captured.offers, captured.rates), []);

// ---- hotel card-program benefits -------------------------------------------
// A stay's bundled card-program benefits (a credit, a guaranteed checkout, an
// upgrade chance) come from a small, static, dated table and are shown as a
// list next to the price — never folded into a single "worth X% more" score.
// Tagging rides the existing HOTEL: detail text via a `CARD:<marker>` token,
// so an untagged stay is completely unaffected (strictly additive).
check('exactly the two verified programs are on file', Object.keys(HOTEL_CARD_PROGRAMS).sort(), ['FHR', 'HOTEL_COLLECTION']);
ok('the lookup is dated, since terms change without notice',
  /2026/.test(HOTEL_CARD_PROGRAMS.FHR.capturedAt) && /2026/.test(HOTEL_CARD_PROGRAMS.HOTEL_COLLECTION.capturedAt),
  `FHR=${HOTEL_CARD_PROGRAMS.FHR.capturedAt} HC=${HOTEL_CARD_PROGRAMS.HOTEL_COLLECTION.capturedAt}`);
check('FHR benefits are exactly the published list', HOTEL_CARD_PROGRAMS.FHR.benefits, [
  'Breakfast for two',
  '$100 credit toward eligible charges',
  'Guaranteed 4pm checkout',
  'Noon check-in when available',
  'Room upgrade when available',
  'Complimentary wifi',
]);
check('Hotel Collection benefits are exactly the published list', HOTEL_CARD_PROGRAMS.HOTEL_COLLECTION.benefits, [
  '$100 credit toward eligible charges',
  '4pm late checkout when available',
  'Noon check-in when available',
  'Room upgrade when available',
  'Minimum 2-night stay required',
]);

check('CARD:FHR resolves to Fine Hotels + Resorts', detectCardProgram('walk to metro, CARD:FHR').code, 'FHR');
check('CARD:HC resolves to Hotel Collection', detectCardProgram('CARD:HC').code, 'HOTEL_COLLECTION');
check('the full program name also resolves', detectCardProgram('CARD:Hotel Collection, near station').code, 'HOTEL_COLLECTION');
ok('no tag means no program, never a guess', detectCardProgram('walk to metro') === null);
ok('an unrecognized marker is never guessed at', detectCardProgram('CARD:PLATINUM') === null);
ok('empty/missing text has no program', detectCardProgram('') === null && detectCardProgram(undefined) === null);

check('cardProgramForStay scans label and detail together',
  cardProgramForStay({ label: 'Family suite', detail: 'walk to metro, CARD:FHR' }).code, 'FHR');
ok('an untagged stay option has no program', cardProgramForStay({ label: 'Family suite', detail: 'walk to metro' }) === null);
ok('a stay option with no detail at all has no program', cardProgramForStay({ label: 'Family suite' }) === null);
ok('a null option has no program', cardProgramForStay(null) === null);

// The marker rides the existing HOTEL: detail grammar — no new field, no new
// parser — so it survives parseNotes()/groupRows() exactly like any other
// freeform detail text.
const cardNotes = parseNotes([
  'HOTEL: Milan - family room near Duomo, EUR140/night x3, walk to metro, CARD:FHR',
  'HOTEL: Munich - near Hauptbahnhof, EUR120/night x1, rest stop before train',
].join('\n'));
check('two distinct stay groups are parsed', cardNotes.stay.length, 2);
const taggedStay = cardNotes.stay.find((g) => g.key === 'Milan').options[0];
const untaggedStay = cardNotes.stay.find((g) => g.key === 'Munich').options[0];
ok('the CARD: marker survives into the parsed detail', /CARD:FHR/i.test(taggedStay.detail), taggedStay.detail);
check('the tagged stay resolves to Fine Hotels + Resorts', cardProgramForStay(taggedStay).code, 'FHR');
// The benefits lookup never touches the price — the per-night cost still
// expands across the 3-night stay exactly as it would untagged.
check('the tagged stay\'s price is untouched by the benefits lookup', taggedStay.cost.low, 420);
check('a stay with no CARD: marker gets no program', cardProgramForStay(untaggedStay), null);

// The same marker survives a captured (extension) offer too, since captures
// go through the planner's own linesToRows() rather than a separate parser.
const cardCapture = offersFromNotesText('HOTEL: Rome - suite near Termini, EUR200/night x2, CARD:HC');
const cardCaptureRow = offerToRow(cardCapture.offers[0], 'cap-card');
ok('a captured hotel detail still carries the CARD: marker', /CARD:HC/i.test(cardCaptureRow.detail), cardCaptureRow.detail);
check('the captured stay resolves to Hotel Collection',
  cardProgramForStay({ label: cardCaptureRow.option, detail: cardCaptureRow.detail }).code, 'HOTEL_COLLECTION');

// ---- save a link as an activity -------------------------------------------
// A reel/blog link plus the user's own note becomes an activity offer through
// the same normalizeOffer()/offerToRow() pipeline a scraped or pasted capture
// uses — no parallel row shape, and no fetch of the link's content.
const linked = offerFromLink('https://instagram.com/reel/abc123', 'Rooftop bar with sunset views');
check('a saved link becomes an activity', linked.category, 'activity');
check('the note is the activity label, verbatim', linked.label, 'Rooftop bar with sunset views');
check('the url is preserved on the offer', linked.sourceUrl, 'https://instagram.com/reel/abc123');
check('no price is invented for a saved link', linked.price, null);

const linkedRow = offerToRow(linked, 'row-link');
check('the saved-link row is an activity row', linkedRow.category, 'activity');
check('the saved-link row option is the user\'s own note', linkedRow.option, 'Rooftop bar with sunset views');
ok('the source url is folded into the row detail, never dropped',
  linkedRow.detail.includes('https://instagram.com/reel/abc123'), linkedRow.detail);
check('the row carries no fabricated cost', linkedRow.costText, '');

// Whitespace-only input is the same as missing — nothing to fold in, so
// nothing is built (never a blank/guessed activity).
ok('a link with no note is refused', offerFromLink('https://example.com/x', '   ') === null);
ok('a note with no link is refused', offerFromLink('  ', 'Nice view') === null);
ok('two blanks are refused', offerFromLink('', '') === null);

// ---- dedupe --------------------------------------------------------------
const dupA = normalizeOffer({ kind: 'flight', from: 'IST', to: 'MUC', departure: '06:45', price: '€2100', carrier: 'TK' });
const dupB = normalizeOffer({ kind: 'flight', from: 'IST', to: 'MUC', departure: '06:45', price: '€2100', carrier: 'TK' });
const different = normalizeOffer({ kind: 'flight', from: 'IST', to: 'MUC', departure: '09:15', price: '€2800', carrier: 'LH' });
check('mergeOffers collapses a re-capture', mergeOffers([dupA], [dupB, different]).length, 2);
check('mergeOffers caps the list', mergeOffers([], [dupA, different], 1).length, 1);

// Regression: the same hotel captured once via JSON-LD (which resolved a
// place) and once via the text heuristic (which could not) used to land as
// two offers, since the dedupe key included the mismatched group.
const hotelViaJsonLd = normalizeOffer({ kind: 'hotel', place: 'Milan', label: 'Hotel Milano Scala', price: { amount: 220, currency: 'EUR' }, perNight: true });
const hotelViaHeuristic = normalizeOffer({ kind: 'hotel', label: 'Hotel Milano Scala', price: '€220', perNight: true });
check('a stay dedupes on name even when group parsing disagreed',
  mergeOffers([], [hotelViaJsonLd, hotelViaHeuristic]).length, 1);
const differentHotel = normalizeOffer({ kind: 'hotel', label: 'Hotel Lombardia', price: '€165', perNight: true });
check('a genuinely different stay is not collapsed',
  mergeOffers([], [hotelViaJsonLd, differentHotel]).length, 2);

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

// ---- full pipeline, in a second currency ---------------------------------
// The whole point of the rate table: a captured lira fare has to reach the
// planner's euro totals, converted, and its absence of a rate has to keep it
// out rather than in at 1:1.
const mixedRows = [
  ...offersToRows(offersFromNotesText('FLIGHT: IST to MUN, 6:45-11:30, TRY45000').offers),
  ...offersToRows(offersFromNotesText('HOTEL: Munich - central, EUR120/night x2').offers),
];
const withRate = buildExportData(
  groupRows(mixedRows, [], { TRY: 0.01814 }),
  defaultSelection(groupRows(mixedRows, [], { TRY: 0.01814 })),
  null
);
check('a rated lira fare converts into the euro total', Math.round(withRate.costBreakdown.travel.low), 816);
check('the euro stay is unaffected by conversion', withRate.costBreakdown.accommodation.low, 240);
check('the grand total mixes both currencies correctly', Math.round(withRate.costBreakdown.total.low), 1056);

const noRate = buildExportData(
  groupRows(mixedRows, [], {}),
  defaultSelection(groupRows(mixedRows, [], {})),
  null
);
check('an unrated lira fare is excluded from the total, not guessed at 1:1',
  noRate.costBreakdown.travel.low, 0);
check('and the rest of the trip still totals', noRate.costBreakdown.accommodation.low, 240);

// ---- capture on an unrecognized page -------------------------------------
// The extension injects its scraper on demand, so capture has to work on a
// site nobody wrote an adapter for. Two things must hold there: the kind is
// read from the page rather than assumed, and a price alone is enough to
// qualify a row (an unknown page has no departure/arrival structure to lean on).
function pageDoc(texts, title) {
  const nodes = texts.map((textContent) => ({ textContent }));
  return {
    title: title || '',
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === 'script[type="application/ld+json"]') return [];
      if (selector === 'li') return nodes;
      return [];
    },
  };
}

check('an unknown site is marked generic', scrapers.detectSite('https://example.com/x', pageDoc([], '')).generic, true);
check('a hotel page is read as a stay', scrapers.detectSite('https://smallhotel.example/rooms', pageDoc([], 'Deluxe rooms in Milan')).kind, 'hotel');
check('a rail page is read as a train', scrapers.detectSite('https://example.com/rail/tickets', pageDoc([], 'Rail tickets')).kind, 'train');
check('a coach page is read as a bus', scrapers.detectSite('https://flixbus.example/search', pageDoc([], 'Bus from Munich')).kind, 'bus');
check('an attraction page is read as an activity', scrapers.detectSite('https://tickets.example/duomo', pageDoc([], 'Duomo rooftop admission')).kind, 'activity');
// "stay" is tested before "travel" on purpose: a hotel page mentions airports
// far more often than a flight page mentions rooms.
check('a hotel near an airport is still a stay', scrapers.detectSite('https://example.com/hotel', pageDoc([], 'Hotel near Munich Airport \u2014 rooms from')).kind, 'hotel');

// A nightly rate on an unknown hotel page, with no clock times anywhere.
const unknownHotel = scrapers.scrape(
  pageDoc(['Garden Room \u20ac95 per night Free cancellation', 'Sort by price'], 'Rooms in Milan'),
  'https://smallhotel.example/rooms', null
);
check('an unknown hotel page yields its priced row', unknownHotel.length, 1);
check('and is categorized as a stay', unknownHotel[0].kind, 'hotel');
const unknownHotelRow = offerToRow(normalizeOffer(unknownHotel[0]), 'row-uh');
check('the unknown stay row lands in the stay bucket', unknownHotelRow.category, 'stay');
ok('and carries a usable cost', rowCostIsParseable(unknownHotelRow), unknownHotelRow.costText);

// A priced row with no times on an unknown page must still be captured — the
// two-clock-times rule only applies to the sites that actually have them.
const unknownFare = scrapers.scrape(
  pageDoc(['Vienna to Budapest coach \u20ac19 one way'], 'Bus tickets'),
  'https://coach.example/search', null
);
check('a priced row with no times is kept on an unknown page', unknownFare.length, 1);

// Known sites keep the stricter rule, or their navigation and filter chrome
// would be captured as results.
const knownNoTimes = scrapers.scrape(
  fakeDoc(['Flights from \u20ac1,950', 'Baggage from \u20ac25']),
  'https://www.kayak.com/flights/IST-MUC/2026-08-14', null
);
check('a known flight site still requires two times', knownNoTimes.length, 0);

// ---- bank travel portals -------------------------------------------------
// A bank portal can only be read in the user's authenticated browser session,
// so these adapters are the only path to that data. Two things must hold: the
// portal's currency is stated rather than guessed, and a points fare is never
// mistaken for money.
check('capital one is detected', scrapers.detectSite('https://travel.capitalone.com/search/flights').id, 'capital-one');
check('amex is detected', scrapers.detectSite('https://travel.americanexpress.com/flights/results').id, 'amex');
check('bank portals are listed', scrapers.BANK_PORTALS, ['capital-one', 'amex']);

check('points are recognized', scrapers.pointsIn('32,000 miles + $5.60'), '32,000 miles');
check('pts abbreviation is recognized', scrapers.pointsIn('45,500 pts'), '45,500 pts');
check('a plain fare has no points', scrapers.pointsIn('$320 round trip'), '');
// A $5.60 tax beside a points fare is a fee, not the fare. Read as the price it
// would make a transatlantic flight look like pocket change.
check('a redemption fee is not read as the fare', scrapers.cashPriceIn('32,000 miles + $5.60 in taxes'), '');
check('a real cash fare is read', scrapers.cashPriceIn('$320 round trip'), '$320');

const portalDoc = fakeDoc([
  '10:30 AM \u2013 10:45 PM British Airways 7h 15m Nonstop $320',
  '6:00 AM \u2013 8:10 PM Virgin Atlantic 9h 10m 1 stop 32,000 miles + $5.60 in taxes',
  'Filter by airline',
]);
const portalOffers = scrapers.scrape(portalDoc, 'https://travel.capitalone.com/search/flights?origin=JFK&destination=LHR', null);
check('both portal cards are captured', portalOffers.length, 2);
check('the portal route comes from its url', [portalOffers[0].from, portalOffers[0].to], ['JFK', 'LHR']);
check('the cash fare keeps the card currency', portalOffers[0].price, '$320');
check('the portal names itself as the source', portalOffers[0].source, 'capital-one');
ok('a points fare carries no cash price', portalOffers[1].price === null, JSON.stringify(portalOffers[1].price));
ok('and says so in its detail', /points/.test(portalOffers[1].detail), portalOffers[1].detail);

// The decisive assertion: a points fare must not contribute money to a total.
const pointsRow = offerToRow(normalizeOffer({ ...portalOffers[1], kind: 'flight' }) || {}, 'row-points');
ok('a points fare cannot become a cash row', !pointsRow.costText || !rowCostIsParseable(pointsRow),
  `costText=${pointsRow.costText}`);

// A bare number on a portal card must not be read as euros. $320 is not \u20ac320.
const bareDoc = fakeDoc(['07:00 \u2013 19:15 Delta 7h 15m Nonstop 415']);
const bareOffers = scrapers.scrape(bareDoc, 'https://travel.americanexpress.com/flights?origin=JFK&destination=CDG', null);
ok('a card with no currency marker is skipped rather than guessed',
  bareOffers.length === 0 || /USD/.test(String(bareOffers[0].price)),
  JSON.stringify(bareOffers.map((o) => o.price)));

// ---- aggregator ----------------------------------------------------------
clearIngested();
const bankSearch = { from: 'JFK', to: 'LHR', date: '2026-10-15' };
const BA = { kind: 'flight', from: 'JFK', to: 'LHR', departure: '10:30', arrival: '22:45', carrier: 'British Airways' };
ingest('capital-one', [
  { ...BA, price: { amount: 320, currency: 'USD' } },
  { ...BA, price: { amount: 320, currency: 'USD' } },
], bankSearch);
ingest('amex', [{ ...BA, price: { amount: 340, currency: 'USD' } }], bankSearch);

check('ingested data is found for its route', cachedFor(bankSearch).length, 3);
check('and not for another route', cachedFor({ from: 'IST', to: 'MUC', date: '2026-10-15' }).length, 0);
check('and not for another date', cachedFor({ ...bankSearch, date: '2026-11-01' }).length, 0);
check('every ingesting source is summarized', Object.keys(summary().bySource).sort(), ['amex', 'capital-one']);

const apiOffers = [{ kind: 'flight', from: 'JFK', to: 'LHR', departure: '18:00', arrival: '06:10', carrier: 'Virgin', price: { amount: 299, currency: 'USD' }, source: 'amadeus' }];
const aggregated = aggregate([cachedFor(bankSearch), apiOffers]);
check('an exact repeat from one source is dropped', aggregated.offers.length, 3);
// Deliberately NOT deduped across sources: "Capital One wants $320, Amex wants
// $340 for this same flight" is the comparison the whole feature exists for.
check('the same flight from two portals is kept for comparison',
  aggregated.offers.filter((o) => o.carrier === 'British Airways').map((o) => o.source).sort(),
  ['amex', 'capital-one']);
check('results are ranked cheapest first', aggregated.offers.map((o) => o.price.amount), [299, 320, 340]);
check('every answering source is named', aggregated.sources.sort(), ['amadeus', 'amex', 'capital-one']);

// An offer nobody could price sorts last rather than vanishing.
const withUnpriced = aggregate([[{ kind: 'flight', from: 'JFK', to: 'LHR', carrier: 'Unknown', source: 'x' }], apiOffers]);
check('an unpriced offer is kept, ranked last', withUnpriced.offers.map((o) => o.carrier), ['Virgin', 'Unknown']);

// ---- ingest endpoint ----------------------------------------------------
ok('a good ingest is accepted', handleIngest({ source: 'capital-one', flights: [BA], searchParams: bankSearch }).status === 200);
ok('the guide\'s "flights" key is accepted', handleIngest({ source: 'amex', flights: [BA] }).status === 200);
ok('and so is "offers"', handleIngest({ source: 'amex', offers: [BA] }).status === 200);
check('a missing source is refused', handleIngest({ flights: [BA] }).status, 400);
check('a path-like source is refused', handleIngest({ source: '../../etc/passwd', flights: [BA] }).status, 400);
check('a non-array payload is refused', handleIngest({ source: 'amex', flights: 'nope' }).status, 400);
check('an empty payload is refused', handleIngest({ source: 'amex', flights: [] }).status, 400);

// The POST body shape from the guide has to land on the same validator the GET
// endpoint uses, aliases and all.
const fromBody = paramsFromBody({ origin: 'JFK', destination: 'LHR', departDate: '2026-10-15', passengers: 2 });
check('the POST aliases map onto the query', validateFlightQuery(fromBody).query,
  { from: 'JFK', to: 'LHR', date: '2026-10-15', returnDate: null, adults: 2, currency: 'EUR' });
clearIngested();

// ---- capturing from whatever tab is open ---------------------------------
// The service worker injects the scraper on demand so capture works on pages
// no adapter was written for. That logic decides whether to reuse an existing
// content script, whether a page can be touched at all, and what to say when
// it can't — so it is exercised here against a stubbed extension API rather
// than trusted to review.
function loadWorker({ tabUrl = 'https://smallhotel.example/rooms', contentScriptReply = null, injectResult = undefined, injectThrows = null } = {}) {
  const calls = { sendMessage: 0, executeScript: [], badge: [] };
  const store = {};
  const area = () => ({
    get: async (key) => ({ [key]: store[key] }),
    set: async (obj) => { Object.assign(store, obj); },
  });
  const chromeStub = {
    storage: { session: area(), local: area() },
    action: {
      setBadgeText: async (o) => { calls.badge.push(o.text); },
      setBadgeBackgroundColor: async () => {},
    },
    contextMenus: { create: () => {}, onClicked: { addListener: () => {} } },
    runtime: {
      lastError: undefined,
      getManifest: () => ({ version: '0.3.0' }),
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: () => {} },
    },
    tabs: {
      query: async () => [{ id: 7, url: tabUrl }],
      sendMessage: async () => {
        calls.sendMessage += 1;
        if (!contentScriptReply) throw new Error('Receiving end does not exist.');
        return contentScriptReply;
      },
    },
    scripting: {
      executeScript: async (opts) => {
        calls.executeScript.push(opts.files ? opts.files.join(',') : 'func');
        if (injectThrows) throw new Error(injectThrows);
        if (opts.files) return [{}];
        return [{ result: injectResult }];
      },
    },
  };
  const context = vm.createContext({
    chrome: chromeStub,
    fetch: async () => ({ ok: true }),
    console,
    setTimeout,
    URL,
    Promise,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Math,
    Date,
    Set,
    Error,
    RegExp,
    Buffer,
    importScripts: () => {},
    TripCapture: { cleanText: (t) => t, guessCategory: () => 'note' },
  });
  vm.runInContext(readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8'), context);
  return { captureFromTab: context.captureFromTab, calls };
}

// A site with a declared content script already has the scraper running, with
// its own debounce and page observation. Reuse it rather than injecting twice.
{
  const { captureFromTab, calls } = loadWorker({
    tabUrl: 'https://www.kayak.com/flights/IST-MUC/2026-08-14',
    contentScriptReply: { offers: [{ kind: 'flight' }], site: 'kayak' },
  });
  const reply = await captureFromTab({ id: 7, url: 'https://www.kayak.com/flights/IST-MUC/2026-08-14' }, {});
  check('an existing content script is reused', reply.site, 'kayak');
  check('and nothing is injected on top of it', calls.executeScript, []);
}

// The case this change exists for: a page with no content script at all.
{
  const { captureFromTab, calls } = loadWorker({
    injectResult: { offers: [{ kind: 'hotel', place: 'Milan' }], site: 'unknown', kind: 'hotel' },
  });
  const reply = await captureFromTab({ id: 7, url: 'https://smallhotel.example/rooms' }, {});
  check('an unlisted page is captured by injection', reply.offers.length, 1);
  check('the scraper file is injected before the call that uses it', calls.executeScript, ['scrapers.js', 'func']);
  check('the injected result carries the guessed kind', reply.kind, 'hotel');
  ok('the content script was tried first', calls.sendMessage === 1);
}

// Pages no extension may touch, whatever its permissions. Naming the reason
// beats a generic failure the user can only guess at.
for (const blocked of ['chrome://settings', 'about:blank', 'devtools://devtools/x', 'https://chromewebstore.google.com/detail/x']) {
  const { captureFromTab, calls } = loadWorker({ tabUrl: blocked });
  let message = '';
  try {
    await captureFromTab({ id: 7, url: blocked }, {});
  } catch (err) {
    message = err.message;
  }
  ok(`a restricted page is refused with a reason (${blocked.split(':')[0]})`,
    /Chrome blocks extensions/.test(message), message);
  check(`and nothing is injected into it (${blocked.split(':')[0]})`, calls.executeScript, []);
}

// An injection that fails for any other reason must say so, and point at the
// path that always works.
{
  const { captureFromTab } = loadWorker({ injectThrows: 'Frame was detached' });
  let message = '';
  try {
    await captureFromTab({ id: 7, url: 'https://smallhotel.example/rooms' }, {});
  } catch (err) {
    message = err.message;
  }
  ok('a failed injection reports the cause', /Frame was detached/.test(message), message);
  ok('and points at right-click capture', /[Rr]ight-click/.test(message), message);
}

// A page that yields nothing is not an error — it is an empty capture.
{
  const { captureFromTab } = loadWorker({ injectResult: undefined });
  const reply = await captureFromTab({ id: 7, url: 'https://smallhotel.example/rooms' }, {});
  check('an empty injection result is handled', reply.offers, []);
}

// ---- report --------------------------------------------------------------
if (failures.length) {
  console.error(`\n✗ ${failures.length} failed, ${passed} passed\n`);
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  process.exit(1);
}
console.error(`✓ ${passed} assertions passed`);
