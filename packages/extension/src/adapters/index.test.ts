import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../testUtils.js";
import type { Adapter } from "../types.js";
import { extractCandidate } from "./index.js";
import { genericAdapter } from "./genericAdapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(__dirname, "..", "fixtures", name), "utf-8");

describe("extractCandidate", () => {
  it("prefers the booking.com adapter over generic on a matching URL", () => {
    const document = parseHtml(fixture("booking-hotel.html"));
    const result = extractCandidate(document, "https://www.booking.com/hotel/pt/ribeira.html");
    expect(result.adapterId).toBe("booking-com");
    expect(result.candidate?.title).toBe("Ribeira Riverside Guesthouse");
  });

  it("falls through to generic when a site adapter matches the URL but finds nothing", () => {
    const document = parseHtml(fixture("hotel-jsonld.html"));
    // Booking.com's URL pattern matches, but this fixture has none of its selectors —
    // it should fall through to genericAdapter, which reads the JSON-LD instead.
    const result = extractCandidate(document, "https://www.booking.com/hotel/pt/whatever.html");
    expect(result.adapterId).toBe("generic");
    expect(result.candidate?.title).toBe("Alfama Boutique Hotel");
  });

  it("always produces a candidate for any page via the generic fallback", () => {
    const document = parseHtml(fixture("plain-page.html"));
    const result = extractCandidate(document, "https://totally-unknown-site.example/page");
    expect(result.adapterId).toBe("generic");
    expect(result.candidate).not.toBeNull();
    expect(result.failures).toHaveLength(0);
  });

  it("records a failure and falls through to the next adapter when one throws", () => {
    const throwing: Adapter = {
      id: "throws",
      version: 3,
      matches: () => true,
      extract: () => {
        throw new Error("boom");
      },
    };
    const document = parseHtml(fixture("plain-page.html"));
    const url = "https://totally-unknown-site.example/page";

    const result = extractCandidate(document, url, [throwing, genericAdapter]);

    expect(result.failures).toEqual([
      { adapterId: "throws", adapterVersion: 3, url, message: "boom", at: expect.any(String) },
    ]);
    expect(result.adapterId).toBe("generic");
    expect(result.candidate).not.toBeNull();
  });
});
