import type { Adapter } from "../types.js";
import { parsePrice } from "../parsing.js";

const FLIGHT_SEARCH_HOSTS = ["kayak.com", "www.kayak.com", "www.google.com"];

function looksLikeFlightSearch(url: string): boolean {
  const parsed = new URL(url);
  if (!FLIGHT_SEARCH_HOSTS.includes(parsed.hostname)) return false;
  if (parsed.hostname.includes("google")) return parsed.pathname.startsWith("/travel/flights");
  return parsed.pathname.includes("/flights");
}

/**
 * Flight search results are the hardest pages to scrape reliably — heavily
 * client-rendered, no stable JSON-LD for individual fares, dozens of prices per
 * page. This adapter only claims the page title (usually "ROUTE — cheapest
 * price found" on these sites) and the first currency-shaped number in it, and
 * leaves dates for the user to fill in — a wrong date is worse than a missing one.
 */
export const flightSearchAdapter: Adapter = {
  id: "flight-search",
  version: 1,
  matches: (url) => {
    try {
      return looksLikeFlightSearch(url);
    } catch {
      return false;
    }
  },
  extract(document, url) {
    const title = document.title.trim();
    if (!title) return null;

    return {
      type: "transport",
      title,
      cost: parsePrice(title),
      starts_at: null,
      ends_at: null,
      place_guess: null,
      url,
      raw: { pageTitle: title },
    };
  },
};
