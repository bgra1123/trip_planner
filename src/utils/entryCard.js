// Input cards: a guided form per kind of thing (flight, train, hotel, activity)
// instead of a pasted block. This file is the logic only — turning what the
// user typed into an offer, and refusing, with a reason, anything that would
// make a wrong number:
//
//   - a price needs a currency the user chose (no default is assumed);
//   - a flight or train price needs the user's answer to "per traveler or
//     total?", and a count when it is per traveler (the planner adds prices up
//     as shown, so a wrong guess is a silently wrong total);
//   - a per-night hotel price needs the number of nights.
//
// The offer goes through the same normalizer as every other capture and lands
// in the review list; nothing reaches the plan until the user taps Add.

import { normalizeTime } from './tripAgentOffers.js';
import { metroOf } from './pasteResults.js';

export const KINDS = ['flight', 'train', 'hotel', 'activity'];
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'TRY', 'CHF'];

// City names to IATA city codes, so "New York" and "NYC" and "JFK" are one leg.
// Plain facts; a name not listed is kept as typed.
export const CITY_CODES = {
  'new york': 'NYC', 'new york city': 'NYC', nyc: 'NYC', paris: 'PAR', london: 'LON', milan: 'MIL', milano: 'MIL',
  rome: 'ROM', roma: 'ROM', istanbul: 'IST', munich: 'MUC', berlin: 'BER', madrid: 'MAD', barcelona: 'BCN',
  lisbon: 'LIS', amsterdam: 'AMS', vienna: 'VIE', zurich: 'ZRH', frankfurt: 'FRA', tokyo: 'TYO', osaka: 'OSA',
  seoul: 'SEL', beijing: 'BJS', shanghai: 'SHA', moscow: 'MOW', stockholm: 'STO', washington: 'WAS', chicago: 'CHI',
  'los angeles': 'LAX', 'san francisco': 'SFO', miami: 'MIA', boston: 'BOS', toronto: 'YTO', montreal: 'YMQ',
  'sao paulo': 'SAO', 'são paulo': 'SAO', rio: 'RIO', 'buenos aires': 'BUE', dubai: 'DXB', doha: 'DOH', athens: 'ATH',
  prague: 'PRG', budapest: 'BUD', copenhagen: 'CPH', dublin: 'DUB', brussels: 'BRU', geneva: 'GVA', venice: 'VCE',
  florence: 'FLR', naples: 'NAP', nice: 'NCE',
};

// "New York" -> NYC; "ewr" -> NYC (the airport is kept in `airport`); "Lyon" -> Lyon.
export function normalizeLeg(text) {
  const raw = String(text || '').trim();
  if (!raw) return { code: '', airport: '' };
  const named = CITY_CODES[raw.toLowerCase()];
  if (named) return { code: named, airport: '' };
  if (/^[A-Za-z]{3}$/.test(raw)) {
    const code = raw.toUpperCase();
    const city = metroOf(code);
    return { code: city, airport: city !== code ? code : '' };
  }
  return { code: raw, airport: '' };
}

// "6:30 pm", "6.30pm", "6pm", "18:30" -> "18:30"; '' when it isn't a clock time.
export function readClock(text) {
  const raw = String(text || '').trim().toLowerCase().replace(/\./g, ':').replace(/\s+/g, ' ');
  if (!raw) return '';
  const hourOnly = raw.match(/^(\d{1,2})\s?(am|pm)$/);
  return normalizeTime(hourOnly ? `${hourOnly[1]}:00 ${hourOnly[2]}` : raw);
}

const positive = (x) => Number.isFinite(x) && x > 0;

export function emptyCard(kind) {
  const common = { price: '', currency: '', note: '', window: '' };
  if (kind === 'hotel') return { ...common, place: '', name: '', priceKind: '', nights: '' };
  if (kind === 'activity') return { ...common, name: '', place: '' };
  return { ...common, from: '', to: '', depart: '', arrive: '', carrier: '', fare: '', stops: '', basis: '', travelers: '' };
}

// -> { errors: [{ field, message }], raw, travelers }
//    raw is the offer for normalizeOffers(); travelers is set only when the user
//    said the price is per traveler (pass it to totalForTravelers).
export function buildOfferFromCard(kind, values) {
  const v = values || {};
  const errors = [];
  const fail = (field, message) => errors.push({ field, message });
  const priceText = String(v.price || '').trim().replace(/,/g, '');
  const hasPrice = priceText !== '';
  const amount = hasPrice ? Number(priceText) : null;

  if (hasPrice && !positive(amount)) fail('price', 'Enter the price as a number, like 612.');
  if (hasPrice && !CURRENCIES.includes(v.currency)) fail('currency', 'Choose the currency. It is never assumed.');

  const raw = { kind, detail: '', window: String(v.window || '').trim() };
  const details = [];
  let travelers = '';

  if (kind === 'flight' || kind === 'train') {
    const from = normalizeLeg(v.from);
    const to = normalizeLeg(v.to);
    if (!from.code) fail('from', 'Where from?');
    if (!to.code) fail('to', 'Where to?');
    if (from.code && to.code && from.code === to.code && !(from.airport || to.airport)) fail('to', 'From and to are the same place.');
    const dep = String(v.depart || '').trim() ? readClock(v.depart) : '';
    const arr = String(v.arrive || '').trim() ? readClock(v.arrive) : '';
    if (String(v.depart || '').trim() && !dep) fail('depart', 'Read that as a time like 6:30 pm or 18:30.');
    if (String(v.arrive || '').trim() && !arr) fail('arrive', 'Read that as a time like 7:45 am or 07:45.');
    if (hasPrice) {
      if (v.basis !== 'per_traveler' && v.basis !== 'total') fail('basis', 'Is that price per traveler, or the total for everyone? Pick one.');
      if (v.basis === 'per_traveler') {
        const n = Math.round(Number(v.travelers));
        if (!(n >= 1 && n <= 20)) fail('travelers', 'How many people are travelling?');
        else travelers = String(n);
      }
    }
    if (from.airport || to.airport) details.push(`airports: ${from.airport || from.code} → ${to.airport || to.code}`);
    if (String(v.fare || '').trim()) details.push(`fare: ${String(v.fare).trim().slice(0, 60)}`);
    Object.assign(raw, {
      from: from.code,
      to: to.code,
      departure: dep,
      arrival: arr,
      carrier: String(v.carrier || '').trim().slice(0, 40),
      stops: v.stops === '' || v.stops === undefined ? null : Number(v.stops),
    });
  } else if (kind === 'hotel') {
    const place = String(v.place || '').trim();
    if (!place) fail('place', 'Which city is the hotel in?');
    if (hasPrice && v.priceKind !== 'per_night' && v.priceKind !== 'stay') fail('priceKind', 'Is that per night, or for the whole stay?');
    const nights = Math.round(Number(v.nights));
    if (v.priceKind === 'per_night' && hasPrice && !(nights >= 1)) fail('nights', 'How many nights?');
    Object.assign(raw, {
      place,
      label: String(v.name || '').trim().slice(0, 80),
      perNight: v.priceKind === 'per_night',
      nights: nights >= 1 ? nights : undefined,
    });
  } else if (kind === 'activity') {
    const name = String(v.name || '').trim();
    if (!name) fail('name', 'What is the activity?');
    // The planner can't know a headcount for an activity, so the price entered
    // is the price for everyone, and the card says so.
    Object.assign(raw, { place: String(v.place || '').trim() || name, label: name });
  } else {
    fail('kind', 'Unknown kind of card.');
  }

  if (hasPrice && positive(amount) && CURRENCIES.includes(v.currency)) raw.price = { amount, currency: v.currency };
  if (String(v.note || '').trim()) details.push(String(v.note).trim());
  raw.detail = details.join(' · ');
  return { errors, raw, travelers };
}
