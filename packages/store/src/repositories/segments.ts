import { asc, eq } from "drizzle-orm";
import type { CreateSegmentInput, Segment, UpdateSegmentInput } from "@trip-memory/core";
import type { Db } from "../db.js";
import { segments } from "../schema.js";
import { rowToSegment, segmentToRow } from "../mappers.js";
import { newId } from "../ids.js";

export function createSegment(db: Db, input: CreateSegmentInput): Segment {
  const segment: Segment = { ...input, city: input.city ?? null, id: newId("seg") };
  db.insert(segments).values(segmentToRow(segment)).run();
  return segment;
}

export function getSegment(db: Db, id: string): Segment | null {
  const row = db.select().from(segments).where(eq(segments.id, id)).get();
  return row ? rowToSegment(row) : null;
}

export function listSegments(db: Db, tripId: string): Segment[] {
  return db
    .select()
    .from(segments)
    .where(eq(segments.tripId, tripId))
    .orderBy(asc(segments.order))
    .all()
    .map(rowToSegment);
}

export function updateSegment(db: Db, id: string, input: UpdateSegmentInput): Segment | null {
  const existing = getSegment(db, id);
  if (!existing) return null;
  const updated: Segment = { ...existing, ...input };
  db.update(segments).set(segmentToRow(updated)).where(eq(segments.id, id)).run();
  return updated;
}
