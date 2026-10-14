const TAGS = {
  travel: ['flight', 'train', 'bus', 'car', 'ferry', 'transport', 'travel'],
  stay: ['hotel', 'stay', 'airbnb', 'accommodation', 'apartment'],
  activity: ['activity', 'tour', 'ticket', 'visit', 'do', 'attraction'],
  note: ['note'],
};

function categoryFor(tag) {
  tag = (tag || '').toLowerCase();
  for (const cat in TAGS) if (TAGS[cat].indexOf(tag) !== -1) return cat;
  return null;
}

// Recognized currency markers -> ISO code. Symbols display compactly
// (€, $, £, ₺); word/code markers (eur, usd, try, chf) resolve to the
// same codes so "EUR2100" and "€2100" behave identically.
export const CURRENCY_SYMBOLS = { EUR: '€', USD: '$', GBP: '£', TRY: '₺', CHF: 'CHF' };
const CURRENCY_CODE = { '€': 'EUR', '$': 'USD', '£': 'GBP', '₺': 'TRY', eur: 'EUR', usd: 'USD', gbp: 'GBP', try: 'TRY', chf: 'CHF' };
const CUR_PATTERN = '€|\\$|£|₺|eur|usd|gbp|try|chf';

export function parseCost(text) {
  const re = new RegExp(`(?:${CUR_PATTERN})\\s?(\\d+(?:[.,]\\d+)*)(?:\\s?[-–to]{1,4}\\s?(?:${CUR_PATTERN})?\\s?(\\d+(?:[.,]\\d+)*))?(\\s*\\/\\s*night)?`, 'i');
  const curRe = new RegExp(`${CUR_PATTERN}`, 'i');
  const m = text.match(re);
  const freeMatch = text.match(/\b(free|included|no cost)\b/i);
  if (freeMatch && !m) return { low: 0, high: 0, perNight: false, nights: 1, isFree: true, raw: freeMatch[0], currency: null };
  if (!m) return null;
  let low = parseFloat(m[1].replace(/,/g, ''));
  let high = m[2] ? parseFloat(m[2].replace(/,/g, '')) : low;
  const perNight = !!m[3];
  const nightsMatch = text.match(/x\s?(\d+)|for\s+(\d+)\s+nights?|(\d+)\s+nights?/i);
  const nights = nightsMatch ? parseInt(nightsMatch[1] || nightsMatch[2] || nightsMatch[3], 10) : 1;
  if (perNight) { low *= nights; high *= nights; }
  const curMatch = m[0].match(curRe);
  const currency = curMatch ? CURRENCY_CODE[curMatch[0].toLowerCase()] : 'EUR';
  return { low, high, perNight, nights, isFree: low === 0 && high === 0, raw: m[0], currency };
}

// True when a row's raw cost text couldn't be fully understood — either it
// didn't parse as a cost at all, or something's left over after the parsed
// amount. The second case matters more than it looks: a typo like
// "EUR21OO" (letter O for zero) partially matches "EUR21" and silently
// drops the "OO", so the row would still parse — just to the wrong number,
// with nothing flagging it. Empty text isn't an issue — that's just no
// cost entered yet, not a mistake.
export function costTextIssue(costText) {
  const t = (costText || '').trim();
  if (!t) return false;
  const cost = parseCost(t);
  if (!cost) return true;
  const idx = t.indexOf(cost.raw);
  if (idx === -1) return true;
  let rest = (t.slice(0, idx) + t.slice(idx + cost.raw.length)).trim();
  if (!rest) return false;
  rest = rest.replace(/^x\s?\d+\b/i, '').replace(/^for\s+\d+\s+nights?\b/i, '').replace(/^\d+\s+nights?\b/i, '').trim();
  return rest.length > 0;
}

export function formatMoney(n, currency) {
  currency = currency || 'EUR';
  const sym = CURRENCY_SYMBOLS[currency];
  const sign = n < 0 ? '-' : '';
  n = Math.abs(Math.round(n));
  const formatted = n.toLocaleString('en-US');
  if (sym && sym.length === 1) return `${sign}${sym}${formatted}`;
  return `${sign}${formatted} ${sym || currency}`;
}

// Convert a parsed cost into the base currency (EUR) using a { CODE: eurPerUnit }
// rate table. Same-currency and free costs need no rate. Returns
// missingRate: true (never a silent 1:1 guess) when the currency isn't EUR
// and no rate is on file — callers must exclude these from sums/rankings.
export function convertToBase(cost, rates, base) {
  base = base || 'EUR';
  if (!cost) return { low: 0, high: 0, missingRate: false };
  if (cost.isFree || !cost.currency || cost.currency === base) {
    return { low: cost.low, high: cost.high, missingRate: false };
  }
  const rate = (rates || {})[cost.currency];
  if (rate === undefined) return { low: 0, high: 0, missingRate: true };
  return { low: cost.low * rate, high: cost.high * rate, missingRate: false };
}

// Re-serialize a parsed cost back into editable shorthand text
// (round-trips "€90/night x3" losslessly, unlike rebuilding from low/high).
export function costText(cost) {
  if (!cost) return '';
  let t = cost.raw || (cost.isFree ? 'free' : `€${cost.low}`);
  if (cost.perNight && cost.nights > 1 && !/x\s?\d+/i.test(t)) t += ` x${cost.nights}`;
  return t;
}

export function parseTimes(text) {
  const times = text.match(/\b\d{1,2}:\d{2}\b/g) || [];
  const dur = text.match(/\b\d{1,2}\s?[-–]\s?\d{1,2}\s?hours?\b|\b\d+h\s?\d*m(?:in)?\b/i);
  return { from: times[0] || null, to: times[1] || null, duration: dur ? dur[0] : null };
}

export function parseRoute(text) {
  const m = text.match(/^([A-Za-z][A-Za-z\s]{0,20}?)\s*(→|->|-|to)\s*([A-Za-z][A-Za-z\s]{0,20}?)(?=[,(]|\s+\d|\s+evening|\s+morning|\s+night|$)/i);
  if (!m) return null;
  return { from: m[1].trim(), to: m[3].trim(), full: m[0] };
}

function titleCase(s) {
  return s.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

function cleanup(text) {
  return text
    .replace(/\s*[-–]\s*(?=[,\s]|$)/g, ' ')
    .replace(/(,\s*){2,}/g, ', ')
    .replace(/^[\s,;\-–]+|[\s,;\-–]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stripKnownTokens(text, opts = {}) {
  let out = text
    .replace(new RegExp(`(?:${CUR_PATTERN})\\s?[\\d,.]+(?:\\s?[-–to]{1,4}\\s?(?:${CUR_PATTERN})?\\s?[\\d,.]+)?(\\s*\\/\\s*night)?`, 'ig'), '')
    .replace(/\b(free|included|no cost)\b/ig, '')
    .replace(/\b\d{1,2}:\d{2}\s?(?:[-–]|to)\s?\d{1,2}:\d{2}\b(?:\s?to\s?\d{1,2}:\d{2}\s?(?:[-–]|to)\s?\d{1,2}:\d{2}\b)?/ig, '')
    .replace(/\b\d{1,2}:\d{2}\b/g, '')
    .replace(/x\s?\d+\b/i, '')
    .replace(/\bfor\s+\d+\s+nights?\b/i, '')
    .replace(/\b\d+\s+nights?\b/i, '');
  if (opts.route) out = out.replace(opts.route, '');
  if (opts.qualifier) out = out.replace(opts.qualifier, '');
  return cleanup(out);
}

function parseLine(raw, idx, window) {
  const line = raw.trim();
  if (!line || line.charAt(0) === '#') return null;
  const tagMatch = line.match(/^([A-Za-z]+)\s*:\s*(.*)$/);
  let tag = null, body = line;
  if (tagMatch) { tag = tagMatch[1].toLowerCase(); body = tagMatch[2]; }
  let category = tag ? categoryFor(tag) : null;
  const cost = parseCost(body);
  const route = parseRoute(body);
  if (!category) {
    const lower = body.toLowerCase();
    outer:
    for (const cat in TAGS) {
      if (cat === 'note') continue;
      for (let i = 0; i < TAGS[cat].length; i++) {
        if (lower.indexOf(TAGS[cat][i]) !== -1) { category = cat; break outer; }
      }
    }
  }
  if (!category) category = cost || route ? 'activity' : 'note';

  const time = parseTimes(body);
  let groupKey, label, detail;
  const qualifierMatch = body.match(/\b(evening|morning|night|afternoon|overnight|daytime)\b/i);

  if (category === 'travel') {
    groupKey = route ? `${route.from} → ${route.to}` : (tag ? titleCase(tag) : `Travel leg ${idx}`);
    label = qualifierMatch ? titleCase(qualifierMatch[0]) : (time.from ? `${time.from} departure` : `Option ${idx}`);
    detail = stripKnownTokens(body, { route: route ? route.full : null, qualifier: qualifierMatch ? qualifierMatch[0] : null });
  } else if (category === 'stay') {
    const placeMatch = body.match(/^([A-Za-z][A-Za-z\s]{0,20}?)\s*[-–,]/);
    groupKey = placeMatch ? placeMatch[1].trim() : `Stay ${idx}`;
    const rest = placeMatch ? body.slice(placeMatch[0].length) : body;
    label = cleanup(rest.split(',')[0]) || `Option ${idx}`;
    detail = stripKnownTokens(rest, {}).replace(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), '');
    detail = cleanup(detail);
  } else {
    groupKey = null;
    label = stripKnownTokens(body, {}) || body;
    detail = '';
  }

  return { idx, category, tag, groupKey, label, raw: line, time, cost, detail, window: window || '' };
}

// A `WINDOW: <label>` line sets the date-window context for every entry
// until the next WINDOW: line; `WINDOW:` with no label (or none/any/all)
// clears it back to universal. A `RATE: TRY 0.0181` line sets the
// EUR-per-unit conversion factor for that currency (used by every cost in
// that currency, anywhere in the notes — rates aren't block-scoped like
// windows are). Neither directive becomes an entry itself. Lets a user
// paste two (or more) rounds of price research — e.g. "14-19 Aug" and
// "13-18 Aug", possibly priced in different currencies — into one notes
// block without the combination logic ever pairing options from different
// windows, or silently treating one currency as if it were another.
function preprocessLines(text) {
  const lines = text.split('\n');
  let currentWindow = '';
  const rates = {};
  const out = [];
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    const windowMatch = line.match(/^WINDOW\s*:\s*(.*)$/i);
    if (windowMatch) {
      const label = windowMatch[1].trim();
      currentWindow = (!label || /^(none|any|all)$/i.test(label)) ? '' : label;
      return;
    }
    const rateMatch = line.match(/^RATE\s*:\s*([A-Za-z]{3})\s+([\d.]+)/i);
    if (rateMatch) {
      rates[rateMatch[1].toUpperCase()] = parseFloat(rateMatch[2]);
      return;
    }
    out.push({ raw, idx, window: currentWindow });
  });
  return { items: out, rates };
}

// Shared by parseNotes (entries from raw text lines) and groupRows (entries
// from editable table rows) — everything downstream (rendering, cost
// breakdown, combinations, export) only ever consumes this shape.
function groupEntries(entries) {
  const travelOrder = [], travelGroups = {};
  const stayOrder = [], stayGroups = {};
  const activities = [];
  const notes = [];
  const timelineOrder = [];

  entries.forEach((e) => {
    if (e.category === 'travel') {
      const key = e.groupKey;
      if (!travelGroups[key]) { travelGroups[key] = { key, options: [] }; travelOrder.push(key); timelineOrder.push({ type: 'travel', key }); }
      travelGroups[key].options.push(e);
    } else if (e.category === 'stay') {
      const key = e.groupKey;
      if (!stayGroups[key]) { stayGroups[key] = { key, options: [] }; stayOrder.push(key); timelineOrder.push({ type: 'stay', key }); }
      stayGroups[key].options.push(e);
    } else if (e.category === 'activity') {
      activities.push(e);
      timelineOrder.push({ type: 'activity', id: e.idx });
    } else {
      notes.push(e.label || e.raw);
    }
  });

  return {
    travel: travelOrder.map((k) => travelGroups[k]),
    stay: stayOrder.map((k) => stayGroups[k]),
    activities,
    notes,
    timelineOrder,
    travelGroupsByKey: travelGroups,
    stayGroupsByKey: stayGroups,
  };
}

// Chain travel legs by matching "to" -> next leg's "from", instead of
// assuming groups appear in trip order — notes are often grouped by
// price-research session (e.g. all WINDOW: blocks together), not
// chronologically. Falls back to appending any disconnected legs as-is.
export function deriveRouteChain(travelGroups) {
  if (!travelGroups.length) return [];
  const edges = travelGroups.map((g) => {
    const parts = g.key.split(' → ');
    return { from: parts[0], to: parts[1] || g.key, key: g.key };
  });
  const byFrom = {}, toSet = {};
  edges.forEach((e) => { byFrom[e.from] = e; toSet[e.to] = true; });
  const start = edges.find((e) => !toSet[e.from]) || edges[0];
  const chain = [start.from];
  const seen = {};
  let cur = start;
  while (cur && !seen[cur.key]) {
    seen[cur.key] = true;
    chain.push(cur.to);
    cur = byFrom[cur.to];
  }
  if (Object.keys(seen).length < edges.length) {
    edges.forEach((e) => { if (!seen[e.key]) { chain.push(e.from, e.to); } });
  }
  return chain;
}

export function parseNotes(text) {
  const entries = [];
  const { items, rates } = preprocessLines(text);
  items.forEach(({ raw, idx, window }) => {
    const e = parseLine(raw, idx, window);
    if (e) entries.push(e);
  });
  return { ...groupEntries(entries), rates };
}

let nextRowId = 1;
export function newRowId() { return `r${nextRowId++}`; }
// Restoring persisted rows/rates re-introduces ids like "r7" while this
// counter has reset to 1 on page load — without raising the floor here, the
// next newRowId() call would collide with an existing restored id. Safe to
// call repeatedly (e.g. under StrictMode's double-invoked lazy initializers)
// since it only ever raises the counter, never lowers it.
export function bumpRowIdCounter(ids) {
  ids.forEach((id) => {
    const m = /^r(\d+)$/.exec(id || '');
    if (m) {
      const n = parseInt(m[1], 10) + 1;
      if (n > nextRowId) nextRowId = n;
    }
  });
}
export function newRow(category = 'travel') {
  return { id: newRowId(), category, group: '', option: '', timeText: '', costText: '', detail: '', window: '' };
}

// One-time conversion of pasted/typed shorthand text into editable table
// rows (+ a plain notes list). This only runs when the user explicitly asks
// to (re)build the table from text — it never runs automatically, since that
// would clobber in-progress table edits.
export function linesToRows(text) {
  const rows = [];
  const notes = [];
  const { items, rates } = preprocessLines(text);
  items.forEach(({ raw, idx, window }) => {
    const e = parseLine(raw, idx, window);
    if (!e) return;
    if (e.category === 'note') { notes.push(e.label || e.raw); return; }
    rows.push({
      id: newRowId(),
      category: e.category,
      group: e.groupKey || '',
      option: e.label || '',
      timeText: e.time.from && e.time.to ? `${e.time.from}-${e.time.to}` : (e.time.from || ''),
      costText: costText(e.cost),
      detail: e.detail || '',
      window: e.window || '',
    });
  });
  return { rows, notes, rates };
}

// Reshape editable table rows into the same grouped structure parseNotes()
// produces, so every downstream consumer (rendering, cost breakdown,
// combinations, export) works unchanged regardless of the data's source.
export function groupRows(rows, notes = [], rates = {}) {
  const entries = rows
    .filter((r) => r.category === 'travel' || r.category === 'stay' || r.category === 'activity')
    .map((r) => ({
      idx: r.id,
      category: r.category,
      groupKey: r.category === 'activity' ? null : (r.group && r.group.trim() ? r.group.trim() : `Untitled ${r.id}`),
      label: r.option && r.option.trim() ? r.option.trim() : `Option ${r.id}`,
      time: parseTimes(r.timeText || ''),
      cost: parseCost(r.costText || ''),
      detail: r.detail || '',
      window: r.window || '',
      raw: '',
    }));
  return { ...groupEntries(entries), notes, rates };
}

// Resolve a group's currently-selected option by id, falling back to the
// first option if the selected id no longer exists (e.g. a deleted row).
// Works regardless of whether idx is a text-import line number (parseNotes)
// or an editable-table row id (groupRows) — it never assumes a scheme.
export function pickedOption(group, selMap) {
  const id = selMap[group.key];
  return group.options.find((o) => o.idx === id) || group.options[0];
}

// First option per travel/stay group, all activities included — the same
// defaults the UI applies to a freshly-parsed set of notes.
export function defaultSelection(parsed) {
  const travel = {};
  parsed.travel.forEach((g) => { travel[g.key] = g.options[0].idx; });
  const stay = {};
  parsed.stay.forEach((g) => { stay[g.key] = g.options[0].idx; });
  const activity = {};
  parsed.activities.forEach((a) => { activity[a.idx] = true; });
  return { travel, stay, activity };
}

export function euro(n) {
  const sign = n < 0 ? '-' : '';
  n = Math.abs(Math.round(n));
  return `${sign}€${n.toLocaleString('en-US')}`;
}

export function costLabel(opt) {
  if (!opt || !opt.cost) return 'cost n/a';
  if (opt.cost.isFree) return 'free';
  const cur = opt.cost.currency || 'EUR';
  if (opt.cost.low === opt.cost.high) return formatMoney(opt.cost.low, cur);
  return `${formatMoney(opt.cost.low, cur)}–${formatMoney(opt.cost.high, cur)}`;
}

// Sums a list of picked options in the base currency (EUR), converting each
// via `rates`. Any option whose currency has no rate on file is excluded
// from the sum (never silently treated as 1:1) and its currency is reported
// back in `missingCurrencies` so the UI/export can surface a warning.
export function sumRange(items, rates = {}) {
  let low = 0, high = 0;
  const missing = new Set();
  items.forEach((o) => {
    if (!o || !o.cost) return;
    const converted = convertToBase(o.cost, rates);
    if (converted.missingRate) { missing.add(o.cost.currency); return; }
    low += converted.low;
    high += converted.high;
  });
  return { low, high, missingCurrencies: Array.from(missing) };
}

// Cartesian product of every travel/stay group's options, summed and ranked
// by cost — except a partial combination is only extended with an option
// whose window is compatible (same non-empty window, or either side
// universal/''). This means a combo can never pair, say, a 14-19 Aug flight
// with a 13-18 Aug hotel. `cap` bounds the raw (pre-pruning) product as a
// safety valve; the returned `count` is the real number of valid combos.
export function enumerateCombinations(groups, rates = {}, cap = 4000) {
  const rawCount = groups.reduce((p, g) => p * g.options.length, 1);
  if (rawCount > cap) return { combos: [], count: rawCount, truncated: true };
  let combos = [{ picks: [], low: 0, high: 0, window: '' }];
  const missing = new Set();
  groups.forEach((g) => {
    const next = [];
    combos.forEach((c) => {
      g.options.forEach((o) => {
        const optWindow = o.window || '';
        if (c.window && optWindow && c.window !== optWindow) return;
        const converted = o.cost ? convertToBase(o.cost, rates) : { low: 0, high: 0, missingRate: false };
        if (converted.missingRate) { missing.add(o.cost.currency); return; }
        next.push({
          picks: [...c.picks, { key: g.key, kind: g.kind, option: o }],
          low: c.low + converted.low,
          high: c.high + converted.high,
          window: c.window || optWindow,
        });
      });
    });
    combos = next;
  });
  return { combos, count: combos.length, truncated: false, missingCurrencies: Array.from(missing) };
}

function withMid(r) { return { low: r.low, mid: (r.low + r.high) / 2, high: r.high, missingCurrencies: r.missingCurrencies || [] }; }

function comboKey(picks) { return picks.map((p) => `${p.key}:${p.option.idx}`).join('|'); }

// Snapshot of the current picks, cost breakdown, and full ranked combination
// list, suitable for JSON.stringify or toMarkdown().
export function buildExportData(parsed, selection, route) {
  const rates = parsed.rates || {};
  const travelPicks = parsed.travel.map((g) => {
    const o = pickedOption(g, selection.travel);
    return { leg: g.key, option: o.label, departure: o.time.from, arrival: o.time.to, cost: o.cost, window: o.window || null, detail: o.detail || null };
  });
  const stayPicks = parsed.stay.map((g) => {
    const o = pickedOption(g, selection.stay);
    return { place: g.key, option: o.label, cost: o.cost, window: o.window || null, nights: o.cost ? o.cost.nights : 1, detail: o.detail || null };
  });
  const activityList = parsed.activities.map((a) => ({ name: a.label, cost: a.cost, included: !!selection.activity[a.idx] }));

  const travelRange = sumRange(parsed.travel.map((g) => pickedOption(g, selection.travel)), rates);
  const stayRange = sumRange(parsed.stay.map((g) => pickedOption(g, selection.stay)), rates);
  const activityRange = sumRange(parsed.activities.filter((a) => selection.activity[a.idx]), rates);
  const totalRange = {
    low: travelRange.low + stayRange.low + activityRange.low,
    high: travelRange.high + stayRange.high + activityRange.high,
    missingCurrencies: Array.from(new Set([
      ...travelRange.missingCurrencies, ...stayRange.missingCurrencies, ...activityRange.missingCurrencies,
    ])),
  };

  const groups = [];
  parsed.travel.forEach((g) => groups.push({ kind: 'travel', key: g.key, options: g.options }));
  parsed.stay.forEach((g) => groups.push({ kind: 'stay', key: g.key, options: g.options }));

  const combosOut = { totalCount: 0, truncated: false, ranked: [] };
  const missingCurrencies = new Set([
    ...travelRange.missingCurrencies, ...stayRange.missingCurrencies, ...activityRange.missingCurrencies,
  ]);
  if (groups.length >= 2) {
    const result = enumerateCombinations(groups, rates, 4000);
    combosOut.truncated = result.truncated;
    combosOut.totalCount = result.truncated ? result.count : result.combos.length;
    (result.missingCurrencies || []).forEach((c) => missingCurrencies.add(c));
    if (!result.truncated) {
      const withOffset = result.combos.map((c) => ({
        picks: c.picks,
        low: c.low + activityRange.low,
        high: c.high + activityRange.high,
        mid: (c.low + c.high) / 2 + (activityRange.low + activityRange.high) / 2,
        window: c.window,
      }));
      withOffset.sort((a, b) => a.mid - b.mid);
      const currentKey = groups
        .map((g) => `${g.key}:${g.kind === 'travel' ? selection.travel[g.key] : selection.stay[g.key]}`)
        .join('|');
      combosOut.ranked = withOffset.map((c, idx) => ({
        rank: idx + 1,
        picks: c.picks.map((p) => ({ group: p.key, option: p.option.label })),
        window: c.window || null,
        low: c.low, mid: c.mid, high: c.high,
        isCurrent: comboKey(c.picks) === currentKey,
      }));
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    route: route || null,
    currentPick: { travel: travelPicks, stay: stayPicks, activities: activityList },
    costBreakdown: {
      travel: withMid(travelRange),
      accommodation: withMid(stayRange),
      activities: withMid(activityRange),
      total: withMid(totalRange),
    },
    combinations: combosOut,
    missingRates: Array.from(missingCurrencies),
    notes: parsed.notes,
  };
}

function costCell(c) {
  if (!c) return 'n/a';
  if (c.isFree) return 'free';
  const cur = c.currency || 'EUR';
  if (c.low === c.high) return formatMoney(c.low, cur);
  return `${formatMoney(c.low, cur)}–${formatMoney(c.high, cur)}`;
}

export function toMarkdown(data) {
  const lines = [];
  lines.push(`# Trip Plan${data.route ? `: ${data.route}` : ''}`);
  lines.push(`_Generated ${data.generatedAt}_`);
  lines.push('');

  lines.push('## Current Pick');
  if (data.currentPick.travel.length) {
    lines.push('### Travel');
    data.currentPick.travel.forEach((t) => {
      lines.push(`- **${t.leg}**: ${t.option}${t.departure ? ` (${t.departure}${t.arrival ? `–${t.arrival}` : ''})` : ''} — ${costCell(t.cost)}${t.window ? ` [${t.window}]` : ''}`);
    });
    lines.push('');
  }
  if (data.currentPick.stay.length) {
    lines.push('### Accommodation');
    data.currentPick.stay.forEach((s) => {
      lines.push(`- **${s.place}**: ${s.option} — ${costCell(s.cost)}${s.nights > 1 ? ` (${s.nights} nights)` : ''}${s.window ? ` [${s.window}]` : ''}`);
    });
    lines.push('');
  }
  if (data.currentPick.activities.length) {
    const included = data.currentPick.activities.filter((a) => a.included).length;
    lines.push(`### Activities (${included} of ${data.currentPick.activities.length} included)`);
    data.currentPick.activities.forEach((a) => {
      lines.push(`- ${a.included ? '☑' : '☐'} ${a.name} — ${costCell(a.cost)}`);
    });
    lines.push('');
  }

  lines.push('## Cost Breakdown');
  lines.push('| Category | Low | Likely | High |');
  lines.push('|---|---|---|---|');
  [['Travel', data.costBreakdown.travel], ['Accommodation', data.costBreakdown.accommodation], ['Activities', data.costBreakdown.activities]]
    .forEach(([label, r]) => lines.push(`| ${label} | ${euro(r.low)} | ${euro(r.mid)} | ${euro(r.high)} |`));
  lines.push(`| **Total** | **${euro(data.costBreakdown.total.low)}** | **${euro(data.costBreakdown.total.mid)}** | **${euro(data.costBreakdown.total.high)}** |`);
  lines.push('');

  if (data.missingRates && data.missingRates.length) {
    lines.push(`⚠️ Costs in ${data.missingRates.join(', ')} are excluded from totals and combinations above — add a \`RATE: <code> <eur-per-unit>\` line to the notes to include them (e.g. \`RATE: ${data.missingRates[0]} 0.03\`).`);
    lines.push('');
  }

  if (data.combinations.truncated) {
    lines.push('## Time-Window Cost Analysis');
    lines.push(`${data.combinations.totalCount.toLocaleString('en-US')} possible combinations — too many to list.`);
    lines.push('');
  } else if (data.combinations.ranked.length) {
    const groupNames = data.combinations.ranked[0].picks.map((p) => p.group);
    const hasWindows = data.combinations.ranked.some((c) => c.window);
    const windowCol = hasWindows ? ' Window |' : '';
    lines.push(`## Time-Window Cost Analysis (${data.combinations.totalCount.toLocaleString('en-US')} combination${data.combinations.totalCount === 1 ? '' : 's'})`);
    lines.push(`| # | ${groupNames.join(' | ')} |${windowCol} Low | Likely | High |`);
    lines.push(`|${groupNames.concat(hasWindows ? ['#', 'Window', 'Low', 'Likely', 'High'] : ['#', 'Low', 'Likely', 'High']).map(() => '---').join('|')}|`);
    data.combinations.ranked.forEach((c) => {
      const marker = `${c.rank === 1 ? '★' : ''}${c.rank}${c.isCurrent ? ' (current)' : ''}`;
      const opts = c.picks.map((p) => p.option).join(' | ');
      const windowCell = hasWindows ? ` ${c.window || '—'} |` : '';
      lines.push(`| ${marker} | ${opts} |${windowCell} ${euro(c.low)} | ${euro(c.mid)} | ${euro(c.high)} |`);
    });
    lines.push('');
  }

  if (data.notes.length) {
    lines.push('## Trip Planning Notes');
    data.notes.forEach((n) => lines.push(`- ${n}`));
    lines.push('');
  }

  return lines.join('\n');
}

export const DEFAULT_TRIP_NOTES = `RATE: TRY 0.01814
TRAIN: MUN to MILAN evening, 18:00-20:00 to 02:00-04:00, EUR250-350
TRAIN: MUN to MILAN morning, 08:00-10:00 to 15:00-17:00, EUR250-350
HOTEL: Munich - near Hauptbahnhof, EUR120/night x1, rest stop before train
ACTIVITY: Duomo rooftop terraces, EUR40
ACTIVITY: Sforza Castle courtyard + park, free
ACTIVITY: Navigli canal evening walk, free

WINDOW: 14-19 Aug
FLIGHT: IST to MUN, 6:45-11:30, TRY116000, Turkish Airlines
FLIGHT: IST to MUN, 7:25-9:05, TRY154000, Turkish Airlines
HOTEL: Milan - family room near Duomo, EUR140/night x3, walk to metro
HOTEL: Milan - apartment near Malpensa train link, EUR110/night x3, more space, longer transit

WINDOW: 13-18 Aug
FLIGHT: IST to MUN, 6:30-11:10, TRY107500, Turkish Airlines
FLIGHT: IST to MUN, 9:15-13:50, TRY143000, Turkish Airlines
HOTEL: Milan - family room near Duomo, EUR160/night x3, walk to metro
HOTEL: Milan - apartment near Malpensa train link, EUR125/night x3, more space, longer transit

NOTE: Infant-friendly: MXP (train) preferred over BGY (bus)
NOTE: Munich: 1 day allows arrival rest plus a quick visit
NOTE: Book hotels near transit for flexibility
NOTE: Use WINDOW: <label> to tag a block of options with a date range — combinations never mix options from different windows
NOTE: Flight prices are quoted in Turkish Lira — the RATE: line above converts them to EUR for totals and comparisons
`;
