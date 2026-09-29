import { describe, expect, it } from "vitest";
import { parseIsoDate, parsePrice } from "./parsing.js";

describe("parsePrice", () => {
  it("parses a leading currency symbol", () => {
    expect(parsePrice("$1,234.56")).toEqual({ amount: 1234.56, currency: "USD" });
    expect(parsePrice("Total: €140/night")).toEqual({ amount: 140, currency: "EUR" });
  });

  it("parses a leading or trailing ISO currency code", () => {
    expect(parsePrice("EUR 140")).toEqual({ amount: 140, currency: "EUR" });
    expect(parsePrice("140.50 USD")).toEqual({ amount: 140.5, currency: "USD" });
  });

  it("returns null for text with no recognizable price", () => {
    expect(parsePrice("Free cancellation until Friday")).toBeNull();
  });
});

describe("parseIsoDate", () => {
  it("normalizes a parseable date to ISO", () => {
    expect(parseIsoDate("2026-11-01")).toBe("2026-11-01T00:00:00.000Z");
  });

  it("returns null for empty or unparseable input", () => {
    expect(parseIsoDate(null)).toBeNull();
    expect(parseIsoDate(undefined)).toBeNull();
    expect(parseIsoDate("not a date")).toBeNull();
  });
});
