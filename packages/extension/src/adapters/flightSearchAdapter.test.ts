import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../testUtils.js";
import { flightSearchAdapter } from "./flightSearchAdapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(__dirname, "..", "fixtures", name), "utf-8");

describe("flightSearchAdapter", () => {
  it("matches kayak flight search URLs but not unrelated kayak pages", () => {
    expect(flightSearchAdapter.matches("https://www.kayak.com/flights/IST-LIS/2026-11-01")).toBe(true);
    expect(flightSearchAdapter.matches("https://www.kayak.com/cars/somewhere")).toBe(false);
  });

  it("matches Google Flights", () => {
    expect(flightSearchAdapter.matches("https://www.google.com/travel/flights/search")).toBe(true);
    expect(flightSearchAdapter.matches("https://www.google.com/search?q=flights")).toBe(false);
  });

  it("extracts the page title and a price parsed from it, with no dates claimed", () => {
    const document = parseHtml(fixture("flight-search.html"));
    const candidate = flightSearchAdapter.extract(
      document,
      "https://www.kayak.com/flights/IST-LIS/2026-11-01",
    );

    expect(candidate).toMatchObject({
      type: "transport",
      title: "IST - LIS, Nov 1 - Nov 4 | one-way from $214 - Kayak",
      cost: { amount: 214, currency: "USD" },
      starts_at: null,
      ends_at: null,
    });
  });
});
