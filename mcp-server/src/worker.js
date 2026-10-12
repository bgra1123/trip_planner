// TripAgent — the one MCP server between Claude and the trip planner.
// A Cloudflare Worker.
//
// Claude (in the Claude app, any device, by voice or typing) reads and records
// travel options for the user's trips here; the planner (a static web app)
// keeps each trip's snapshot here too, so both sides see the same trips.
//
// Two kinds of data, owned by different sides, so neither can overwrite the
// other's work:
//   snap:TOKEN:TRIP   the planner's copy of the trip (rows, picks, rates).
//                     Written only by the planner. Claude reads it.
//   pend:TOKEN:TRIP   options Claude recorded that the user has not yet added
//                     or dismissed. Written by Claude's tools; the planner
//                     acknowledges (clears) each one when the user reviews it.
// Nothing Claude records reaches a plan until the user taps Add in the planner.
// Trips themselves need no approval: an empty trip risks nothing, and the
// planner picks up a trip Claude creates on its next sync.
//
// Routes (TOKEN is the TRIP_TOKEN secret — the whole URL is the credential):
//   POST   /mcp/TOKEN                      MCP, Streamable HTTP (stateless JSON)
//   GET    /api/TOKEN/trips                planner: list trips
//   GET    /api/TOKEN/trips/ID             planner: one trip's snapshot
//   PUT    /api/TOKEN/trips/ID             planner: save a trip's snapshot
//   DELETE /api/TOKEN/trips/ID             planner: delete a trip
//   GET    /api/TOKEN/trips/ID/pending     planner: options waiting for review
//   POST   /api/TOKEN/trips/ID/ack         planner: { ids } reviewed — forget them
//   GET|PUT /api/TOKEN/active              the trip open in the planner: { tripId }
//   POST   /api/TOKEN/trips/ID/offers      a capture tool (the browser extension): { offers?, notes?, source? }
//                                          into that trip's review list. ID may
//                                          be "active" — the trip open in the planner.
//
// Every option goes through the planner's own normalizeOffers(), and trip
// paths and rankings are computed with the planner's own grouping and cost
// code, so Claude is told exactly what the planner would show.

import { normalizeOffers, mergeOffers, offerCostText, offersFromNotesText } from '../../src/utils/tripAgentOffers.js';
import {
  groupRows, deriveRouteChain, enumerateCombinations, pickedOption, costLabel, euro, sumRange,
} from '../../src/utils/parseTripNotes.js';

const SERVER_INFO = { name: 'tripagent', version: '2.0.0' };
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_PENDING = 200;
const MAX_TRIPS = 50;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_SNAPSHOT_BYTES = 512 * 1024;
const COMBO_CAP = 4000;
const DEFAULT_ORIGINS = ['https://bgra1123.github.io', 'http://localhost:3000', 'http://127.0.0.1:3000'];
const TRIP_ID_RE = /^[A-Za-z0-9_-]{6,40}$/;

const INSTRUCTIONS = `This server holds the user's trips in their trip planner. Typical use: the user shares a screenshot, or pastes the text of a results page, from a booking site or credit-card travel portal (Capital One Travel, Amex Travel and the like), or dictates a flight or hotel; record every option with add_trip_options. Pasted page text is more reliable than a screenshot — read the numbers from it exactly, and ignore menus, filters and ads around the results. Card portals quote in the card's currency (usually USD) and often show a miles/points price beside the cash price: the cash price goes in price, the points go in note, never the other way round. Hotels from a card program (e.g. Amex Fine Hotels + Resorts) get the program name in note. Only record what is actually stated or shown — never estimate or invent a price, time, or airline. If a price is per person, multiply by the number of travelers before recording it (ask how many if it isn't clear), and say you did. If the user corrects something you recorded, use update_trip_option; to drop one, remove_trip_option (both need the option's id, shown by list_pending_options and add_trip_options). Options land in the planner's review list and the user taps Add there — tell them they are waiting for review, not added. Only call create_trip when the user asks for a new trip.

To find public options, use whatever flight, hotel or train search tools the user has connected (other connectors in this chat), then record the results here with add_trip_options: one entry per result you want them to consider, copying each price, time and carrier exactly as the search returned it, with the search's name as source (e.g. "Expedia") and the date range as window. Use the currency the search quoted, and totals for everyone travelling. Search results are live quotes that can change, so say so and never present one as booked. Do not book anything. Do not record results you did not see.`;

const TRIP_ID_PROP = { type: 'string', description: 'Trip id from list_trips. Optional when the user has exactly one trip.' };

const OPTION_PROPERTIES = {
  kind: { type: 'string', enum: ['flight', 'train', 'bus', 'ferry', 'hotel', 'activity'] },
  from: { type: 'string', description: 'Origin city or airport code (travel only), e.g. "NYC" or "JFK".' },
  to: { type: 'string', description: 'Destination city or airport code (travel only).' },
  place: { type: 'string', description: 'City a hotel is in, e.g. "Paris" (hotels only). Hotels with the same place are compared as alternatives.' },
  name: { type: 'string', description: 'Hotel name, activity name, or a short label for the option.' },
  departure: { type: 'string', description: 'Departure time as shown, 24h HH:MM preferred (travel only).' },
  arrival: { type: 'string', description: 'Arrival time as shown, 24h HH:MM preferred (travel only).' },
  carrier: { type: 'string', description: 'Airline or operator, if shown.' },
  stops: { type: 'integer', minimum: 0, description: 'Number of stops, if shown (0 = nonstop).' },
  price: { type: 'number', description: 'Cash price for the whole booking (all travelers), exactly as it should total. Omit entirely if no cash price is known — never estimate one.' },
  currency: { type: 'string', description: 'ISO 4217 code of that price, e.g. "USD", "EUR". Required whenever price is given.' },
  per_night: { type: 'boolean', description: 'True if the hotel price is per night rather than for the whole stay.' },
  nights: { type: 'integer', minimum: 1, description: 'Number of nights, for a per-night hotel price.' },
  url: { type: 'string', description: 'Link to the page this result came from (https://…), if you know it, so the user can reopen the exact result.' },
  note: { type: 'string', description: 'Anything else worth keeping: a points/miles price ("45,000 points" — never put points in price), card program ("Amex FHR"), traveler count ("2 travelers"), refundability, cabin.' },
};

const TOOLS = [
  {
    name: 'list_trips',
    title: 'List trips',
    description: 'List the user\'s trips: id, route, how many items are in the plan, and how many recorded options are waiting for their review.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'create_trip',
    title: 'Create a trip',
    description: 'Create a new, empty trip and return its id. Only call this when the user asks for a new trip (or says to start a new one when none fits) — never create one silently. No approval is needed; it appears in the planner on its next sync.',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string', description: 'Short name, e.g. "Paris in October".' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'add_trip_options',
    title: 'Add trip options',
    description: 'Record travel options the user found — read from a screenshot or pasted page text of search results, or dictated — into a trip for their review. Include every option, one entry each. Prices are totals for everyone travelling: if a displayed price is per person, multiply it by the number of travelers (ask if unknown) and mention that in note. If a price is only points or miles, leave price out and put the points in note. Do not invent or estimate anything that was not stated or shown.',
    inputSchema: {
      type: 'object',
      properties: {
        tripId: TRIP_ID_PROP,
        options: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', properties: OPTION_PROPERTIES, required: ['kind'], additionalProperties: false } },
        window: { type: 'string', description: 'Optional date-range label like "21-24 Oct". Options with the same label are only compared with each other.' },
        source: { type: 'string', description: 'Where the prices came from, e.g. "Capital One Travel", or "dictated".' },
      },
      required: ['options'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'update_trip_option',
    title: 'Update a recorded option',
    description: 'Correct an option that is still waiting for review (not yet added to the plan in the planner). Pass only the fields that change; the rest stay. Use the id from list_pending_options or add_trip_options — the id changes after an update, and the result gives the new one. Changing price without currency keeps the option\'s existing currency.',
    inputSchema: {
      type: 'object',
      properties: {
        tripId: TRIP_ID_PROP,
        optionId: { type: 'string', description: 'Id of the option to change.' },
        changes: { type: 'object', properties: { ...OPTION_PROPERTIES, window: { type: 'string', description: 'Date-range label; empty string clears it.' } }, additionalProperties: false, description: 'Only the fields to change. An empty string clears a text field.' },
      },
      required: ['optionId', 'changes'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'remove_trip_option',
    title: 'Remove a recorded option',
    description: 'Remove an option that is still waiting for review, because the user says it was wrong or they don\'t want it. It cannot remove anything already added to the plan.',
    inputSchema: {
      type: 'object',
      properties: { tripId: TRIP_ID_PROP, optionId: { type: 'string', description: 'Id of the option to remove.' } },
      required: ['optionId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'list_pending_options',
    title: 'List options waiting for review',
    description: 'List the options recorded in a trip that the user has not yet added or dismissed in the planner, with their ids.',
    inputSchema: { type: 'object', properties: { tripId: TRIP_ID_PROP }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_trip_path',
    title: 'Show a trip\'s path',
    description: 'Show the trip as the planner shows it: the ordered travel legs and stays, the option currently picked at each, its cost, the other options available, and the total.',
    inputSchema: { type: 'object', properties: { tripId: TRIP_ID_PROP }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'optimize_trip',
    title: 'Rank a trip\'s combinations by cost',
    description: 'Rank every valid combination of the trip\'s travel and stay options by total cost, cheapest first — the same ranking as the planner\'s "Compare all combinations". A combination never mixes options from different date windows. Only covers options already added to the plan.',
    inputSchema: {
      type: 'object',
      properties: {
        tripId: TRIP_ID_PROP,
        window: { type: 'string', description: 'Only this date window, e.g. "21-24 Oct". Omit for all.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many to return (default 10).' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

// ---- storage ---------------------------------------------------------------
// KV key metadata (title, route, count) lets list_trips run without reading
// every snapshot.

const snapKey = (token, id) => `snap:${token}:${id}`;
const pendKey = (token, id) => `pend:${token}:${id}`;
const activeKey = (token) => `active:${token}`;

function newTripId() {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return `t${Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('')}`.slice(0, 20);
}

async function getTrip(env, token, id) {
  const raw = await env.TRIPS.get(snapKey(token, id));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function ratesOf(snapshot) {
  const rates = {};
  ((snapshot && snapshot.rateRows) || []).forEach((r) => {
    const code = String(r.code || '').trim().toUpperCase();
    const val = parseFloat(r.factor);
    if (code && !Number.isNaN(val)) rates[code] = val;
  });
  return rates;
}

function routeOf(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.rows) || !snapshot.rows.length) return '';
  try {
    const parsed = groupRows(snapshot.rows, snapshot.notes || [], ratesOf(snapshot));
    return deriveRouteChain(parsed.travel).join(' → ');
  } catch { return ''; }
}

async function putTrip(env, token, trip) {
  const itemCount = trip.snapshot && Array.isArray(trip.snapshot.rows) ? trip.snapshot.rows.length : 0;
  await env.TRIPS.put(snapKey(token, trip.id), JSON.stringify(trip), {
    metadata: { title: trip.title, route: routeOf(trip.snapshot), itemCount, updatedAt: trip.updatedAt },
  });
}

async function readPending(env, token, tripId) {
  const raw = await env.TRIPS.get(pendKey(token, tripId));
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function writePending(env, token, tripId, list) {
  return env.TRIPS.put(pendKey(token, tripId), JSON.stringify(list.slice(0, MAX_PENDING)));
}

async function listTrips(env, token) {
  const trips = [];
  let cursor;
  do {
    const page = await env.TRIPS.list({ prefix: `snap:${token}:`, cursor });
    page.keys.forEach((k) => trips.push({ id: k.name.slice(`snap:${token}:`.length), ...(k.metadata || {}) }));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && trips.length < 200);
  await Promise.all(trips.map(async (t) => { t.pendingCount = (await readPending(env, token, t.id)).length; }));
  return trips.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// The trip open in the planner — where a capture tool with no trip of its own
// (the browser extension) sends things.
async function getActiveId(env, token) {
  const raw = await env.TRIPS.get(activeKey(token));
  if (!raw) return null;
  try { const { tripId } = JSON.parse(raw); return TRIP_ID_RE.test(String(tripId)) ? String(tripId) : null; } catch { return null; }
}

const tripLine = (t, activeId) => `- ${t.id}: ${t.title || 'Untitled trip'}${t.route ? ` (${t.route})` : ''} — ${t.itemCount || 0} in plan, ${t.pendingCount || 0} waiting for review${t.id === activeId ? ' [open in the planner now]' : ''}`;

// ---- tools -----------------------------------------------------------------

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

// Which trip a tool means. With one trip it is unambiguous; otherwise Claude
// must ask the user rather than guess.
async function resolveTrip(args, env, token) {
  if (args && args.tripId) {
    if (!TRIP_ID_RE.test(String(args.tripId))) return { error: textResult('That is not a trip id — use list_trips to see them.', true) };
    const trip = await getTrip(env, token, String(args.tripId));
    return trip ? { trip } : { error: textResult(`No trip with id ${args.tripId}. Use list_trips to see the user's trips.`, true) };
  }
  const trips = await listTrips(env, token);
  if (!trips.length) {
    return { error: textResult('The user has no trips yet. Ask whether to start one, then call create_trip — or have them open the planner once so their trip syncs here.', true) };
  }
  if (trips.length > 1) {
    const activeId = await getActiveId(env, token);
    return { error: textResult(`The user has ${trips.length} trips — ask which one they mean, then pass its tripId:\n${trips.map((t) => tripLine(t, activeId)).join('\n')}`, true) };
  }
  return { trip: await getTrip(env, token, trips[0].id) };
}

// Tool input -> the raw offer shape normalizeOffers() reads. A price with no
// currency is refused rather than defaulted: a "320" assumed to be euros
// would be wrong by the exchange rate, silently.
function rawFromOption(option, windowLabel) {
  const problems = [];
  if (option.price !== undefined && option.price !== null && !option.currency) {
    problems.push('price given without a currency');
  }
  const raw = {
    kind: option.kind,
    from: option.from,
    to: option.to,
    // An activity is identified by its name — a free one has no price, and
    // the validator needs one or the other.
    place: option.kind === 'activity' ? (option.place || option.name) : option.place,
    label: option.name,
    departure: option.departure,
    arrival: option.arrival,
    carrier: option.carrier,
    stops: option.stops,
    price: option.price !== undefined && option.price !== null && option.currency
      ? { amount: option.price, currency: option.currency }
      : undefined,
    perNight: option.per_night,
    nights: option.nights,
    detail: option.note,
    sourceUrl: option.url,
    window: windowLabel,
  };
  return { raw, problems };
}

function describeOffer(offer) {
  const where = offer.group || offer.label || offer.kind;
  const when = offer.departure ? ` ${offer.departure}${offer.arrival ? `-${offer.arrival}` : ''}` : '';
  const what = offer.category === 'stay' && offer.label && offer.label !== offer.group ? ` ${offer.label}`
    : (offer.carrier ? ` ${offer.carrier}` : '');
  const price = offerCostText(offer) || (offer.price ? `${offer.price.currency} ${offer.price.low}` : 'no cash price');
  return `- [${offer.id}] ${offer.kind}: ${where}${what}${when}, ${price}${offer.window ? ` {${offer.window}}` : ''}${offer.detail ? ` (${offer.detail})` : ''}`;
}

async function addTripOptions(args, env, token) {
  const options = Array.isArray(args.options) ? args.options : [];
  if (!options.length) return textResult('No options given — pass at least one entry in "options".', true);
  const { trip, error } = await resolveTrip(args, env, token);
  if (error) return error;

  const accepted = [];
  const rejected = [];
  options.forEach((option, i) => {
    const { raw, problems } = rawFromOption(option || {}, args.window);
    if (problems.length) { rejected.push(`#${i + 1}: ${problems.join(', ')}`); return; }
    const [offer] = normalizeOffers([raw], { source: args.source ? `claude · ${args.source}` : 'claude' });
    if (!offer) { rejected.push(`#${i + 1}: needs a route or place, or a price`); return; }
    accepted.push(offer);
  });

  if (accepted.length) {
    const pending = await readPending(env, token, trip.id);
    await writePending(env, token, trip.id, mergeOffers(pending, accepted, MAX_PENDING));
  }
  const lines = [];
  if (accepted.length) {
    lines.push(`Recorded ${accepted.length} option${accepted.length === 1 ? '' : 's'} in "${trip.title || 'Untitled trip'}" for review:`);
    accepted.forEach((o) => lines.push(describeOffer(o)));
    lines.push('They appear in the planner\'s TripAgent capture panel the next time it is opened; nothing is added to the plan until the user taps Add.');
  }
  if (rejected.length) {
    lines.push(`Not recorded (${rejected.length}): ${rejected.join('; ')}. Fix these and call add_trip_options again for just those.`);
  }
  return textResult(lines.join('\n'), !accepted.length);
}

function splitRoute(group) {
  const parts = String(group || '').split(' → ');
  return parts.length === 2 ? parts : ['', ''];
}

// A stored offer back into the raw shape normalizeOffers() reads, so an update
// is "the offer as it was, plus these changes" run through the same validation
// as a new one.
function rawFromOffer(o) {
  const [from, to] = o.category === 'travel' ? splitRoute(o.group) : ['', ''];
  return {
    kind: o.kind,
    from, to,
    place: o.category === 'stay' ? o.group : (o.category === 'activity' ? o.label : undefined),
    label: o.label,
    departure: o.departure,
    arrival: o.arrival,
    carrier: o.carrier,
    duration: o.duration,
    stops: o.stops,
    price: o.price ? { low: o.price.low, high: o.price.high, currency: o.price.currency } : undefined,
    perNight: o.perNight,
    nights: o.nights,
    detail: o.detail,
    sourceUrl: o.sourceUrl,
    window: o.window,
    capturedAt: o.capturedAt,
  };
}

const CHANGE_TO_RAW = { from: 'from', to: 'to', place: 'place', name: 'label', departure: 'departure', arrival: 'arrival', carrier: 'carrier', stops: 'stops', per_night: 'perNight', nights: 'nights', note: 'detail', url: 'sourceUrl', window: 'window', kind: 'kind' };

async function updateTripOption(args, env, token) {
  const changes = args.changes && typeof args.changes === 'object' ? args.changes : null;
  if (!args.optionId) return textResult('Pass the optionId of the option to change.', true);
  if (!changes || !Object.keys(changes).length) return textResult('No changes given — pass the fields to change in "changes".', true);
  const { trip, error } = await resolveTrip(args, env, token);
  if (error) return error;

  const pending = await readPending(env, token, trip.id);
  const current = pending.find((o) => o.id === args.optionId);
  if (!current) {
    return textResult(`No option ${args.optionId} is waiting for review in this trip — it may already have been added or dismissed in the planner. Use list_pending_options for current ids.`, true);
  }

  const raw = rawFromOffer(current);
  Object.keys(changes).forEach((key) => {
    if (CHANGE_TO_RAW[key]) raw[CHANGE_TO_RAW[key]] = changes[key];
  });
  if (changes.name !== undefined && current.category === 'activity') raw.place = changes.name;
  if (changes.price !== undefined || changes.currency !== undefined) {
    const currency = changes.currency || (current.price && current.price.currency);
    if (changes.price !== undefined && changes.price !== null && !currency) {
      return textResult('A price needs a currency — say which one it is.', true);
    }
    raw.price = changes.price !== undefined && changes.price !== null
      ? { amount: changes.price, currency }
      : (current.price ? { low: current.price.low, high: current.price.high, currency } : undefined);
  }

  const [updated] = normalizeOffers([raw], { source: current.source });
  if (!updated) return textResult('That change leaves the option with no route, place or price — nothing was changed.', true);

  const rest = pending.filter((o) => o.id !== current.id);
  await writePending(env, token, trip.id, mergeOffers(rest, [updated], MAX_PENDING));
  return textResult(`Updated. It still waits for review in the planner:\n${describeOffer(updated)}\n(The id changed — use the one above for further changes.)`);
}

async function removeTripOption(args, env, token) {
  if (!args.optionId) return textResult('Pass the optionId of the option to remove.', true);
  const { trip, error } = await resolveTrip(args, env, token);
  if (error) return error;
  const pending = await readPending(env, token, trip.id);
  const target = pending.find((o) => o.id === args.optionId);
  if (!target) {
    return textResult(`No option ${args.optionId} is waiting for review in this trip — it may already have been added or dismissed in the planner. Use list_pending_options for current ids.`, true);
  }
  await writePending(env, token, trip.id, pending.filter((o) => o.id !== target.id));
  return textResult(`Removed from the review list:\n${describeOffer(target)}`);
}

async function listPendingOptions(args, env, token) {
  const { trip, error } = await resolveTrip(args, env, token);
  if (error) return error;
  const pending = await readPending(env, token, trip.id);
  if (!pending.length) return textResult(`Nothing is waiting for review in "${trip.title || 'Untitled trip'}" — every recorded option has been added or dismissed in the planner.`);
  return textResult([`${pending.length} option${pending.length === 1 ? '' : 's'} waiting for review in "${trip.title || 'Untitled trip'}":`, ...pending.map(describeOffer)].join('\n'));
}

async function createTrip(args, env, token) {
  const trips = await listTrips(env, token);
  if (trips.length >= MAX_TRIPS) return textResult(`There are already ${MAX_TRIPS} trips — the user needs to delete one in the planner first.`, true);
  const now = Date.now();
  const trip = { id: newTripId(), title: String(args.title || '').trim().slice(0, 80) || 'Untitled trip', createdAt: now, updatedAt: now, snapshot: null };
  await putTrip(env, token, trip);
  return textResult(`Created trip ${trip.id} ("${trip.title}"). It is empty; it appears in the planner on its next sync. Use this id when recording options.`);
}

// ---- plan analysis (from the planner's own snapshot) ---------------------------

function analyze(trip) {
  const s = trip.snapshot;
  if (!s || !Array.isArray(s.rows) || !s.rows.length) return null;
  const rates = ratesOf(s);
  const parsed = groupRows(s.rows, s.notes || [], rates);
  const windows = [];
  [...parsed.travel, ...parsed.stay].forEach((g) => g.options.forEach((o) => { if (o.window && !windows.includes(o.window)) windows.push(o.window); }));
  const activeWindow = windows.length ? (s.activeWindow && windows.includes(s.activeWindow) ? s.activeWindow : windows[0]) : '';
  const selection = s.selection || { travel: {}, stay: {}, activity: {} };
  return { parsed, rates, windows, activeWindow, selection };
}

const planEmpty = (trip) => textResult(`"${trip.title || 'Untitled trip'}" has nothing in its plan yet${trip.snapshot ? '' : ' (the planner hasn\'t synced it, or it is a new trip)'}. Options Claude records appear in the planner for the user to add; this works once some are added.`);

function money(range) {
  const note = range.missingCurrencies && range.missingCurrencies.length ? ` (excludes ${range.missingCurrencies.join(', ')} — no exchange rate set)` : '';
  return `${euro(range.low)}${range.high !== range.low ? `–${euro(range.high)}` : ''}${note}`;
}

function getTripPath(trip) {
  const a = analyze(trip);
  if (!a) return planEmpty(trip);
  const { parsed, rates, activeWindow, selection, windows } = a;
  const compatible = (g) => g.options.filter((o) => !o.window || o.window === activeWindow);
  const lines = [`"${trip.title || 'Untitled trip'}"${routeOf(trip.snapshot) ? ` — ${routeOf(trip.snapshot)}` : ''}`];
  if (windows.length) lines.push(`Date windows: ${windows.join(', ')}. Showing: ${activeWindow}.`);

  const picks = [];
  let n = 0;
  parsed.timelineOrder.forEach((item) => {
    const group = item.type === 'travel' ? parsed.travelGroupsByKey[item.key] : parsed.stayGroupsByKey[item.key];
    if (!group) return;
    const options = compatible(group);
    if (!options.length) return;
    const selMap = item.type === 'travel' ? selection.travel : selection.stay;
    let chosen = pickedOption(group, selMap || {});
    if (!options.includes(chosen)) [chosen] = options;
    picks.push(chosen);
    n += 1;
    const others = options.filter((o) => o !== chosen).map((o) => `${o.label} ${costLabel(o)}`);
    const time = item.type === 'travel' && chosen.time && (chosen.time.from || chosen.time.to) ? ` ${chosen.time.from || '–'}–${chosen.time.to || '–'}` : '';
    lines.push(`${n}. ${item.type === 'travel' ? 'Travel' : 'Stay'} ${group.key}: ${chosen.label}${time}, ${costLabel(chosen)}${others.length ? `\n   other options: ${others.join('; ')}` : ''}`);
  });
  const acts = parsed.activities.filter((x) => selection.activity && selection.activity[x.idx]);
  if (acts.length) lines.push(`Activities included: ${acts.map((x) => `${x.label} ${costLabel(x)}`).join('; ')}`);
  lines.push(`Total of the picked options: ${money(sumRange([...picks, ...acts], rates))}`);
  return textResult(lines.join('\n'));
}

function optimizeTrip(trip, args) {
  const a = analyze(trip);
  if (!a) return planEmpty(trip);
  const { parsed, rates, selection } = a;
  const groups = [
    ...parsed.travel.map((g) => ({ kind: 'travel', key: g.key, options: g.options })),
    ...parsed.stay.map((g) => ({ kind: 'stay', key: g.key, options: g.options })),
  ];
  if (groups.length < 2) return textResult('Ranking needs at least two travel legs or stays in the plan.');
  const result = enumerateCombinations(groups, rates, COMBO_CAP);
  if (result.truncated) return textResult(`${result.count.toLocaleString('en-US')} possible combinations — too many to rank. Narrow the alternatives per leg in the planner first.`);

  const acts = parsed.activities.filter((x) => selection.activity && selection.activity[x.idx]);
  const actRange = sumRange(acts, rates);
  let ranked = result.combos.map((c) => ({
    picks: c.picks, window: c.window, low: c.low + actRange.low, high: c.high + actRange.high, mid: (c.low + c.high) / 2 + (actRange.low + actRange.high) / 2,
  }));
  if (args.window) ranked = ranked.filter((c) => c.window === args.window);
  ranked.sort((x, y) => x.mid - y.mid);
  if (!ranked.length) return textResult(args.window ? `No valid combinations in window "${args.window}".` : 'No valid combinations.');

  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);
  const lines = [`${ranked.length} valid combination${ranked.length === 1 ? '' : 's'}${args.window ? ` in ${args.window}` : ''}, cheapest first (showing ${Math.min(limit, ranked.length)}):`];
  ranked.slice(0, limit).forEach((c, i) => {
    lines.push(`${i + 1}. ${euro(c.low)}${c.high !== c.low ? `–${euro(c.high)}` : ''}${c.window ? ` {${c.window}}` : ''}: ${c.picks.map((p) => `${p.key}: ${p.option.label}`).join(' | ')}`);
  });
  if (result.missingCurrencies && result.missingCurrencies.length) {
    lines.push(`Options priced in ${result.missingCurrencies.join(', ')} are left out — no exchange rate is set in the planner.`);
  }
  if (actRange.missingCurrencies.length) lines.push(`Activities in ${actRange.missingCurrencies.join(', ')} are excluded — no exchange rate.`);
  return textResult(lines.join('\n'));
}

async function callTool(name, args, env, token) {
  const a = args || {};
  switch (name) {
    case 'list_trips': {
      const trips = await listTrips(env, token);
      const activeId = await getActiveId(env, token);
      return textResult(trips.length ? `${trips.length} trip${trips.length === 1 ? '' : 's'}, newest first:\n${trips.map((t) => tripLine(t, activeId)).join('\n')}` : 'No trips yet. Ask the user whether to start one (create_trip), or have them open the planner once so their trip syncs here.');
    }
    case 'create_trip': return createTrip(a, env, token);
    case 'add_trip_options': return addTripOptions(a, env, token);
    case 'update_trip_option': return updateTripOption(a, env, token);
    case 'remove_trip_option': return removeTripOption(a, env, token);
    case 'list_pending_options': return listPendingOptions(a, env, token);
    case 'get_trip_path': { const r = await resolveTrip(a, env, token); return r.error || getTripPath(r.trip); }
    case 'optimize_trip': { const r = await resolveTrip(a, env, token); return r.error || optimizeTrip(r.trip, a); }
    default: return null;
  }
}

// ---- MCP (JSON-RPC over Streamable HTTP, stateless JSON responses) ---------

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } });

async function handleRpc(msg, env, token) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(msg && msg.id, -32600, 'Invalid Request');
  }
  const isNotification = msg.id === undefined || msg.id === null;
  if (isNotification) return null;

  switch (msg.method) {
    case 'initialize': {
      const requested = msg.params && msg.params.protocolVersion;
      return rpcResult(msg.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, { tools: TOOLS });
    case 'tools/call': {
      const params = msg.params || {};
      try {
        const result = await callTool(params.name, params.arguments, env, token);
        if (!result) return rpcError(msg.id, -32602, `Unknown tool: ${params.name}`);
        return rpcResult(msg.id, result);
      } catch (err) {
        return rpcResult(msg.id, textResult(`TripAgent could not do that: ${err.message}`, true));
      }
    }
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

async function handleMcp(request, env, token) {
  if (request.method !== 'POST') {
    // No server-initiated stream (GET) and no sessions to end (DELETE).
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
  }
  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json(rpcError(null, -32600, 'Request too large'), 413);
    body = JSON.parse(text);
  } catch {
    return json(rpcError(null, -32700, 'Parse error'), 400);
  }
  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map((m) => handleRpc(m, env, token)))).filter(Boolean);
    return replies.length ? json(replies) : new Response(null, { status: 202 });
  }
  const reply = await handleRpc(body, env, token);
  return reply ? json(reply) : new Response(null, { status: 202 });
}

// ---- planner API -------------------------------------------------------------

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()) : DEFAULT_ORIGINS;
  return origin && allowed.includes(origin) ? origin : null;
}

function corsHeaders(origin) {
  return origin
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
    : { Vary: 'Origin' };
}

// The planner owns its snapshot, so this only checks shape and size — it
// refuses anything that isn't a plain trip state rather than storing junk.
function validSnapshot(s) {
  return s && typeof s === 'object' && Array.isArray(s.rows) && s.rows.length <= 500 && (s.notes === undefined || Array.isArray(s.notes))
    && (s.rateRows === undefined || Array.isArray(s.rateRows));
}

// Which trip is open in the planner, so a capture tool with no trip of its own
// knows where to send things. The planner sets it when the user switches trips.
async function handleActive(request, env, token, cors) {
  if (request.method === 'GET') return json({ tripId: await getActiveId(env, token) }, 200, cors);
  if (request.method === 'PUT') {
    let tripId;
    try { ({ tripId } = await request.json()); } catch { return json({ error: 'Body must be JSON: { "tripId" }' }, 400, cors); }
    if (!TRIP_ID_RE.test(String(tripId))) return json({ error: 'Not a trip id.' }, 400, cors);
    await env.TRIPS.put(activeKey(token), JSON.stringify({ tripId: String(tripId), updatedAt: Date.now() }));
    return json({ ok: true }, 200, cors);
  }
  return json({ error: 'Not found' }, 404, cors);
}

// A capture tool posting offers (or trip-notes lines) into a trip's review
// list. The same validation as Claude's add_trip_options: nothing is trusted
// as sent, and nothing reaches the plan until the user taps Add.
async function handleCapture(request, env, token, id, cors) {
  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: 'Too large.' }, 413, cors);
    body = JSON.parse(text);
  } catch {
    return json({ error: 'Body must be JSON: { "offers": [...] } or { "notes": "..." }' }, 400, cors);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Body must be a JSON object.' }, 400, cors);

  let trip;
  if (id === 'active') {
    const activeId = await getActiveId(env, token);
    trip = activeId ? await getTrip(env, token, activeId) : null;
    if (!trip) {
      const trips = await listTrips(env, token);
      if (trips.length === 1) trip = await getTrip(env, token, trips[0].id);
    }
    if (!trip) return json({ error: 'no_active_trip', message: 'Open a trip in the planner (with TripAgent connected) so captures know where to go.' }, 409, cors);
  } else {
    trip = await getTrip(env, token, id);
    if (!trip) return json({ error: 'Not found' }, 404, cors);
  }

  const source = String(body.source || 'extension').slice(0, 60);
  const defaults = { source, ...(body.window ? { window: String(body.window).slice(0, 40) } : {}) };
  const incoming = [
    ...normalizeOffers(Array.isArray(body.offers) ? body.offers.slice(0, 100) : [], defaults),
    ...(typeof body.notes === 'string' && body.notes.trim() ? offersFromNotesText(body.notes.slice(0, 20000), defaults).offers : []),
  ];
  if (!incoming.length) return json({ error: 'no_usable_offers', message: 'Nothing in that capture had a route or place, or a price.' }, 422, cors);

  const pending = await readPending(env, token, trip.id);
  const merged = mergeOffers(pending, incoming, MAX_PENDING);
  await writePending(env, token, trip.id, merged);
  return json({ ok: true, tripId: trip.id, title: trip.title, recorded: incoming.length, waiting: merged.length }, 200, cors);
}

async function handleApi(request, env, token, parts) {
  const cors = corsHeaders(allowedOrigin(request, env));
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  // parts: ['api', token, 'trips', id?, sub?] or ['api', token, 'active']
  if (parts[2] === 'active' && parts.length === 3) return handleActive(request, env, token, cors);
  if (parts[2] !== 'trips') return json({ error: 'Not found' }, 404, cors);
  const id = parts[3];
  const sub = parts[4];
  if (id !== undefined && !TRIP_ID_RE.test(id)) return json({ error: 'Not found' }, 404, cors);

  if (!id) {
    if (request.method !== 'GET') return json({ error: 'Not found' }, 404, cors);
    return json({ trips: await listTrips(env, token) }, 200, cors);
  }

  if (!sub) {
    if (request.method === 'GET') {
      const trip = await getTrip(env, token, id);
      return trip ? json(trip, 200, cors) : json({ error: 'Not found' }, 404, cors);
    }
    if (request.method === 'PUT') {
      if (id === 'active') return json({ error: '"active" is reserved.' }, 400, cors);
      let body;
      try {
        const text = await request.text();
        if (text.length > MAX_SNAPSHOT_BYTES) return json({ error: 'Trip is too large to sync.' }, 413, cors);
        body = JSON.parse(text);
      } catch {
        return json({ error: 'Body must be JSON: { "title", "snapshot" }' }, 400, cors);
      }
      if (!body || !validSnapshot(body.snapshot)) return json({ error: '"snapshot" must be a trip state with a "rows" array.' }, 400, cors);
      const existing = await getTrip(env, token, id);
      if (!existing && (await listTrips(env, token)).length >= MAX_TRIPS) return json({ error: `At most ${MAX_TRIPS} trips can be synced.` }, 409, cors);
      const now = Date.now();
      const trip = {
        id,
        title: String(body.title || (existing && existing.title) || 'Untitled trip').slice(0, 80),
        createdAt: existing ? existing.createdAt : now,
        updatedAt: Number.isFinite(body.updatedAt) ? body.updatedAt : now,
        snapshot: body.snapshot,
      };
      await putTrip(env, token, trip);
      return json({ ok: true, updatedAt: trip.updatedAt }, 200, cors);
    }
    if (request.method === 'DELETE') {
      await env.TRIPS.delete(snapKey(token, id));
      await env.TRIPS.delete(pendKey(token, id));
      return json({ ok: true }, 200, cors);
    }
    return json({ error: 'Not found' }, 404, cors);
  }

  if (sub === 'offers' && request.method === 'POST') return handleCapture(request, env, token, id, cors);
  if (sub === 'pending' && request.method === 'GET') {
    if (!(await getTrip(env, token, id))) return json({ error: 'Not found' }, 404, cors);
    return json({ offers: await readPending(env, token, id) }, 200, cors);
  }
  if (sub === 'ack' && request.method === 'POST') {
    let ids = [];
    try {
      const body = await request.json();
      ids = Array.isArray(body && body.ids) ? body.ids.map(String) : [];
    } catch {
      return json({ error: 'Body must be JSON: { "ids": [...] }' }, 400, cors);
    }
    const drop = new Set(ids);
    const pending = await readPending(env, token, id);
    const remaining = pending.filter((o) => !drop.has(o.id));
    if (remaining.length !== pending.length) await writePending(env, token, id, remaining);
    return json({ ok: true, removed: pending.length - remaining.length, remaining: remaining.length }, 200, cors);
  }
  return json({ error: 'Not found' }, 404, cors);
}

// ---- entry ---------------------------------------------------------------

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
}

// Constant-time compare, so the token can't be guessed byte by byte from timing.
function sameToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    if (!env.TRIP_TOKEN || env.TRIP_TOKEN.length < 16) {
      return json({ error: 'Server not configured: set a TRIP_TOKEN secret of at least 16 characters.' }, 500);
    }
    const parts = new URL(request.url).pathname.split('/').filter(Boolean);
    const [kind, token] = parts;
    // A wrong token looks exactly like a wrong path.
    if (!token || !sameToken(token, env.TRIP_TOKEN)) return json({ error: 'Not found' }, 404);
    if (kind === 'mcp' && parts.length === 2) return handleMcp(request, env, token);
    if (kind === 'api' && parts.length >= 3 && parts.length <= 5) return handleApi(request, env, token, parts);
    return json({ error: 'Not found' }, 404);
  },
};
