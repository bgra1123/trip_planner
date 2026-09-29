import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { tripTokens } from "../schema.js";

export type TripToken = {
  token: string;
  trip_id: string;
  label: string | null;
  created_at: string;
};

function generateToken(): string {
  return `tmk_${randomBytes(24).toString("hex")}`;
}

export function mintTripToken(db: Db, tripId: string, label: string | null = null): TripToken {
  const row = {
    token: generateToken(),
    tripId,
    label,
    createdAt: new Date().toISOString(),
  };
  db.insert(tripTokens).values(row).run();
  return { token: row.token, trip_id: row.tripId, label: row.label, created_at: row.createdAt };
}

/** Resolves a bearer token to the single trip it's scoped to, or null if unknown/revoked. */
export function resolveTripToken(db: Db, token: string): string | null {
  const row = db.select().from(tripTokens).where(eq(tripTokens.token, token)).get();
  return row ? row.tripId : null;
}

export function revokeTripToken(db: Db, token: string): boolean {
  const result = db.delete(tripTokens).where(eq(tripTokens.token, token)).run();
  return result.changes > 0;
}
