import { describe, expect, it } from "vitest";
import { buildTripGraph, deriveChainDates, resolveEffectiveSegments, routeLabel } from "./graph.js";
import type { Item, Segment } from "./schema.js";

function makeSegment(overrides: Partial<Segment> & Pick<Segment, "id" | "kind" | "order">): Segment {
  return {
    trip_id: "t1",
    city: null,
    start_date: "2026-01-01",
    end_date: "2026-01-01",
    ...overrides,
  };
}

function makeItem(overrides: Partial<Item> & Pick<Item, "id" | "segment_id" | "type" | "status">): Item {
  return {
    trip_id: "t1",
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

// Lisbon -> [transit-1, nothing chosen yet] -> Porto -> [transit-2, afternoon flight
// chosen over a morning alternative] -> Madrid.
const segLisbon = makeSegment({
  id: "seg-lisbon",
  kind: "stay",
  city: "Lisbon",
  order: 0,
  start_date: "2026-11-01",
  end_date: "2026-11-04",
});
const segTransit1 = makeSegment({
  id: "seg-transit-1",
  kind: "transit",
  order: 1,
  start_date: "2026-11-04",
  end_date: "2026-11-04",
});
const segPorto = makeSegment({
  id: "seg-porto",
  kind: "stay",
  city: "Porto",
  order: 2,
  start_date: "2026-11-04",
  end_date: "2026-11-07",
});
const segTransit2 = makeSegment({
  id: "seg-transit-2",
  kind: "transit",
  order: 3,
  start_date: "2026-11-07",
  end_date: "2026-11-07",
});
const segMadrid = makeSegment({
  id: "seg-madrid",
  kind: "stay",
  city: "Madrid",
  order: 4,
  start_date: "2026-11-07",
  end_date: "2026-11-10",
});
const segments = [segLisbon, segTransit1, segPorto, segTransit2, segMadrid];

const itemHotelLisbon = makeItem({
  id: "item-hotel-lisbon",
  segment_id: "seg-lisbon",
  type: "accommodation",
  status: "booked",
});

// transit-1: two candidates, neither booked yet.
const itemFlight1Morning = makeItem({
  id: "item-flight1-morning",
  segment_id: "seg-transit-1",
  type: "transport",
  status: "idea",
  starts_at: "2026-11-04T08:00:00Z",
  ends_at: "2026-11-04T09:30:00Z",
});
const itemFlight1Afternoon = makeItem({
  id: "item-flight1-afternoon",
  segment_id: "seg-transit-1",
  type: "transport",
  status: "shortlisted",
  starts_at: "2026-11-04T14:00:00Z",
  ends_at: "2026-11-04T15:30:00Z",
});

// Porto: two hotel candidates (one rejected, so it must never show up), none booked.
const itemHotelPortoA = makeItem({
  id: "item-hotel-porto-a",
  segment_id: "seg-porto",
  type: "accommodation",
  status: "idea",
});
const itemHotelPortoRejected = makeItem({
  id: "item-hotel-porto-rejected",
  segment_id: "seg-porto",
  type: "accommodation",
  status: "rejected",
});

// transit-2: two candidate flights a day apart, the later one booked — swapping to
// the earlier one should shift the surrounding stays' computed dates by a day.
const itemFlight2Earlier = makeItem({
  id: "item-flight2-earlier",
  segment_id: "seg-transit-2",
  type: "transport",
  status: "idea",
  starts_at: "2026-11-06T09:00:00Z",
  ends_at: "2026-11-06T10:15:00Z",
});
const itemFlight2Later = makeItem({
  id: "item-flight2-later",
  segment_id: "seg-transit-2",
  type: "transport",
  status: "booked",
  starts_at: "2026-11-07T16:00:00Z",
  ends_at: "2026-11-07T17:15:00Z",
});

const itemNotePorto = makeItem({
  id: "item-note-porto",
  segment_id: "seg-porto",
  type: "note",
  status: "idea",
});

const items = [
  itemHotelLisbon,
  itemFlight1Morning,
  itemFlight1Afternoon,
  itemHotelPortoA,
  itemHotelPortoRejected,
  itemFlight2Earlier,
  itemFlight2Later,
  itemNotePorto,
];

describe("buildTripGraph", () => {
  const nodes = buildTripGraph(segments, items);

  it("returns one node per segment, in order", () => {
    expect(nodes.map((n) => n.segment.id)).toEqual([
      "seg-lisbon",
      "seg-transit-1",
      "seg-porto",
      "seg-transit-2",
      "seg-madrid",
    ]);
  });

  it("a stay node's candidateType is accommodation, a transit node's is transport", () => {
    expect(nodes[0]!.candidateType).toBe("accommodation");
    expect(nodes[1]!.candidateType).toBe("transport");
  });

  it("collects non-rejected candidates of the matching type, excluding rejected ones", () => {
    const porto = nodes.find((n) => n.segment.id === "seg-porto")!;
    expect(porto.candidates.map((i) => i.id)).toEqual(["item-hotel-porto-a"]);
  });

  it("chosen is the one booked candidate, or null when nothing is booked yet", () => {
    const transit1 = nodes.find((n) => n.segment.id === "seg-transit-1")!;
    const transit2 = nodes.find((n) => n.segment.id === "seg-transit-2")!;
    expect(transit1.chosen).toBeNull();
    expect(transit2.chosen?.id).toBe("item-flight2-later");
  });

  it("collects activity/meal/note items as otherItems, separate from candidates", () => {
    const porto = nodes.find((n) => n.segment.id === "seg-porto")!;
    expect(porto.otherItems.map((i) => i.id)).toEqual(["item-note-porto"]);
    expect(nodes[1]!.otherItems).toEqual([]);
  });
});

describe("routeLabel", () => {
  it("labels a transit node by its stay neighbors on each side", () => {
    const nodes = buildTripGraph(segments, items);
    expect(routeLabel(nodes, 1)).toBe("Lisbon -> Porto");
    expect(routeLabel(nodes, 3)).toBe("Porto -> Madrid");
  });
});

describe("deriveChainDates", () => {
  it("a transit node with nothing chosen falls back to its own stored dates", () => {
    const nodes = buildTripGraph(segments, items);
    const dates = deriveChainDates(nodes);
    expect(dates.get("seg-transit-1")).toEqual({ start_date: "2026-11-04", end_date: "2026-11-04" });
  });

  it("a transit node with a chosen item uses that item's own dates", () => {
    const nodes = buildTripGraph(segments, items);
    const dates = deriveChainDates(nodes);
    expect(dates.get("seg-transit-2")).toEqual({ start_date: "2026-11-07", end_date: "2026-11-07" });
  });

  it("a stay node's dates come from its booked bracketing transit items", () => {
    const nodes = buildTripGraph(segments, items);
    const dates = deriveChainDates(nodes);
    // Porto: start falls back to transit-1's stored date (nothing chosen there yet),
    // end comes from transit-2's chosen flight's departure date.
    expect(dates.get("seg-porto")).toEqual({ start_date: "2026-11-04", end_date: "2026-11-07" });
    expect(dates.get("seg-madrid")).toEqual({ start_date: "2026-11-07", end_date: "2026-11-10" });
  });

  it("choosing a different-day option cascades the shift to both bracketing stays", () => {
    const swapped = items.map((item) => {
      if (item.id === "item-flight2-later") return { ...item, status: "idea" as const };
      if (item.id === "item-flight2-earlier") return { ...item, status: "booked" as const };
      return item;
    });
    const nodes = buildTripGraph(segments, swapped);
    const dates = deriveChainDates(nodes);

    // The newly-chosen flight departs a day earlier (11-06 instead of 11-07) —
    // Porto's checkout and Madrid's check-in should both follow it back a day.
    expect(dates.get("seg-transit-2")).toEqual({ start_date: "2026-11-06", end_date: "2026-11-06" });
    expect(dates.get("seg-porto")!.end_date).toBe("2026-11-06");
    expect(dates.get("seg-madrid")!.start_date).toBe("2026-11-06");
    expect(nodes.find((n) => n.segment.id === "seg-transit-2")!.chosen?.id).toBe("item-flight2-earlier");
  });
});

describe("resolveEffectiveSegments", () => {
  it("overrides start_date/end_date per the chain, leaving other fields untouched", () => {
    const resolved = resolveEffectiveSegments(segments, items);
    const porto = resolved.find((s) => s.id === "seg-porto")!;
    expect(porto.start_date).toBe("2026-11-04");
    expect(porto.end_date).toBe("2026-11-07");
    expect(porto.city).toBe("Porto");
    expect(porto.kind).toBe("stay");
  });

  it("is a pure read — the input segments are never mutated", () => {
    const before = JSON.stringify(segments);
    resolveEffectiveSegments(segments, items);
    expect(JSON.stringify(segments)).toBe(before);
  });
});
