import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../testUtils.js";
import { genericAdapter } from "./genericAdapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(__dirname, "..", "fixtures", name), "utf-8");

describe("genericAdapter", () => {
  it("always matches", () => {
    expect(genericAdapter.matches("https://anything.example/")).toBe(true);
  });

  it("extracts a Hotel from JSON-LD, including price and address", () => {
    const document = parseHtml(fixture("hotel-jsonld.html"));
    const candidate = genericAdapter.extract(document, "https://example.com/hotel/1");

    expect(candidate).toMatchObject({
      type: "accommodation",
      title: "Alfama Boutique Hotel",
      cost: { amount: 148, currency: "EUR" },
      place_guess: { name: "Alfama Boutique Hotel", address: "Rua de Sao Miguel 10, Lisbon, PT" },
    });
  });

  it("falls back to Open Graph price meta tags when there's no JSON-LD", () => {
    const document = parseHtml(fixture("og-price-page.html"));
    const candidate = genericAdapter.extract(document, "https://example.com/activity/1");

    expect(candidate).toMatchObject({
      type: "note",
      title: "Sunset Rooftop Tour",
      cost: { amount: 65, currency: "EUR" },
    });
  });

  it("falls back to the bare page title when nothing structured is present", () => {
    const document = parseHtml(fixture("plain-page.html"));
    const candidate = genericAdapter.extract(document, "https://example.com/blog/post");

    expect(candidate).toMatchObject({
      type: "note",
      title: "Some Random Travel Blog Post",
      cost: null,
    });
  });
});
