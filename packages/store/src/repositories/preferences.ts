import { eq } from "drizzle-orm";
import type { CreatePreferenceInput, Preference } from "@trip-memory/core";
import type { Db } from "../db.js";
import { preferences } from "../schema.js";
import { preferenceToRow, rowToPreference } from "../mappers.js";
import { newId } from "../ids.js";

export function createPreference(db: Db, input: CreatePreferenceInput): Preference {
  const pref: Preference = { ...input, id: newId("pref") };
  db.insert(preferences).values(preferenceToRow(pref)).run();
  return pref;
}

export function listPreferences(db: Db, tripId: string): Preference[] {
  return db
    .select()
    .from(preferences)
    .where(eq(preferences.tripId, tripId))
    .all()
    .map(rowToPreference);
}
