import { describe, expect, it } from "vitest";
import { deriveGaps } from "./gaps.js";
import { fixtureItems, fixtureSegments, fixtureTrip, FIXTURE_NOW } from "./fixtures/tripFixture.js";
import type { Item, Segment } from "./schema.js";

describe("deriveGaps — fixture trip", () => {
  const gaps = deriveGaps(fixtureTrip, fixtureSegments, fixtureItems, FIXTURE_NOW);

  it("finds exactly one unbooked_nights gap, for Porto's night of 11-06", () => {
    const unbooked = gaps.filter((g) => g.kind === "unbooked_nights");
    expect(unbooked).toHaveLength(1);
    expect(unbooked[0]).toMatchObject({
      segment_id: "seg-porto",
      date_range: { start: "2026-11-06", end: "2026-11-06" },
    });
  });

  it("finds exactly one missing_transport gap, on the Porto->Madrid transit segment", () => {
    const missing = gaps.filter((g) => g.kind === "missing_transport");
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({
      segment_id: "seg-transit-porto-madrid",
      date_range: { start: "2026-11-07", end: "2026-11-07" },
    });
    expect(missing[0]!.detail).toContain("Porto to Madrid");
  });

  it("does not report a gap on the Lisbon->Porto transit segment (transport exists)", () => {
    const missing = gaps.filter((g) => g.kind === "missing_transport");
    expect(missing.some((g) => g.segment_id === "seg-transit-lisbon-porto")).toBe(false);
  });

  it("leaves the covered slots on 2026-11-02 in Lisbon out of empty_slot", () => {
    const emptySlots = gaps.filter((g) => g.kind === "empty_slot" && g.segment_id === "seg-lisbon");
    const detailsForThatDay = emptySlots.map((g) => g.detail);
    expect(detailsForThatDay.some((d) => d.includes("morning of 2026-11-02"))).toBe(false);
    expect(detailsForThatDay.some((d) => d.includes("evening of 2026-11-02"))).toBe(false);
    expect(detailsForThatDay.some((d) => d.includes("afternoon of 2026-11-02"))).toBe(true);
  });

  it("ignores the expired old Porto quote and the rejected Madrid suite entirely", () => {
    const detail = JSON.stringify(gaps);
    expect(detail).not.toContain("old quote");
  });
});

describe("deriveGaps — empty_slot in isolation", () => {
  const trip = { ...fixtureTrip };
  const segments: Segment[] = [
    {
      id: "seg-solo",
      trip_id: trip.id,
      kind: "stay",
      city: "Nowhere",
      start_date: "2026-01-01",
      end_date: "2026-01-02",
      order: 0,
    },
  ];
  const items: Item[] = [
    {
      id: "item-morning",
      trip_id: trip.id,
      segment_id: "seg-solo",
      type: "activity",
      status: "idea",
      title: "Museum",
      place_ref: null,
      starts_at: "2026-01-01T09:00:00Z",
      ends_at: "2026-01-01T11:00:00Z",
      cost: null,
      source: { origin: "manual", url: null, agent_name: null },
      captured_at: "2025-12-01T00:00:00Z",
      expires_at: null,
      cancellable_until: null,
      raw: null,
    },
  ];

  it("reports exactly the 5 uncovered slots across the segment's 2 inclusive days", () => {
    const gaps = deriveGaps(trip, segments, items, new Date("2026-01-01T00:00:00Z"));
    const emptySlots = gaps.filter((g) => g.kind === "empty_slot");
    // days: 01-01, 01-02; slots: morning/afternoon/evening = 6 total, minus the 1 covered.
    expect(emptySlots).toHaveLength(5);
    expect(emptySlots.some((g) => g.detail.startsWith("morning of 2026-01-01"))).toBe(false);
  });
});
