// Fares and cabins, so a fare name like "Delta Main Basic", "Eco Fly" or
// "Premium Economy" can be used in preferences and planning, not just read.
//
// Two things are derived from the fare name as printed, and both are plain
// keyword rules, kept here so every surface (planner, extension, server,
// phone) agrees:
//   cabin: where you sit — economy, premium_economy, business, first.
//   level: how restricted the fare is — basic (no changes, no bag, no seat
//          choice), standard, flex (changeable/refundable).
// The rules only recognize wording; they never invent a cabin for a fare they
// can't read, and the cabin on a row stays editable by the user.

export const CABINS = ['economy', 'premium_economy', 'business', 'first'];
export const CABIN_LABEL = { economy: 'Economy', premium_economy: 'Premium economy', business: 'Business', first: 'First' };
export const LEVEL_LABEL = { basic: 'Basic', standard: 'Standard', flex: 'Flex' };

const CABIN_RULES = [
  ['first', /\bfirst\b/i],
  ['business', /\bbusiness\b|\bbiz\b|\bclub\b|\bpolaris\b|\bdelta one\b|\bflagship\b/i],
  ['premium_economy', /premium\s*economy|\bpremium\b|comfort\s*\+|comfort plus|economy\s*plus|\bextra comfort\b|\bpremium select\b/i],
  ['economy', /\beconomy\b|\beco\b|\bmain\b|\bbasic\b|\blight\b|\blite\b|\bstandard\b|\bsaver\b|\bflex\b|\bclassic\b|\bvalue\b|\bdiscount\b|\bsmart\b|\bprime\s*fly\b|\bprime\b|\bextra\s*fly\b|\beco\s*fly\b|\bgo\b/i],
];

// "" when the words say nothing about the cabin.
export function cabinFromFare(fare) {
  const text = String(fare || '').trim();
  if (!text) return '';
  for (const [cabin, re] of CABIN_RULES) if (re.test(text)) return cabin;
  return '';
}

// basic | standard | flex | "" (no fare name at all).
export function fareLevel(fare) {
  const text = String(fare || '').trim();
  if (!text) return '';
  if (/\bbasic\b|\blight\b|\blite\b|\bsaver\b|\bvalue\b|\bdiscount\b|\beco\s*fly\b|\bessential\b|\bgo\b|\bhand\s*baggage\b|\bno\s*bag\b/i.test(text)) return 'basic';
  if (/\bflex\b|\bprime\s*fly\b|\bprime\b|\brefundable\b|\bfull\b|\bplus\b|\bpremium\s*flex\b|\bunrestricted\b/i.test(text)) return 'flex';
  return 'standard';
}

export function cabinLabel(cabin) { return CABIN_LABEL[cabin] || ''; }

// Does an option fit the user's preferences? `prefs` is
// { cabins: [...], portals: [...], avoidBasic: bool }; an empty list means
// "any". An option with no cabin or no portal is never excluded by a cabin
// or portal preference — missing information isn't a mismatch.
export function matchesPreferences(option, prefs) {
  if (!prefs) return true;
  const cabins = Array.isArray(prefs.cabins) ? prefs.cabins : [];
  const portals = Array.isArray(prefs.portals) ? prefs.portals : [];
  if (cabins.length && option.cabin && !cabins.includes(option.cabin)) return false;
  if (portals.length && option.source && !portals.includes(option.source)) return false;
  if (prefs.avoidBasic && fareLevel(option.fare) === 'basic') return false;
  return true;
}

export const EMPTY_PREFERENCES = { cabins: [], portals: [], avoidBasic: false };
