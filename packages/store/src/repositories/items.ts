import { eq } from "drizzle-orm";
import { computeExpiry, type CreateItemInput, type Item, type UpdateItemInput } from "@trip-memory/core";
import type { Db } from "../db.js";
import { items } from "../schema.js";
import { itemToRow, rowToItem } from "../mappers.js";
import { newId } from "../ids.js";

export function createItem(db: Db, input: CreateItemInput): Item {
  const capturedAt = new Date().toISOString();
  const item: Item = {
    trip_id: input.trip_id,
    segment_id: input.segment_id ?? null,
    type: input.type,
    status: input.status,
    title: input.title,
    place_ref: input.place_ref ?? null,
    starts_at: input.starts_at ?? null,
    ends_at: input.ends_at ?? null,
    cost: input.cost ?? null,
    source: input.source,
    cancellable_until: input.cancellable_until ?? null,
    raw: input.raw ?? null,
    id: newId("item"),
    captured_at: capturedAt,
    expires_at: computeExpiry(input.type, capturedAt),
  };
  db.insert(items).values(itemToRow(item)).run();
  return item;
}

export function getItem(db: Db, id: string): Item | null {
  const row = db.select().from(items).where(eq(items.id, id)).get();
  return row ? rowToItem(row) : null;
}

export function listItems(db: Db, tripId: string): Item[] {
  return db.select().from(items).where(eq(items.tripId, tripId)).all().map(rowToItem);
}

export function updateItem(db: Db, id: string, input: UpdateItemInput): Item | null {
  const existing = getItem(db, id);
  if (!existing) return null;
  const updated: Item = { ...existing, ...input };
  db.update(items).set(itemToRow(updated)).where(eq(items.id, id)).run();
  return updated;
}

export function assignItemToSegment(db: Db, id: string, segmentId: string | null): Item | null {
  return updateItem(db, id, { segment_id: segmentId });
}

export function deleteItem(db: Db, id: string): boolean {
  const result = db.delete(items).where(eq(items.id, id)).run();
  return result.changes > 0;
}
