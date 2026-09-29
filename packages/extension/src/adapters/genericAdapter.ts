import type { Adapter, ExtractedCandidate } from "../types.js";
import { addressToGuess, findRelevantNode, inferType, priceFromNode, typesOf } from "../jsonLd.js";

function extractFromJsonLd(document: Document, url: string): ExtractedCandidate | null {
  const relevant = findRelevantNode(document);
  if (!relevant || typeof relevant.name !== "string") return null;

  return {
    type: inferType(typesOf(relevant)),
    title: relevant.name,
    cost: priceFromNode(relevant),
    starts_at: null,
    ends_at: null,
    place_guess: addressToGuess(relevant),
    url,
    raw: relevant,
  };
}

function metaContent(document: Document, ...names: string[]): string | null {
  for (const name of names) {
    const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
    const content = el?.getAttribute("content");
    if (content) return content;
  }
  return null;
}

function extractFromMetaFallback(document: Document, url: string): ExtractedCandidate {
  const amount = metaContent(document, "product:price:amount", "og:price:amount");
  const currency = metaContent(document, "product:price:currency", "og:price:currency");
  const title = metaContent(document, "og:title") ?? document.title;

  return {
    type: "note",
    title: title || url,
    cost: amount && currency ? { amount: Number(amount), currency } : null,
    starts_at: null,
    ends_at: null,
    place_guess: null,
    url,
    raw: { source: "meta-fallback", ogTitle: title },
  };
}

/**
 * Always matches — this is the last-resort adapter. Tries JSON-LD (Hotel/Product/
 * Offer/Flight) first, since sites publish more structured data than you'd expect;
 * falls back to Open Graph price meta tags and the page title.
 */
export const genericAdapter: Adapter = {
  id: "generic",
  version: 1,
  matches: () => true,
  extract(document, url) {
    return extractFromJsonLd(document, url) ?? extractFromMetaFallback(document, url);
  },
};
