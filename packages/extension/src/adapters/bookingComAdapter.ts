import type { Adapter, ExtractedCandidate } from "../types.js";
import { addressToGuess, findRelevantNode, priceFromNode } from "../jsonLd.js";
import { parseIsoDate, parsePrice } from "../parsing.js";

// Booking.com's DOM changes often — these data-testid selectors are the commonly
// documented ones as of this writing, tried in order with JSON-LD as a fallback.
// If this adapter starts failing silently, check these selectors first.
// Deliberately no bare "h1"/"h2" fallback here — a generic heading selector
// would "succeed" on any page with the right URL shape, defeating the point of
// falling through to genericAdapter's JSON-LD reading when this site's actual
// markup isn't present.
const TITLE_SELECTORS = ['[data-testid="title"]', "h2#hp_hotel_name"];
const PRICE_SELECTORS = [
  '[data-testid="price-and-discounted-price"]',
  '[data-testid="price"]',
  ".prco-valign-middle-helper",
];
const ADDRESS_SELECTORS = ['[data-testid="address"]', ".hp_address_subtitle"];

function firstText(document: Document, selectors: string[]): string | null {
  for (const selector of selectors) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (text) return text;
  }
  return null;
}

function datesFromUrl(url: string): { starts_at: string | null; ends_at: string | null } {
  try {
    const params = new URL(url).searchParams;
    return {
      starts_at: parseIsoDate(params.get("checkin")),
      ends_at: parseIsoDate(params.get("checkout")),
    };
  } catch {
    return { starts_at: null, ends_at: null };
  }
}

export const bookingComAdapter: Adapter = {
  id: "booking-com",
  version: 1,
  matches: (url) => /(^|\.)booking\.com$/.test(new URL(url).hostname) && url.includes("/hotel/"),
  extract(document, url) {
    const title = firstText(document, TITLE_SELECTORS);
    if (!title) return null;

    const priceText = firstText(document, PRICE_SELECTORS);
    const relevant = findRelevantNode(document);
    const cost = (priceText ? parsePrice(priceText) : null) ?? (relevant ? priceFromNode(relevant) : null);

    const addressText = firstText(document, ADDRESS_SELECTORS);
    const placeGuess = addressText
      ? { name: title, address: addressText }
      : (relevant && addressToGuess(relevant)) ?? { name: title, address: null };

    const dates = datesFromUrl(url);

    const candidate: ExtractedCandidate = {
      type: "accommodation",
      title,
      cost,
      starts_at: dates.starts_at,
      ends_at: dates.ends_at,
      place_guess: placeGuess,
      url,
      raw: { priceText, addressText },
    };
    return candidate;
  },
};
