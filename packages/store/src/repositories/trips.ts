import { eq } from "drizzle-orm";
import type { CreateTripInput, Trip } from "@trip-memory/core";
import type { Db } from "../db.js";
import { trips } from "../schema.js";
import { rowToTrip, tripToRow } from "../mappers.js";
import { newId } from "../ids.js";

export function createTrip(db: Db, input: CreateTripInput): Trip {
  const now = new Date().toISOString();
  const trip: Trip = { ...input, id: newId("trip"), created_at: now, updated_at: now };
  db.insert(trips).values(tripToRow(trip)).run();
  return trip;
}

export function getTrip(db: Db, id: string): Trip | null {
  const row = db.select().from(trips).where(eq(trips.id, id)).get();
  return row ? rowToTrip(row) : null;
}

export type UpdateTripInput = Partial<Omit<Trip, "id" | "created_at" | "updated_at">>;

export function updateTrip(db: Db, id: string, input: UpdateTripInput): Trip | null {
  const existing = getTrip(db, id);
  if (!existing) return null;
  const updated: Trip = { ...existing, ...input, updated_at: new Date().toISOString() };
  db.update(trips).set(tripToRow(updated)).where(eq(trips.id, id)).run();
  return updated;
}
