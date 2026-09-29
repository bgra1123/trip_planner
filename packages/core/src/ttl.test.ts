import { describe, expect, it } from "vitest";
import { computeExpiry, isExpired, isItemActive, TTL_HOURS } from "./ttl.js";

describe("computeExpiry", () => {
  it("adds the per-type TTL to captured_at", () => {
    expect(computeExpiry("accommodation", "2026-01-01T00:00:00Z")).toBe(
      "2026-01-03T00:00:00.000Z",
    );
    expect(computeExpiry("transport", "2026-01-01T00:00:00Z")).toBe("2026-01-02T00:00:00.000Z");
  });

  it("returns null for types with no TTL", () => {
    expect(TTL_HOURS.note).toBeNull();
    expect(computeExpiry("note", "2026-01-01T00:00:00Z")).toBeNull();
  });

  it("gives meals and activities a long TTL", () => {
    expect(TTL_HOURS.meal).toBeGreaterThan(24 * 30);
    expect(TTL_HOURS.activity).toBeGreaterThan(24 * 30);
  });
});

describe("isExpired", () => {
  it("is false when expiresAt is null", () => {
    expect(isExpired(null, new Date("2099-01-01"))).toBe(false);
  });

  it("compares against the given now", () => {
    expect(isExpired("2026-01-02T00:00:00Z", new Date("2026-01-03T00:00:00Z"))).toBe(true);
    expect(isExpired("2026-01-02T00:00:00Z", new Date("2026-01-01T00:00:00Z"))).toBe(false);
  });
});

describe("isItemActive", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("is always false for rejected items, regardless of expiry", () => {
    expect(isItemActive({ status: "rejected", expires_at: null }, now)).toBe(false);
  });

  it("is always true for booked items, even past their offer TTL", () => {
    expect(isItemActive({ status: "booked", expires_at: "2020-01-01T00:00:00Z" }, now)).toBe(
      true,
    );
  });

  it("follows expiry for idea/shortlisted items", () => {
    expect(isItemActive({ status: "idea", expires_at: "2020-01-01T00:00:00Z" }, now)).toBe(false);
    expect(isItemActive({ status: "idea", expires_at: "2099-01-01T00:00:00Z" }, now)).toBe(true);
  });
});
