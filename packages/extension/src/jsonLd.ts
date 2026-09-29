import type { ItemType } from "@trip-memory/core";
import type { PlaceGuess } from "./types.js";

export type JsonLdNode = Record<string, unknown>;

export function typesOf(node: JsonLdNode): string[] {
  const raw = node["@type"];
  if (typeof raw === "string") return [raw.toLowerCase()];
  if (Array.isArray(raw)) {
    return raw.filter((t): t is string => typeof t === "string").map((t) => t.toLowerCase());
  }
  return [];
}

export function collectJsonLdNodes(document: Document): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent ?? "");
    } catch {
      continue;
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === "object") {
        const graph = (candidate as JsonLdNode)["@graph"];
        if (Array.isArray(graph)) {
          nodes.push(...graph.filter((n): n is JsonLdNode => !!n && typeof n === "object"));
        } else {
          nodes.push(candidate as JsonLdNode);
        }
      }
    }
  }
  return nodes;
}

const TYPE_BY_SCHEMA: Array<{ match: string[]; type: ItemType }> = [
  { match: ["hotel", "lodgingbusiness", "resort", "motel"], type: "accommodation" },
  { match: ["flight", "flightreservation"], type: "transport" },
  { match: ["restaurant", "foodestablishment", "cafeorcoffeeshop"], type: "meal" },
  { match: ["touristattraction", "event"], type: "activity" },
];

export function inferType(schemaTypes: string[]): ItemType {
  for (const { match, type } of TYPE_BY_SCHEMA) {
    if (schemaTypes.some((t) => match.includes(t))) return type;
  }
  if (schemaTypes.includes("product") || schemaTypes.includes("offer")) return "activity";
  return "note";
}

export function addressToGuess(node: JsonLdNode): PlaceGuess | null {
  const name = typeof node.name === "string" ? node.name : null;
  if (!name) return null;

  const address = node.address;
  let addressText: string | null = null;
  if (typeof address === "string") {
    addressText = address;
  } else if (address && typeof address === "object") {
    const a = address as JsonLdNode;
    addressText =
      [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry]
        .filter((part): part is string => typeof part === "string")
        .join(", ") || null;
  }

  return { name, address: addressText };
}

function extractOfferPrice(node: JsonLdNode): { amount: number; currency: string } | null {
  const price = node.price ?? node.lowPrice;
  const currency = node.priceCurrency;
  if ((typeof price === "number" || typeof price === "string") && typeof currency === "string") {
    const amount = typeof price === "number" ? price : Number(price);
    if (!Number.isNaN(amount)) return { amount, currency };
  }
  return null;
}

export function priceFromNode(node: JsonLdNode): { amount: number; currency: string } | null {
  const direct = extractOfferPrice(node);
  if (direct) return direct;

  const offers = node.offers;
  const offerNodes = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const offer of offerNodes) {
    if (offer && typeof offer === "object") {
      const price = extractOfferPrice(offer as JsonLdNode);
      if (price) return price;
    }
  }
  return null;
}

/** The first JSON-LD node that looks like a real offer: has a recognizable type, or a price. */
export function findRelevantNode(document: Document): JsonLdNode | null {
  const nodes = collectJsonLdNodes(document);
  return nodes.find((n) => inferType(typesOf(n)) !== "note" || priceFromNode(n)) ?? null;
}
