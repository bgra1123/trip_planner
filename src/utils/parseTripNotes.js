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

export function parseCost(text) {
  const m = text.match(/(?:€|\$|£|eur|usd|gbp)\s?(\d+(?:[.,]\d+)*)(?:\s?[-–to]{1,4}\s?(?:€|\$|£|eur|usd|gbp)?\s?(\d+(?:[.,]\d+)*))?(\s*\/\s*night)?/i);
  const freeMatch = text.match(/\b(free|included|no cost)\b/i);
  if (freeMatch && !m) return { low: 0, high: 0, perNight: false, nights: 1, isFree: true, raw: freeMatch[0] };
  if (!m) return null;
  let low = parseFloat(m[1].replace(/,/g, ''));
  let high = m[2] ? parseFloat(m[2].replace(/,/g, '')) : low;
  const perNight = !!m[3];
  const nightsMatch = text.match(/x\s?(\d+)|for\s+(\d+)\s+nights?|(\d+)\s+nights?/i);
  const nights = nightsMatch ? parseInt(nightsMatch[1] || nightsMatch[2] || nightsMatch[3], 10) : 1;
  if (perNight) { low *= nights; high *= nights; }
  return { low, high, perNight, nights, isFree: low === 0 && high === 0, raw: m[0] };
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
    .replace(/(?:€|\$|£|eur|usd|gbp)\s?[\d,.]+(?:\s?[-–to]{1,4}\s?(?:€|\$|£|eur|usd|gbp)?\s?[\d,.]+)?(\s*\/\s*night)?/ig, '')
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

function parseLine(raw, idx) {
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

  return { idx, category, tag, groupKey, label, raw: line, time, cost, detail };
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

export function parseNotes(text) {
  const lines = text.split('\n');
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const e = parseLine(lines[i], i);
    if (e) entries.push(e);
  }
  return groupEntries(entries);
}

let nextRowId = 1;
export function newRowId() { return `r${nextRowId++}`; }
export function newRow(category = 'travel') {
  return { id: newRowId(), category, group: '', option: '', timeText: '', costText: '', detail: '' };
}

// One-time conversion of pasted/typed shorthand text into editable table
// rows (+ a plain notes list). This only runs when the user explicitly asks
// to (re)build the table from text — it never runs automatically, since that
// would clobber in-progress table edits.
export function linesToRows(text) {
  const lines = text.split('\n');
  const rows = [];
  const notes = [];
  for (let i = 0; i < lines.length; i++) {
    const e = parseLine(lines[i], i);
    if (!e) continue;
    if (e.category === 'note') { notes.push(e.label || e.raw); continue; }
    rows.push({
      id: newRowId(),
      category: e.category,
      group: e.groupKey || '',
      option: e.label || '',
      timeText: e.time.from && e.time.to ? `${e.time.from}-${e.time.to}` : (e.time.from || ''),
      costText: costText(e.cost),
      detail: e.detail || '',
    });
  }
  return { rows, notes };
}

// Reshape editable table rows into the same grouped structure parseNotes()
// produces, so every downstream consumer (rendering, cost breakdown,
// combinations, export) works unchanged regardless of the data's source.
export function groupRows(rows, notes = []) {
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
      raw: '',
    }));
  return { ...groupEntries(entries), notes };
}

// First option per travel/stay group, all activities included — the same
// defaults the UI applies to a freshly-parsed set of notes.
export function defaultSelection(parsed) {
  const travel = {};
  parsed.travel.forEach((g) => { travel[g.key] = 0; });
  const stay = {};
  parsed.stay.forEach((g) => { stay[g.key] = 0; });
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
  if (opt.cost.low === opt.cost.high) return euro(opt.cost.low);
  return `${euro(opt.cost.low)}–${euro(opt.cost.high)}`;
}

export function sumRange(items) {
  let low = 0, high = 0;
  items.forEach((o) => { if (o && o.cost) { low += o.cost.low; high += o.cost.high; } });
  return { low, high };
}

// Cartesian product of every travel/stay group's options, summed and ranked by cost.
// Returns { combos: [], count, truncated: true } instead of enumerating past `cap`.
export function enumerateCombinations(groups, cap = 4000) {
  const count = groups.reduce((p, g) => p * g.options.length, 1);
  if (count > cap) return { combos: [], count, truncated: true };
  let combos = [{ picks: [], low: 0, high: 0 }];
  groups.forEach((g) => {
    const next = [];
    combos.forEach((c) => {
      g.options.forEach((o, i) => {
        const costLow = o.cost ? o.cost.low : 0;
        const costHigh = o.cost ? o.cost.high : 0;
        next.push({
          picks: [...c.picks, { key: g.key, kind: g.kind, i, option: o }],
          low: c.low + costLow,
          high: c.high + costHigh,
        });
      });
    });
    combos = next;
  });
  return { combos, count, truncated: false };
}

function withMid(r) { return { low: r.low, mid: (r.low + r.high) / 2, high: r.high }; }

function comboKey(picks) { return picks.map((p) => `${p.key}:${p.i}`).join('|'); }

// Snapshot of the current picks, cost breakdown, and full ranked combination
// list, suitable for JSON.stringify or toMarkdown().
export function buildExportData(parsed, selection, route) {
  const travelPicks = parsed.travel.map((g) => {
    const o = g.options[selection.travel[g.key] || 0];
    return { leg: g.key, option: o.label, departure: o.time.from, arrival: o.time.to, cost: o.cost, detail: o.detail || null };
  });
  const stayPicks = parsed.stay.map((g) => {
    const o = g.options[selection.stay[g.key] || 0];
    return { place: g.key, option: o.label, cost: o.cost, nights: o.cost ? o.cost.nights : 1, detail: o.detail || null };
  });
  const activityList = parsed.activities.map((a) => ({ name: a.label, cost: a.cost, included: !!selection.activity[a.idx] }));

  const travelRange = sumRange(parsed.travel.map((g) => g.options[selection.travel[g.key] || 0]));
  const stayRange = sumRange(parsed.stay.map((g) => g.options[selection.stay[g.key] || 0]));
  const activityRange = sumRange(parsed.activities.filter((a) => selection.activity[a.idx]));
  const totalRange = {
    low: travelRange.low + stayRange.low + activityRange.low,
    high: travelRange.high + stayRange.high + activityRange.high,
  };

  const groups = [];
  parsed.travel.forEach((g) => groups.push({ kind: 'travel', key: g.key, options: g.options }));
  parsed.stay.forEach((g) => groups.push({ kind: 'stay', key: g.key, options: g.options }));

  const combosOut = { totalCount: 0, truncated: false, ranked: [] };
  if (groups.length >= 2) {
    const result = enumerateCombinations(groups, 4000);
    combosOut.truncated = result.truncated;
    combosOut.totalCount = result.truncated ? result.count : result.combos.length;
    if (!result.truncated) {
      const withOffset = result.combos.map((c) => ({
        picks: c.picks,
        low: c.low + activityRange.low,
        high: c.high + activityRange.high,
        mid: (c.low + c.high) / 2 + (activityRange.low + activityRange.high) / 2,
      }));
      withOffset.sort((a, b) => a.mid - b.mid);
      const currentKey = groups
        .map((g) => `${g.key}:${g.kind === 'travel' ? (selection.travel[g.key] || 0) : (selection.stay[g.key] || 0)}`)
        .join('|');
      combosOut.ranked = withOffset.map((c, idx) => ({
        rank: idx + 1,
        picks: c.picks.map((p) => ({ group: p.key, option: p.option.label })),
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
    notes: parsed.notes,
  };
}

function costCell(c) {
  if (!c) return 'n/a';
  if (c.isFree) return 'free';
  if (c.low === c.high) return euro(c.low);
  return `${euro(c.low)}–${euro(c.high)}`;
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
      lines.push(`- **${t.leg}**: ${t.option}${t.departure ? ` (${t.departure}${t.arrival ? `–${t.arrival}` : ''})` : ''} — ${costCell(t.cost)}`);
    });
    lines.push('');
  }
  if (data.currentPick.stay.length) {
    lines.push('### Accommodation');
    data.currentPick.stay.forEach((s) => {
      lines.push(`- **${s.place}**: ${s.option} — ${costCell(s.cost)}${s.nights > 1 ? ` (${s.nights} nights)` : ''}`);
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

  if (data.combinations.truncated) {
    lines.push('## Time-Window Cost Analysis');
    lines.push(`${data.combinations.totalCount.toLocaleString('en-US')} possible combinations — too many to list.`);
    lines.push('');
  } else if (data.combinations.ranked.length) {
    const groupNames = data.combinations.ranked[0].picks.map((p) => p.group);
    lines.push(`## Time-Window Cost Analysis (${data.combinations.totalCount.toLocaleString('en-US')} combination${data.combinations.totalCount === 1 ? '' : 's'})`);
    lines.push(`| # | ${groupNames.join(' | ')} | Low | Likely | High |`);
    lines.push(`|${groupNames.concat(['#', 'Low', 'Likely', 'High']).map(() => '---').join('|')}|`);
    data.combinations.ranked.forEach((c) => {
      const marker = `${c.rank === 1 ? '★' : ''}${c.rank}${c.isCurrent ? ' (current)' : ''}`;
      const opts = c.picks.map((p) => p.option).join(' | ');
      lines.push(`| ${marker} | ${opts} | ${euro(c.low)} | ${euro(c.mid)} | ${euro(c.high)} |`);
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

export const DEFAULT_TRIP_NOTES = `FLIGHT: IST to MUN, 6:45-11:30, EUR2100, Turkish Airlines
FLIGHT: IST to MUN, 7:25-9:05, EUR2800, Turkish Airlines
FLIGHT: IST to MUN, 10:00-11:45, EUR34500, Turkish Airlines
TRAIN: MUN to MILAN evening, 18:00-20:00 to 02:00-04:00, EUR250-350
TRAIN: MUN to MILAN morning, 08:00-10:00 to 15:00-17:00, EUR250-350
HOTEL: Munich - near Hauptbahnhof, EUR120/night x1, rest stop before train
HOTEL: Milan - family room near Duomo, EUR140/night x3, walk to metro
HOTEL: Milan - apartment near Malpensa train link, EUR110/night x3, more space, longer transit
ACTIVITY: Duomo rooftop terraces, EUR40
ACTIVITY: Sforza Castle courtyard + park, free
ACTIVITY: Navigli canal evening walk, free
NOTE: Infant-friendly: MXP (train) preferred over BGY (bus)
NOTE: Munich: 1 day allows arrival rest plus a quick visit
NOTE: Book hotels near transit for flexibility
`;
