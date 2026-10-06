// TripAgent offer normalization.
//
// Everything that arrives from outside the app — the Chrome extension
// scraping a booking site, or the backend flight proxy — is funnelled
// through here first. The rest of the app never sees a scraper's shape:
// it only ever sees editable table rows (the same {id, category, group,
// option, timeText, costText, detail, window} shape parseTripNotes.js
// produces), so captured offers stay fully editable and take part in the
// combination/cost logic exactly like hand-typed ones.
//
// Shared by the React app and the Node scripts, so it stays dependency-free
// ESM with explicit .js import specifiers.

import { newRowId, parseCost, costTextIssue, linesToRows, parseTimes, CURRENCY_SYMBOLS } from './parseTripNotes.js';

export const OFFER_PROTOCOL = 'tripagent/v1';
export const MSG_FROM_EXTENSION = 'tripagent-extension';
export const MSG_FROM_PAGE = 'tripagent-page';

// The planner's own currency vocabulary — imported rather than duplicated, so
// a currency added there is understood here immediately. A cost in a currency
// it does not know is preserved verbatim in the row's detail instead of being
// silently mangled into euros.
//
// This only decides whether a cost can be *written*. Whether it can be
// *totalled* is a separate question, answered by a `RATE: <CODE> <factor>`
// line in the notes; without one the planner excludes the cost from sums
// rather than guessing 1:1.
const CURRENCY_SYMBOL = CURRENCY_SYMBOLS;

// Reverse of CURRENCY_SYMBOLS ('₺' -> 'TRY'), built from the same table so
// scraped text is read with exactly the vocabulary the planner writes.
const CODE_FOR_SYMBOL = Object.keys(CURRENCY_SYMBOLS).reduce((acc, code) => {
  acc[CURRENCY_SYMBOLS[code]] = code;
  return acc;
}, {});

// Character class of the single-character symbols only: multi-character
// markers like "CHF" are matched by the ISO-code pattern instead.
const SYMBOL_RE = new RegExp('['
  + Object.keys(CODE_FOR_SYMBOL).filter((sym) => sym.length === 1)
      .map((sym) => sym.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('')
  + ']');

const KINDS = { flight: 'travel', train: 'travel', bus: 'travel', ferry: 'travel', car: 'travel', hotel: 'stay', stay: 'stay', activity: 'activity' };

export function categoryForKind(kind) {
  return KINDS[String(kind || '').toLowerCase()] || 'travel';
}

// "6:45 AM" / "18:05" / "6:45" / "2026-08-14T06:45:00" -> "06:45".
// Returns '' for anything we cannot read as a clock time, so a bad scrape
// leaves the cell empty rather than poisoning the itinerary with a fake
// departure. ISO timestamps are matched first: there is no word boundary
// between the date's "T" and the hour, so the loose pattern misses them.
export function normalizeTime(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  const m = text.match(/\d{4}-\d{2}-\d{2}[T ](\d{1,2}):(\d{2})/)
    || text.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!m) return '';
  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (minute > 59) return '';
  const meridiem = m[3] ? m[3].toLowerCase() : null;
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour > 23) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// Accepts a number, "€2,100", "2100 EUR", "$1,234.56", or an object
// {amount|low|high, currency}. Returns {low, high, currency} or null.
export function normalizePrice(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { low: value, high: value, currency: 'EUR' } : null;
  }
  if (typeof value === 'object') {
    const currency = normalizeCurrency(value.currency);
    const low = toNumber(value.low !== undefined ? value.low : value.amount);
    const high = toNumber(value.high !== undefined ? value.high : value.amount);
    if (low === null && high === null) return null;
    const lo = low === null ? high : low;
    const hi = high === null ? low : high;
    return { low: Math.min(lo, hi), high: Math.max(lo, hi), currency };
  }
  const text = String(value);
  // The trailing boundary is a lookahead for a digit *or* a boundary: in
  // "TRY45000" there is no \b between "Y" and "4", so requiring \b here
  // dropped the currency and silently defaulted the amount to euros.
  const codeMatch = text.match(/\b(EUR|USD|GBP|TRY|CHF|SEK|NOK|DKK|PLN|CZK|JPY|CAD|AUD)(?=\d|\b)/i);
  const symbolMatch = text.match(SYMBOL_RE);
  const currency = codeMatch
    ? codeMatch[1].toUpperCase()
    : (symbolMatch ? symbolFromChar(symbolMatch[0]) : 'EUR');
  // Strip nights multipliers first: "x3", "for 3 nights", "3 nights". They
  // are quantities, not prices, and would otherwise be scooped up as the low
  // end of a range ("€140/night x3" reading as 3–140).
  const amountText = text
    .replace(/\bx\s?\d+\b/i, ' ')
    .replace(/\bfor\s+\d+\s+nights?\b/i, ' ')
    .replace(/\b\d+\s+nights?\b/i, ' ');
  const numbers = amountText.match(/\d+(?:[.,]\d+)*/g);
  if (!numbers || !numbers.length) return null;
  const parsed = numbers.map(toNumber).filter((n) => n !== null);
  if (!parsed.length) return null;
  return { low: Math.min(...parsed), high: Math.max(...parsed), currency };
}

function symbolFromChar(ch) {
  return CODE_FOR_SYMBOL[ch] || 'EUR';
}

function normalizeCurrency(value) {
  const code = String(value || 'EUR').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(code)) return code;
  return symbolFromChar(code) || 'EUR';
}

// "1.234,56" (de) vs "1,234.56" (en) vs "2,100" — decide which separator is
// the decimal one by which appears last, and treat a lone separator with
// exactly 3 trailing digits as a thousands group.
function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;
  let text = String(value).replace(/[^\d.,-]/g, '');
  if (!text) return null;
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const groupSep = decimalSep === ',' ? '.' : ',';
    text = text.split(groupSep).join('').replace(decimalSep, '.');
  } else if (lastComma !== -1) {
    text = /,\d{3}$/.test(text) ? text.split(',').join('') : text.replace(',', '.');
  } else if (lastDot !== -1 && /\.\d{3}$/.test(text) && text.split('.').length === 2 && text.length > 5) {
    text = text.split('.').join('');
  }
  const n = parseFloat(text);
  return Number.isFinite(n) ? n : null;
}

function clean(value) {
  return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
}

function stableId(offer) {
  return `ta_${hash(offerKey(offer))}`;
}

function hash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Identity of an offer for dedupe purposes: the same flight captured twice
// (a reload, a second tab, backend + extension both reporting it) collapses
// to one entry, while a genuinely different price or time does not.
export function offerKey(offer) {
  // A stay's real identity is its name: two strategies scraping the same
  // page (JSON-LD vs. the text heuristic, say) can disagree on whether a
  // place was parseable, landing the same hotel under group "Milan" from one
  // and "" from the other. Keying stays on label instead collapses that
  // duplicate; travel keeps group, since the route genuinely is its identity.
  const identity = categoryForKind(offer.kind) === 'stay' ? (offer.label || offer.group) : offer.group;
  return [
    offer.kind,
    identity,
    offer.departure || '',
    offer.arrival || '',
    offer.carrier || '',
    offer.price ? `${offer.price.low}-${offer.price.high}-${offer.price.currency}` : 'na',
    offer.window || '',
  ].join('|');
}

// Raw scraper/API payload -> canonical offer. Returns null when the payload
// carries nothing usable (no route/place AND no price), so a partial scrape
// is dropped instead of creating an empty row the user has to clean up.
export function normalizeOffer(raw, defaults = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = String(raw.kind || raw.type || defaults.kind || 'flight').toLowerCase();
  const category = categoryForKind(kind);
  const from = clean(raw.from || raw.origin || raw.departureAirport);
  const to = clean(raw.to || raw.destination || raw.arrivalAirport);
  const place = clean(raw.place || raw.city || raw.location || raw.name);

  let group = '';
  if (category === 'travel') group = from && to ? `${from} → ${to}` : clean(raw.group || raw.route);
  else if (category === 'stay') group = place || clean(raw.group);

  const price = normalizePrice(raw.price !== undefined ? raw.price : raw.cost);
  const departure = normalizeTime(raw.departure || raw.departureTime || raw.checkIn);
  const arrival = normalizeTime(raw.arrival || raw.arrivalTime || raw.checkOut);

  if (category !== 'activity' && !group && !price) return null;
  if (category === 'activity' && !place && !price) return null;

  const nightsRaw = raw.nights !== undefined ? raw.nights : raw.numberOfNights;
  const nights = Number.isFinite(Number(nightsRaw)) && Number(nightsRaw) > 0 ? Math.round(Number(nightsRaw)) : 1;

  const offer = {
    kind,
    category,
    group,
    carrier: clean(raw.carrier || raw.airline || raw.operator || raw.provider),
    departure,
    arrival,
    duration: clean(raw.duration),
    // raw.stops is null/undefined whenever a stop count does not apply (any
    // non-flight capture, or a flight page with no stops text) — Number(null)
    // is 0, so coercing blindly turned "not applicable" into "nonstop".
    stops: raw.stops === null || raw.stops === undefined || raw.stops === ''
      ? null
      : (Number.isFinite(Number(raw.stops)) ? Number(raw.stops) : null),
    price,
    perNight: !!(raw.perNight || raw.pricePerNight),
    nights,
    window: clean(raw.window || defaults.window),
    label: clean(raw.label || raw.title || place),
    detail: clean(raw.detail || raw.description),
    source: clean(raw.source || defaults.source) || 'unknown',
    sourceUrl: clean(raw.sourceUrl || raw.url || defaults.sourceUrl),
    capturedAt: clean(raw.capturedAt) || new Date().toISOString(),
  };
  offer.id = clean(raw.id) || stableId(offer);
  return offer;
}

export function normalizeOffers(list, defaults = {}) {
  if (!Array.isArray(list)) return [];
  return list.map((raw) => normalizeOffer(raw, defaults)).filter(Boolean);
}

// Cost shorthand the app's own parseCost() can read back
// ("€2100", "€250-350", "€140/night x3"). Returns '' when the currency is
// one parseCost cannot parse — offerToRow() then keeps the raw price in the
// detail column so nothing is lost, and the user retypes it in their own
// currency rather than getting a wrong number.
export function offerCostText(offer) {
  if (!offer.price) return '';
  const symbol = CURRENCY_SYMBOL[offer.price.currency];
  if (!symbol) return '';
  const round = (n) => (Math.abs(n - Math.round(n)) < 0.005 ? String(Math.round(n)) : n.toFixed(2));
  let text = offer.price.low === offer.price.high
    ? `${symbol}${round(offer.price.low)}`
    : `${symbol}${round(offer.price.low)}-${round(offer.price.high)}`;
  if (offer.perNight) {
    text += '/night';
    if (offer.nights > 1) text += ` x${offer.nights}`;
  }
  return text;
}

function offerOptionLabel(offer) {
  if (offer.label) return offer.label;
  const parts = [];
  if (offer.carrier) parts.push(offer.carrier);
  if (offer.departure) parts.push(`${offer.departure} departure`);
  if (!parts.length && offer.group) parts.push(offer.group);
  return parts.join(' ') || 'Captured option';
}

function offerDetail(offer) {
  const bits = [];
  if (offer.detail) bits.push(offer.detail);
  if (offer.duration) bits.push(offer.duration);
  // "Stops" only means anything for travel — a stay or activity with a
  // leftover stops value of 0 is "not applicable", not "nonstop".
  if (offer.category === 'travel') {
    if (offer.stops === 0) bits.push('nonstop');
    else if (offer.stops > 0) bits.push(`${offer.stops} stop${offer.stops === 1 ? '' : 's'}`);
  }
  // An unrepresentable currency would otherwise vanish: keep the number the
  // scraper actually saw, flagged so it is obvious it needs a manual entry.
  if (offer.price && !CURRENCY_SYMBOL[offer.price.currency]) {
    const amount = offer.price.low === offer.price.high
      ? `${offer.price.low}`
      : `${offer.price.low}-${offer.price.high}`;
    bits.push(`price ${offer.price.currency} ${amount} (enter manually)`);
  }
  if (offer.source && offer.source !== 'unknown') bits.push(`via ${offer.source}`);
  return bits.join(' · ');
}

// Canonical offer -> editable table row. Row ids come from the same
// counter as hand-added rows so selection maps never collide. Pass an
// explicit `id` to build a throwaway row for display without consuming a
// counter value (see offerPreviewRow).
export function offerToRow(offer, id) {
  const timeText = offer.departure && offer.arrival
    ? `${offer.departure}-${offer.arrival}`
    : (offer.departure || offer.arrival || '');
  return {
    id: id || newRowId(),
    category: offer.category,
    group: offer.category === 'activity' ? '' : offer.group,
    option: offerOptionLabel(offer),
    timeText,
    costText: offerCostText(offer),
    detail: offerDetail(offer),
    window: offer.window || '',
    sourceUrl: offer.sourceUrl || '',
  };
}

export function offersToRows(offers) {
  return offers.map((offer) => offerToRow(offer));
}

// Same row, rendered for preview only — keyed by the offer's own id so
// repeated renders never advance the shared row-id counter.
export function offerPreviewRow(offer) {
  return offerToRow(offer, `preview-${offer.id}`);
}

// True when the row's cost is both present and fully understood. This defers
// to the planner's own costTextIssue(), which is stricter than parseCost
// alone: it also rejects text that only *partly* parsed, like the typo
// "EUR21OO" (letter O for zero) that would otherwise read as 21.
export function rowCostIsParseable(row) {
  if (!row.costText) return false;
  return !costTextIssue(row.costText);
}

// Currencies used by these offers that have no conversion rate on file, so
// the planner would exclude them from its totals. The panel surfaces this
// before the rows are added, since the fix is a `RATE: <CODE> <factor>` line
// the user has to supply — not something a scraper can invent.
export function currenciesNeedingRate(offers, rates = {}, base = 'EUR') {
  const missing = [];
  offers.forEach((offer) => {
    if (!offer.price) return;
    const code = offer.price.currency;
    if (!code || code === base) return;
    if (rates[code] !== undefined) return;
    if (missing.indexOf(code) === -1) missing.push(code);
  });
  return missing;
}

// Trip-notes text (the FLIGHT:/HOTEL:/RATE: shorthand) -> canonical offers.
//
// This is how a hand-reviewed text selection from the extension enters
// staging: rather than teach the extension the notes grammar, it sends the
// lines over and the planner's own linesToRows() does the parsing. Any
// RATE: lines in the text come back alongside, since a captured price in
// lira is only totalable with its rate.
// parseCost() hands back a per-night cost already expanded across the stay
// (€140/night x3 -> 420). A canonical offer carries the *unit* price plus
// perNight/nights, because offerCostText() re-applies the "/night xN" suffix.
// Without dividing back out, the cost would be multiplied by the nights twice.
function perNightUnit(cost) {
  if (!cost.perNight || !cost.nights || cost.nights <= 1) return { low: cost.low, high: cost.high };
  return { low: cost.low / cost.nights, high: cost.high / cost.nights };
}

export function offersFromNotesText(text, defaults = {}) {
  const { rows, rates } = linesToRows(String(text || ''));
  const offers = rows.map((row) => {
    const cost = parseCost(row.costText || '');
    const times = parseTimes(row.timeText || '');
    return normalizeOffer({
      kind: row.category,
      group: row.group,
      place: row.category === 'stay' ? row.group : (row.category === 'activity' ? row.option : ''),
      label: row.option,
      departure: times.from,
      arrival: times.to,
      // parseCost() has already resolved currency, range and per-night
      // expansion for this text; passing its result avoids re-reading the
      // string with the permissive scraped-text parser, which would take the
      // "3" in "EUR140/night x3" for a price.
      price: cost ? { ...perNightUnit(cost), currency: cost.currency } : null,
      perNight: cost ? cost.perNight : false,
      nights: cost ? cost.nights : 1,
      detail: row.detail,
      window: row.window,
    }, { source: defaults.source || 'selection', sourceUrl: defaults.sourceUrl || '' });
  }).filter(Boolean);
  return { offers, rates: rates || {} };
}

// A pasted link (a shared reel, a blog post, a listing — anything) plus the
// user's own short note about it becomes an activity offer, the same way a
// scraped page or a pasted notes block does. There is no fetch of the URL
// and no attempt to extract a place or a price from it: the note the user
// typed IS the activity's description, and the link is only preserved
// (never guessed at or dropped) by folding it into the row's detail text via
// offerDetail() below. Returns null if either half is missing — no
// half-formed row, and nothing invented to fill the gap.
export function offerFromLink(url, note, defaults = {}) {
  const cleanUrl = clean(url);
  const cleanNote = clean(note);
  if (!cleanUrl || !cleanNote) return null;
  return normalizeOffer({
    kind: 'activity',
    name: cleanNote,
    label: cleanNote,
    detail: `Saved link: ${cleanUrl}`,
    sourceUrl: cleanUrl,
  }, { source: defaults.source || 'link' });
}

// A price the user read off their own internal system (a card's travel
// portal, a quote email, anything the extension cannot reach) typed straight
// into a row — the same shape a scraped offer becomes, built directly rather
// than routed through normalizeOffer's scraper-shaped field guessing, since
// there is no raw payload here, only what the user already typed by hand.
// Returns null when there is nothing worth adding (no group/option AND no
// price), so an empty form submit never creates a blank row.
export function rowFromQuickEntry(fields = {}) {
  const category = ['travel', 'stay', 'activity'].includes(fields.category) ? fields.category : 'travel';
  const group = category === 'activity' ? '' : clean(fields.group);
  const option = clean(fields.option);
  const costText = clean(fields.cost);
  if (!group && !option && !costText) return null;
  return {
    id: newRowId(),
    category,
    group,
    option: option || (group ? `${group} option` : 'Captured option'),
    timeText: clean(fields.time),
    costText,
    detail: clean(fields.detail),
    window: clean(fields.window),
  };
}

// Merge incoming offers into the captured list, newest first, keeping at
// most `limit` and collapsing re-captures of the same offer.
export function mergeOffers(existing, incoming, limit = 100) {
  const merged = [];
  const seen = Object.create(null);
  [...incoming, ...existing].forEach((offer) => {
    const key = offerKey(offer);
    if (seen[key]) return;
    seen[key] = true;
    merged.push(offer);
  });
  return merged.slice(0, limit);
}
