import type { Item, Segment, Trip } from "./schema.js";
import { inclusiveDays, toDateOnly, type DaySlot, slotOf } from "./dates.js";
import { isItemActive } from "./ttl.js";

export type GapKind = "unbooked_nights" | "empty_slot" | "missing_transport";

export type Gap = {
  kind: GapKind;
  segment_id: string | null;
  date_range: { start: string; end: string };
  detail: string;
  /** Set only for kind "empty_slot" — which part of the day is uncovered. */
  slot?: DaySlot;
};

const SLOTS: DaySlot[] = ["morning", "afternoon", "evening"];

function unbookedNightsGaps(seg: Segment, items: Item[]): Gap[] {
  const nights = inclusiveDays(seg.start_date, seg.end_date).slice(0, -1);
  if (nights.length === 0) return [];

  const covered = new Set<string>();
  for (const item of items) {
    if (item.segment_id !== seg.id || item.type !== "accommodation" || item.status !== "booked") {
      continue;
    }
    if (!item.starts_at || !item.ends_at) continue;
    for (const night of inclusiveDays(item.starts_at, item.ends_at).slice(0, -1)) {
      covered.add(night);
    }
  }

  const uncovered = nights.filter((n) => !covered.has(n));
  if (uncovered.length === 0) return [];

  return [
    {
      kind: "unbooked_nights",
      segment_id: seg.id,
      date_range: { start: uncovered[0]!, end: uncovered[uncovered.length - 1]! },
      detail: `${uncovered.length} night(s) in ${seg.city ?? "this segment"} without a booked stay`,
    },
  ];
}

function emptySlotGaps(seg: Segment, items: Item[]): Gap[] {
  const planned = new Map<string, Set<DaySlot>>();
  for (const item of items) {
    if (item.segment_id !== seg.id) continue;
    if (item.type !== "activity" && item.type !== "meal") continue;
    if (!item.starts_at) continue;
    const day = toDateOnly(item.starts_at);
    const slots = planned.get(day) ?? new Set<DaySlot>();
    slots.add(slotOf(item.starts_at));
    planned.set(day, slots);
  }

  const gaps: Gap[] = [];
  for (const day of inclusiveDays(seg.start_date, seg.end_date)) {
    const slots = planned.get(day) ?? new Set<DaySlot>();
    for (const slot of SLOTS) {
      if (slots.has(slot)) continue;
      gaps.push({
        kind: "empty_slot",
        segment_id: seg.id,
        date_range: { start: day, end: day },
        detail: `${slot} of ${day} in ${seg.city ?? "this segment"} has no planned activity or meal`,
        slot,
      });
    }
  }
  return gaps;
}

/** Walks outward from `index` to the nearest `stay` segment on one side, for labeling
 *  a transit segment's route ("from X to Y") — transit segments only carry a single
 *  `city` field, so the endpoints have to come from their stay neighbors. */
function findAdjacentStayCity(ordered: Segment[], index: number, direction: 1 | -1): string | null {
  for (let i = index + direction; i >= 0 && i < ordered.length; i += direction) {
    if (ordered[i]!.kind === "stay") return ordered[i]!.city;
  }
  return null;
}

function missingTransportGaps(orderedSegments: Segment[], items: Item[]): Gap[] {
  const gaps: Gap[] = [];
  for (let i = 0; i < orderedSegments.length; i++) {
    const seg = orderedSegments[i]!;
    if (seg.kind !== "transit") continue;

    const hasChosenTransport = items.some(
      (item) => item.segment_id === seg.id && item.type === "transport" && item.status === "booked",
    );
    if (hasChosenTransport) continue;

    const fromCity = findAdjacentStayCity(orderedSegments, i, -1);
    const toCity = findAdjacentStayCity(orderedSegments, i, 1);
    gaps.push({
      kind: "missing_transport",
      segment_id: seg.id,
      date_range: { start: seg.start_date, end: seg.end_date },
      detail: `No transport booked from ${fromCity ?? "?"} to ${toCity ?? "?"}`,
    });
  }
  return gaps;
}

export function deriveGaps(
  _trip: Trip,
  segments: Segment[],
  items: Item[],
  now: Date = new Date(),
): Gap[] {
  const activeItems = items.filter((item) => isItemActive(item, now));
  const ordered = [...segments].sort((a, b) => a.order - b.order);
  const staySegments = ordered.filter((s) => s.kind === "stay");

  const gaps: Gap[] = [];
  for (const seg of staySegments) {
    gaps.push(...unbookedNightsGaps(seg, activeItems));
    gaps.push(...emptySlotGaps(seg, activeItems));
  }
  gaps.push(...missingTransportGaps(ordered, activeItems));
  return gaps;
}
