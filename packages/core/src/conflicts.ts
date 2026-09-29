import type { Item, Segment } from "./schema.js";
import { overlaps, toDateOnly } from "./dates.js";

export type ConflictKind = "overlap" | "out_of_range";

export type Conflict = {
  kind: ConflictKind;
  item_ids: string[];
  detail: string;
};

// Accommodation and note items span or describe a whole stay rather than claiming a
// slot of the traveler's day, so they're expected to "contain" other items — only
// schedulable types compete for the same time.
const SCHEDULABLE_TYPES: Item["type"][] = ["activity", "transport", "meal"];

function overlapConflicts(items: Item[]): Conflict[] {
  const timed = items.filter(
    (i) => i.status !== "rejected" && i.starts_at && i.ends_at && SCHEDULABLE_TYPES.includes(i.type),
  );
  const conflicts: Conflict[] = [];

  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i]!;
      const b = timed[j]!;
      if (overlaps(a.starts_at!, a.ends_at!, b.starts_at!, b.ends_at!)) {
        conflicts.push({
          kind: "overlap",
          item_ids: [a.id, b.id],
          detail: `"${a.title}" overlaps with "${b.title}"`,
        });
      }
    }
  }
  return conflicts;
}

function outOfRangeConflicts(items: Item[], segments: Segment[]): Conflict[] {
  const segmentById = new Map(segments.map((s) => [s.id, s]));
  const conflicts: Conflict[] = [];

  for (const item of items) {
    // Only a booked item's timing is a real commitment — an unbooked candidate
    // sitting on the same node (e.g. an alternative flight option) will routinely
    // have different timing than whatever's currently chosen, and that's not a
    // conflict, just an option.
    if (item.status !== "booked" || !item.segment_id || !item.starts_at) continue;
    const seg = segmentById.get(item.segment_id);
    if (!seg) continue;
    const day = toDateOnly(item.starts_at);
    if (day < toDateOnly(seg.start_date) || day > toDateOnly(seg.end_date)) {
      conflicts.push({
        kind: "out_of_range",
        item_ids: [item.id],
        detail: `"${item.title}" is scheduled outside its segment's date range`,
      });
    }
  }
  return conflicts;
}

export function detectConflicts(items: Item[], segments: Segment[] = []): Conflict[] {
  return [...overlapConflicts(items), ...outOfRangeConflicts(items, segments)];
}
