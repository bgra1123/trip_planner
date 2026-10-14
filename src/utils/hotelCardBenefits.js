// Static, dated lookup of published card-program hotel benefits.
//
// Card-linked hotel programs (Amex Fine Hotels + Resorts, Amex Hotel
// Collection, ...) bundle a handful of concrete benefits — a credit, a
// guaranteed late checkout, an upgrade chance — on top of a stay's price.
// That is real value, but it is never collapsed into one invented "worth X%
// more" score: this module only ever hands back the benefit list, labelled
// with the program name and when the terms were captured, for the UI to
// show *alongside* the price. Two already-verified programs, no scoring, no
// network calls.
//
// Terms like these change without notice — a risk already on record in the
// project's business proposal — hence the capture date on every entry, so a
// stale line is visible rather than silently trusted.

export const HOTEL_CARD_BENEFITS_CAPTURED = 'as published, September 2026';

export const HOTEL_CARD_PROGRAMS = {
  FHR: {
    code: 'FHR',
    name: 'Amex Fine Hotels + Resorts',
    capturedAt: HOTEL_CARD_BENEFITS_CAPTURED,
    benefits: [
      'Breakfast for two',
      '$100 credit toward eligible charges',
      'Guaranteed 4pm checkout',
      'Noon check-in when available',
      'Room upgrade when available',
      'Complimentary wifi',
    ],
  },
  HOTEL_COLLECTION: {
    code: 'HOTEL_COLLECTION',
    name: 'Amex Hotel Collection',
    capturedAt: HOTEL_CARD_BENEFITS_CAPTURED,
    benefits: [
      '$100 credit toward eligible charges',
      '4pm late checkout when available',
      'Noon check-in when available',
      'Room upgrade when available',
      'Minimum 2-night stay required',
    ],
  },
};

// Recognized `CARD:<marker>` markers -> program code, matched
// case-insensitively. Deliberately small and explicit: two programs, no
// fuzzy matching, no invented aliases. An unrecognized marker resolves to
// nothing rather than being guessed at.
const MARKER_TO_CODE = {
  FHR: 'FHR',
  'FINE HOTELS AND RESORTS': 'FHR',
  'FINE HOTELS RESORTS': 'FHR',
  HC: 'HOTEL_COLLECTION',
  'HOTEL COLLECTION': 'HOTEL_COLLECTION',
};

// Captures up to four words after `CARD:` and stops on its own at the next
// punctuation or non-word character (a comma, a middot before "via <source>"
// in a captured offer's detail, end of string, ...) — no explicit terminator
// list to keep in sync with whatever else shares the detail field.
const CARD_TAG_RE = /\bCARD\s*:\s*([A-Za-z][A-Za-z0-9]*(?:\s+[A-Za-z][A-Za-z0-9]*){0,3})/i;

// Finds a `CARD:<marker>` tag anywhere in freeform text (a stay's detail
// text, in the same shorthand grammar as the rest of parseTripNotes.js) and
// resolves it to one of the two known programs above. Returns null when
// there's no tag, or the tag doesn't match a known program — never a guess.
export function detectCardProgram(text) {
  const m = String(text || '').match(CARD_TAG_RE);
  if (!m) return null;
  const code = MARKER_TO_CODE[m[1].trim().toUpperCase()];
  return code ? HOTEL_CARD_PROGRAMS[code] : null;
}

// Same, but scans a stay option's label and detail together, so the marker
// is found regardless of which free-text field it landed in once the notes
// shorthand split the line into label/detail.
export function cardProgramForStay(option) {
  if (!option) return null;
  return detectCardProgram(`${option.label || ''} ${option.detail || ''}`);
}
