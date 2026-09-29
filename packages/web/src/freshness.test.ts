import { describe, expect, it } from "vitest";
import { freshnessOf } from "./freshness.js";

describe("freshnessOf", () => {
  it("is hot with no expiry at all", () => {
    expect(freshnessOf({ captured_at: "2026-01-01T00:00:00Z", expires_at: null })).toBe("hot");
  });

  it("is hot early in the TTL window", () => {
    const item = { captured_at: "2026-01-01T00:00:00Z", expires_at: "2026-01-03T00:00:00Z" };
    expect(freshnessOf(item, new Date("2026-01-01T06:00:00Z"))).toBe("hot");
  });

  it("is warm in the middle of the window", () => {
    const item = { captured_at: "2026-01-01T00:00:00Z", expires_at: "2026-01-03T00:00:00Z" };
    expect(freshnessOf(item, new Date("2026-01-02T00:00:00Z"))).toBe("warm");
  });

  it("is cool near or past expiry", () => {
    const item = { captured_at: "2026-01-01T00:00:00Z", expires_at: "2026-01-03T00:00:00Z" };
    expect(freshnessOf(item, new Date("2026-01-02T22:00:00Z"))).toBe("cool");
    expect(freshnessOf(item, new Date("2026-01-05T00:00:00Z"))).toBe("cool");
  });
});
