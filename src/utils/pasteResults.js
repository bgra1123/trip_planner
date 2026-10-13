// Reads the text of a card-portal flight-results page (Capital One Travel,
// Amex Travel and look-alikes) that the user selected, copied and pasted — with
// no AI, so it costs nothing, works offline, and can't invent a number.
//
// The text is one line per element, and its order varies by layout:
//   desktop:  depart, duration, arrive, PRICE, airline, airline, ROUTE, fare, stops, perk
//   phone:    perk, PRICE, badge, depart, duration, arrive, airline, fare, stops, ROUTE
// So nothing is read by position alone. A result is anchored on the one thing
// every layout shares — three consecutive lines "time / duration / time" — and
// each other line is recognized by what it looks like (a price, a stop count,
// "EWR - CDG"). Anything it can't place is counted and reported, never guessed.
//
// Prices are kept exactly as shown. Whether they are per traveler is the
// user's to say, and is applied by the caller (totalForTravelers).

// IATA metropolitan codes: EWR-ORY and JFK-CDG are both NYC → PAR, so they are
// alternatives for one leg. Mirrors METRO in extension/scrapers.js; a test keeps
// the two identical.
export const METRO = {
  JFK: 'NYC', EWR: 'NYC', LGA: 'NYC', CDG: 'PAR', ORY: 'PAR', BVA: 'PAR',
  LHR: 'LON', LGW: 'LON', STN: 'LON', LTN: 'LON', LCY: 'LON', SEN: 'LON',
  MXP: 'MIL', LIN: 'MIL', BGY: 'MIL', FCO: 'ROM', CIA: 'ROM',
  IAD: 'WAS', DCA: 'WAS', BWI: 'WAS', ORD: 'CHI', MDW: 'CHI',
  HND: 'TYO', NRT: 'TYO', KIX: 'OSA', ITM: 'OSA', ICN: 'SEL', GMP: 'SEL',
  PEK: 'BJS', PKX: 'BJS', PVG: 'SHA', SHA: 'SHA', SVO: 'MOW', DME: 'MOW', VKO: 'MOW',
  ARN: 'STO', BMA: 'STO', NYO: 'STO', IST: 'IST', SAW: 'IST',
  EZE: 'BUE', AEP: 'BUE', GRU: 'SAO', CGH: 'SAO', VCP: 'SAO', GIG: 'RIO', SDU: 'RIO',
  YYZ: 'YTO', YTZ: 'YTO', YUL: 'YMQ', YMX: 'YMQ', IAH: 'HOU', HOU: 'HOU',
};
export const metroOf = (code) => METRO[code] || code;

const TIME = /^(\d{1,2}:\d{2}(?:\s?(?:AM|PM))?)(?:\s?\+\s?(\d))?$/i;
const DURATION = /^(?:(\d{1,2})\s?h(?:r|rs)?(?:\s?\d{1,2}\s?m(?:in)?)?|\d{1,3}\s?m(?:in)?)$/i;
const PRICE = /^([€$£₺]\s?\d[\d,]*(?:\.\d+)?|(?:EUR|USD|GBP|TRY|CHF)\s?\d[\d,]*(?:\.\d+)?)(?:\s.*)?$/i;
const STOPS = /^(?:nonstop|direct|(\d)\s?stops?\b.*)$/i;
const ROUTE = /^([A-Z]{3})\s?[-–→]\s?([A-Z]{3})$/;
const POINTS = /^\d[\d,.]*\s?(?:k\s)?(?:miles|points|pts)\b/i;
// Banners, badges and buttons: not part of a result's data.
const NOISE = /^(?:earn\b|select\b|details\b|show\b|view\b|sort\b|filter\b|done\b|back\b|all$|basic$|standard$|enhanced$|premium\b)|\b(?:best|fastest|cheapest|recommended|popular|lowest)\b|\bmiles\b|\bpoints\b|\bpts\b/i;

const isTime = (l) => TIME.test(l);
const isDuration = (l) => DURATION.test(l);
const isPrice = (l) => PRICE.test(l);
const isRoute = (l) => ROUTE.test(l) && ROUTE.exec(l)[1] !== ROUTE.exec(l)[2];
const isStops = (l) => STOPS.test(l);
const isPoints = (l) => POINTS.test(l);
const isNoise = (l) => NOISE.test(l);
// A line that says something about the flight itself: airline, fare, stops, route.
const isCore = (l) => !isTime(l) && !isDuration(l) && !isPrice(l) && !isPoints(l) && !isNoise(l);

function clockMinutes(t) {
  const m = /^(\d{1,2}):(\d{2})\s?(AM|PM)?$/i.exec(String(t).trim());
  if (!m) return null;
  let h = parseInt(m[1], 10);
  if (m[3]) h = (h % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0);
  return h * 60 + parseInt(m[2], 10);
}

function priceToken(line) {
  const m = PRICE.exec(line);
  return m ? m[1].replace(/\s+/g, '') : '';
}

// Lines between two results hold the tail of one and the head of the next. A
// price that comes before the airline/route lines belongs to the result above
// (desktop); one that comes after them starts the result below (phone).
function splitGap(gap) {
  const firstPrice = gap.findIndex(isPrice);
  const firstCore = gap.findIndex(isCore);
  if (firstPrice === -1) return { tail: gap, head: [] };
  if (firstCore === -1 || firstPrice < firstCore) return { tail: gap, head: [] };
  // Phone: core lines, then the next result's perk/price.
  const cut = gap.findIndex((l, i) => i > firstCore && (isPrice(l) || /^earn\b/i.test(l)));
  return cut === -1 ? { tail: gap, head: [] } : { tail: gap.slice(0, cut), head: gap.slice(cut) };
}

// -> { offers: [raw offers], skipped: number, found: number }
// `skipped` counts results that were cut off or couldn't be placed (no price,
// no airports): the caller says so rather than hiding them.
export function parsePortalText(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

  const cards = [];
  for (let i = 0; i + 2 < lines.length; i += 1) {
    if (isTime(lines[i]) && isDuration(lines[i + 1]) && isTime(lines[i + 2])) {
      cards.push({ dep: i, arr: i + 2 });
      i += 2;
    }
  }
  if (!cards.length) return { offers: [], skipped: 0, found: 0, windowHint: '' };

  // The trip dates shown above the results ("Oct 28 - Oct 31"), offered as a
  // suggestion for the window label; the user's own entry always wins.
  const dateLine = lines.find((l) => /^[A-Z][a-z]{2} \d{1,2}\s?[-\u2013]\s?[A-Z][a-z]{2} \d{1,2}$/.test(l));

  let skipped = 0;
  // Text above the first result: its phone-layout head, or the tail of a
  // result cut off at the top (price then airline/route, but no times).
  const head0 = lines.slice(0, cards[0].dep);
  const firstPrice0 = head0.findIndex(isPrice);
  const firstCore0 = head0.findIndex(isCore);
  let prevHead = head0;
  if (firstPrice0 !== -1 && firstCore0 !== -1 && firstPrice0 < firstCore0) {
    skipped += 1;
    prevHead = [];
  }

  const offers = [];
  cards.forEach((c, idx) => {
    const gapEnd = idx + 1 < cards.length ? cards[idx + 1].dep : lines.length;
    const { tail, head } = splitGap(lines.slice(c.arr + 1, gapEnd));

    // Price: this result's own tail first (desktop), else what sat above its times (phone).
    const priceLine = tail.find(isPrice) || prevHead.find(isPrice);
    prevHead = head;

    const core = tail.filter(isCore);
    const routeLine = core.find(isRoute);
    const stopsLine = core.find(isStops);
    const others = [];
    core.forEach((l) => {
      if (isRoute(l) || isStops(l)) return;
      if (others.length && others[others.length - 1].toLowerCase() === l.toLowerCase()) return; // airline printed twice
      others.push(l);
    });
    const pointsLine = tail.find(isPoints);

    if (!routeLine || (!priceLine && !pointsLine)) { skipped += 1; return; }

    const [, fromAp, toAp] = ROUTE.exec(routeLine);
    const from = metroOf(fromAp);
    const to = metroOf(toAp);
    const depLine = TIME.exec(lines[c.dep]);
    const arrLine = TIME.exec(lines[c.arr]);
    const durHours = parseInt((DURATION.exec(lines[c.dep + 1]) || [])[1], 10);

    const detail = [];
    if (pointsLine) detail.push(`${pointsLine} (points — not counted as cash)`);
    if (from !== fromAp || to !== toAp) detail.push(`airports: ${fromAp} → ${toAp}`);
    if (others[1]) detail.push(`fare: ${others[1].slice(0, 60)}`);
    const dep = clockMinutes(depLine[1]);
    const arr = clockMinutes(arrLine[1]);
    if (arrLine[2]) detail.push(`arrives +${arrLine[2]} day${arrLine[2] === '1' ? '' : 's'}`);
    else if (durHours >= 24) detail.push(`long journey (${durHours}h): arrives a day or more later`);
    else if (dep !== null && arr !== null && arr < dep) detail.push('arrives next day');

    const stopsMatch = stopsLine ? STOPS.exec(stopsLine) : null;
    offers.push({
      kind: 'flight',
      from,
      to,
      carrier: others[0] ? others[0].slice(0, 40) : '',
      departure: depLine[1],
      arrival: arrLine[1],
      duration: lines[c.dep + 1],
      stops: stopsMatch ? (stopsMatch[1] ? parseInt(stopsMatch[1], 10) : 0) : null,
      price: priceLine ? priceToken(priceLine) : null,
      detail: detail.join(' · '),
    });
  });

  // A trailing partial result with no times at all is invisible to the anchor;
  // say so if text after the last result looks like the start of another.
  const lastGap = lines.slice(cards[cards.length - 1].arr + 1);
  const trailing = splitGap(lastGap).head;
  if (trailing.some(isPrice) && trailing.some(isCore)) skipped += 1;

  return { offers, skipped, found: offers.length, windowHint: dateLine || '' };
}
