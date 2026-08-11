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
  const m = text.match(/(?:€|\$|£|eur|usd|gbp)\s?([\d,.]+)(?:\s?[-–to]{1,4}\s?(?:€|\$|£|eur|usd|gbp)?\s?([\d,.]+))?(\s*\/\s*night)?/i);
  const freeMatch = /\b(free|included|no cost)\b/i.test(text);
  if (freeMatch && !m) return { low: 0, high: 0, perNight: false, nights: 1, isFree: true };
  if (!m) return null;
  let low = parseFloat(m[1].replace(/,/g, ''));
  let high = m[2] ? parseFloat(m[2].replace(/,/g, '')) : low;
  const perNight = !!m[3];
  const nightsMatch = text.match(/x\s?(\d+)|for\s+(\d+)\s+nights?|(\d+)\s+nights?/i);
  const nights = nightsMatch ? parseInt(nightsMatch[1] || nightsMatch[2] || nightsMatch[3], 10) : 1;
  if (perNight) { low *= nights; high *= nights; }
  return { low, high, perNight, nights, isFree: low === 0 && high === 0 };
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

export function parseNotes(text) {
  const lines = text.split('\n');
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const e = parseLine(lines[i], i);
    if (e) entries.push(e);
  }

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
