// "Say it all at once": reads one dictated or typed sentence into the fields of
// an input card. It runs locally (no AI, no cost, works offline) and is
// deliberately modest: it fills a field only when the words clearly say it, and
// the user checks and corrects the card before anything is added.
//
// Two things it never decides on its own, because getting them wrong is a
// silently wrong total:
//   - the currency: only a symbol or a spoken name ("dollars", "euros") counts;
//   - per traveler vs total: only explicit words ("each", "per person", "in
//     total", "altogether") — never a default.
//
//   "Flight from New York to Paris, leaves 6:30 pm, lands 7:45 am, Air France,
//    612 dollars each for two travelers"
//   -> { from: 'New York', to: 'Paris', depart: '6:30 pm', arrive: '7:45 am',
//        carrier: 'Air France', price: '612', currency: 'USD', basis: 'per_traveler', travelers: '2' }

import { CITY_CODES } from './entryCard.js';

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const numberOf = (w) => (/^\d+$/.test(w) ? parseInt(w, 10) : NUMBER_WORDS[String(w).toLowerCase()] || 0);

const AIRLINES = [
  'Air France', 'British Airways', 'Turkish Airlines', 'Delta', 'United', 'American Airlines', 'Lufthansa', 'KLM', 'TAP',
  'Iberia', 'Emirates', 'Qatar Airways', 'ITA Airways', 'Swiss', 'Austrian', 'Norwegian', 'Ryanair', 'easyJet', 'Wizz Air',
  'Pegasus', 'Virgin Atlantic', 'JetBlue', 'Air Canada', 'Finnair', 'SAS', 'Aer Lingus', 'French bee', 'Air Caraïbes',
];

const CURRENCY_WORDS = [
  [/dollars?|usd|bucks/i, 'USD'], [/euros?|eur/i, 'EUR'], [/pounds?|sterling|gbp/i, 'GBP'],
  [/lira|try/i, 'TRY'], [/swiss francs?|francs?|chf/i, 'CHF'],
];
const SYMBOLS = { $: 'USD', '€': 'EUR', '£': 'GBP', '₺': 'TRY' };

const cap = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

function findPrice(text) {
  let m = text.match(/([$€£₺])\s?(\d[\d,]*(?:\.\d+)?)/);
  if (m) return { price: m[2].replace(/,/g, ''), currency: SYMBOLS[m[1]], at: m.index };
  m = text.match(/(\d[\d,]*(?:\.\d+)?)\s?(dollars?|usd|bucks|euros?|eur|pounds?|sterling|gbp|lira|try|swiss francs?|francs?|chf)\b/i);
  if (m) {
    const cur = CURRENCY_WORDS.find(([re]) => re.test(m[2]));
    return { price: m[1].replace(/,/g, ''), currency: cur ? cur[1] : '', at: m.index };
  }
  return null;
}

function findClocks(text) {
  const out = [];
  const re = /\b(\d{1,2})(?:[:.\s](\d{2}))?\s?(a\.?m\.?|p\.?m\.?)(?![a-z])|\b([01]?\d|2[0-3]):([0-5]\d)\b/gi;
  let m;
  while ((m = re.exec(text))) {
    const mer = m[3] ? (/^p/i.test(m[3]) ? 'pm' : 'am') : '';
    const clock = m[3] ? `${m[1]}:${m[2] || '00'} ${mer}` : `${m[4]}:${m[5]}`;
    out.push({ clock, at: m.index, before: text.slice(Math.max(0, m.index - 22), m.index).toLowerCase() });
  }
  return out;
}

// Cities, in the order they are spoken. Longest names first so "new york city"
// isn't read as "york".
function findCities(text) {
  const lower = text.toLowerCase();
  const names = Object.keys(CITY_CODES).sort((a, b) => b.length - a.length);
  const hits = [];
  names.forEach((name) => {
    const re = new RegExp(`\\b${name.replace(/ /g, '\\s+')}\\b`, 'g');
    let m;
    while ((m = re.exec(lower))) hits.push({ name, at: m.index, end: m.index + m[0].length });
  });
  hits.sort((a, b) => a.at - b.at);
  // Drop a hit that sits inside an earlier, longer one ("new york" inside "new york city").
  return hits.filter((h, i) => !hits.some((o, j) => j !== i && o.at <= h.at && o.end >= h.end && (o.end - o.at) > (h.end - h.at)));
}

function travelersIn(text) {
  let m = text.match(/\b(?:for|of)\s+(?:the\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:of\s+us|travell?ers?|people|passengers|adults)\b/i)
    || text.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:travell?ers?|people|passengers|adults)\b/i)
    || text.match(/\bfor\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b(?!\s*(?:nights?|days?|hours?|dollars?|euros?))/i);
  if (m) return numberOf(m[1]);
  if (/\b(?:both of us|the two of us|for both|for us two|my wife and me|me and my)\b/i.test(text)) return 2;
  return 0;
}

// -> { fields, found: ['from', 'to', ...] }. `fields` uses the card's own field names.
export function parseSpokenEntry(text, kind) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const fields = {};
  if (!t) return { fields, found: [] };

  const price = findPrice(t);
  if (price) {
    fields.price = price.price;
    if (price.currency) fields.currency = price.currency;
  }

  const perPerson = /\b(?:per\s+(?:person|traveller|traveler|passenger|adult|head)|each|apiece|a\s+head)\b/i.test(t);
  const total = /\b(?:in\s+total|total|altogether|all\s+together|for\s+everyone|for\s+both|for\s+all)\b/i.test(t);
  const travelers = travelersIn(t);

  if (kind === 'flight' || kind === 'train') {
    const codes = t.match(/\b([A-Z]{3})\s*(?:to|-|→)\s*([A-Z]{3})\b/);
    if (codes) {
      fields.from = codes[1];
      fields.to = codes[2];
    } else {
      const cities = findCities(t);
      if (cities.length >= 2) {
        fields.from = cap(cities[0].name);
        fields.to = cap(cities[1].name);
      }
    }
    const clocks = findClocks(t);
    clocks.forEach((c, i) => {
      const arriving = /arriv|land|get in|get there|reach|until/.test(c.before);
      const departing = /depart|leav|take off|takes off|at|from/.test(c.before) && !arriving;
      if (arriving && !fields.arrive) fields.arrive = c.clock;
      else if (departing && !fields.depart) fields.depart = c.clock;
      else if (!fields.depart && i === 0) fields.depart = c.clock;
      else if (!fields.arrive) fields.arrive = c.clock;
    });
    const airline = AIRLINES.find((a) => new RegExp(`\\b${a.replace(/ /g, '\\s+')}\\b`, 'i').test(t));
    if (airline) fields.carrier = airline;
    if (/\b(?:non-?stop|direct)\b/i.test(t)) fields.stops = '0';
    else if (/\b(?:one|1)\s+stop\b/i.test(t)) fields.stops = '1';
    else if (/\b(?:two|2)\s+stops\b/i.test(t)) fields.stops = '2';
    if (price) {
      if (perPerson && !total) fields.basis = 'per_traveler';
      else if (total && !perPerson) fields.basis = 'total';
      if (travelers && fields.basis !== 'total') fields.travelers = String(travelers);
    }
  } else if (kind === 'hotel') {
    const cities = findCities(t);
    if (cities.length) fields.place = cap(cities[0].name);
    const name = t.match(/\b(?:at|called|named)\s+(?:the\s+)?([A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*){0,4})/);
    if (name) fields.name = name[1];
    else {
      // "Hotel Le Marais in Paris, ..." — a capitalised phrase before "in <city>".
      const lead = t.match(/^([A-Z][^,.]*?)\s+in\s+/);
      if (lead) fields.name = lead[1];
    }
    const nights = t.match(/\b(?:for\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+nights?\b/i);
    if (nights) fields.nights = String(numberOf(nights[1]));
    if (/\b(?:a|per|each)\s+night\b|\bnightly\b/i.test(t)) fields.priceKind = 'per_night';
    else if (price && /\b(?:whole|entire|total|for the stay)\b/i.test(t)) fields.priceKind = 'stay';
  } else if (kind === 'activity') {
    // Everything before the price is the activity's name.
    const cut = price ? t.slice(0, price.at) : t;
    const name = cut.replace(/\b(?:it'?s|it is|costs?|for|at|about)\s*$/i, '').replace(/[,.\s]+$/, '').trim();
    if (name) fields.name = name.charAt(0).toUpperCase() + name.slice(1);
  }

  return { fields, found: Object.keys(fields) };
}
