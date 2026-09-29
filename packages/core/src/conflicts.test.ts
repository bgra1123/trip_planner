import { describe, expect, it } from "vitest";
import { detectConflicts } from "./conflicts.js";
import { fixtureItems, fixtureSegments } from "./fixtures/tripFixture.js";
import type { Item, Segment } from "./schema.js";

function makeItem(overrides: Partial<Item> & Pick<Item, "id">): Item {
  return {
    trip_id: "t1",
    segment_id: null,
    type: "activity",
    status: "idea",
    title: overrides.id,
    place_ref: null,
    starts_at: null,
    ends_at: null,
    cost: null,
    source: { origin: "manual", url: null, agent_name: null },
    captured_at: "2026-01-01T00:00:00Z",
    expires_at: null,
    cancellable_until: null,
    raw: null,
    ...overrides,
  };
}

describe("detectConflicts — overlap", () => {
  it("flags two timed items whose windows overlap", () => {
    const items = [
      makeItem({ id: "a", starts_at: "2026-01-01T10:00:00Z", ends_at: "2026-01-01T12:00:00Z" }),
      makeItem({ id: "b", starts_at: "2026-01-01T11:00:00Z", ends_at: "2026-01-01T13:00:00Z" }),
    ];
    const conflicts = detectConflicts(items);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: "overlap", item_ids: ["a", "b"] });
  });

  it("does not flag back-to-back, non-overlapping items", () => {
    const items = [
      makeItem({ id: "a", starts_at: "2026-01-01T10:00:00Z", ends_at: "2026-01-01T12:00:00Z" }),
      makeItem({ id: "b", starts_at: "2026-01-01T12:00:00Z", ends_at: "2026-01-01T13:00:00Z" }),
    ];
    expect(detectConflicts(items)).toHaveLength(0);
  });

  it("ignores rejected items even if their windows overlap", () => {
    const items = [
      makeItem({
        id: "a",
        status: "rejected",
        starts_at: "2026-01-01T10:00:00Z",
        ends_at: "2026-01-01T12:00:00Z",
      }),
      makeItem({ id: "b", starts_at: "2026-01-01T11:00:00Z", ends_at: "2026-01-01T13:00:00Z" }),
    ];
    expect(detectConflicts(items)).toHaveLength(0);
  });
});

describe("detectConflicts — out_of_range", () => {
  const segments: Segment[] = [
    {
      id: "seg-1",
      trip_id: "t1",
      kind: "stay",
      city: "Lisbon",
      start_date: "2026-01-01",
      end_date: "2026-01-05",
      order: 0,
    },
  ];

  it("flags a booked item scheduled outside its segment's date range", () => {
    const items = [
      makeItem({ id: "a", status: "booked", segment_id: "seg-1", starts_at: "2026-01-10T09:00:00Z" }),
    ];
    const conflicts = detectConflicts(items, segments);
    expect(conflicts).toEqual([
      { kind: "out_of_range", item_ids: ["a"], detail: expect.stringContaining("outside") },
    ]);
  });

  it("does not flag a booked item within its segment's range", () => {
    const items = [
      makeItem({ id: "a", status: "booked", segment_id: "seg-1", starts_at: "2026-01-03T09:00:00Z" }),
    ];
    expect(detectConflicts(items, segments)).toHaveLength(0);
  });

  it("does not flag an unbooked candidate outside its segment's range — it's an option, not a commitment", () => {
    const items = [
      makeItem({ id: "a", status: "shortlisted", segment_id: "seg-1", starts_at: "2026-01-10T09:00:00Z" }),
    ];
    expect(detectConflicts(items, segments)).toHaveLength(0);
  });

  it("skips unassigned items and items with no start time", () => {
    const items = [
      makeItem({ id: "a", status: "booked", segment_id: null, starts_at: "2026-01-10T09:00:00Z" }),
    ];
    expect(detectConflicts(items, segments)).toHaveLength(0);
  });
});

describe("detectConflicts — fixture trip", () => {
  it("has no conflicts: nothing overlaps and nothing is scheduled out of range", () => {
    expect(detectConflicts(fixtureItems, fixtureSegments)).toHaveLength(0);
  });
});
