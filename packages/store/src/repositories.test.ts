import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./testDb.js";
import type { Db } from "./db.js";
import { createTrip, getTrip, updateTrip } from "./repositories/trips.js";
import { createSegment, listSegments } from "./repositories/segments.js";
import {
  assignItemToSegment,
  createItem,
  deleteItem,
  listItems,
  updateItem,
} from "./repositories/items.js";
import { createPreference, listPreferences } from "./repositories/preferences.js";
import { mintTripToken, resolveTripToken, revokeTripToken } from "./repositories/tokens.js";

let db: Db;

beforeEach(() => {
  db = createTestDb();
});

describe("trips repository", () => {
  it("creates and reads a trip", () => {
    const trip = createTrip(db, {
      title: "Iberia Trip",
      travelers: { adults: 2, children_ages: [] },
      home_base: "IST",
      currency: "EUR",
      budget_total: 2000,
    });
    expect(trip.id).toMatch(/^trip_/);
    expect(getTrip(db, trip.id)).toEqual(trip);
  });

  it("returns null for an unknown trip", () => {
    expect(getTrip(db, "trip_nope")).toBeNull();
  });

  it("updates fields and bumps updated_at", () => {
    const trip = createTrip(db, {
      title: "Iberia Trip",
      travelers: { adults: 2, children_ages: [] },
      home_base: "IST",
      currency: "EUR",
      budget_total: 2000,
    });
    const updated = updateTrip(db, trip.id, { budget_total: 2500 });
    expect(updated?.budget_total).toBe(2500);
    expect(updated?.created_at).toBe(trip.created_at);
    expect(getTrip(db, trip.id)?.budget_total).toBe(2500);
  });
});

describe("segments repository", () => {
  it("lists segments ordered by their order field", () => {
    const trip = createTrip(db, {
      title: "T",
      travelers: { adults: 1, children_ages: [] },
      home_base: "IST",
      currency: "EUR",
      budget_total: null,
    });
    createSegment(db, {
      trip_id: trip.id,
      kind: "stay",
      city: "Porto",
      start_date: "2026-11-04",
      end_date: "2026-11-07",
      order: 1,
    });
    createSegment(db, {
      trip_id: trip.id,
      kind: "stay",
      city: "Lisbon",
      start_date: "2026-11-01",
      end_date: "2026-11-04",
      order: 0,
    });
    const segments = listSegments(db, trip.id);
    expect(segments.map((s) => s.city)).toEqual(["Lisbon", "Porto"]);
  });
});

describe("items repository", () => {
  function makeTripAndSegment(db: Db) {
    const trip = createTrip(db, {
      title: "T",
      travelers: { adults: 1, children_ages: [] },
      home_base: "IST",
      currency: "EUR",
      budget_total: 1000,
    });
    const segment = createSegment(db, {
      trip_id: trip.id,
      kind: "stay",
      city: "Lisbon",
      start_date: "2026-11-01",
      end_date: "2026-11-04",
      order: 0,
    });
    return { trip, segment };
  }

  it("computes expires_at from the type's TTL on create", () => {
    const { trip, segment } = makeTripAndSegment(db);
    const item = createItem(db, {
      trip_id: trip.id,
      segment_id: segment.id,
      type: "accommodation",
      status: "idea",
      title: "Some Hotel",
      place_ref: null,
      starts_at: null,
      ends_at: null,
      cost: null,
      source: { origin: "manual", url: null, agent_name: null },
      cancellable_until: null,
      raw: null,
    });
    expect(item.expires_at).not.toBeNull();
    expect(new Date(item.expires_at!).getTime()).toBeGreaterThan(new Date(item.captured_at).getTime());
  });

  it("assigns an unassigned item to a segment and updates status", () => {
    const { trip, segment } = makeTripAndSegment(db);
    const item = createItem(db, {
      trip_id: trip.id,
      segment_id: null,
      type: "activity",
      status: "idea",
      title: "Sintra day trip",
      place_ref: null,
      starts_at: null,
      ends_at: null,
      cost: null,
      source: { origin: "manual", url: null, agent_name: null },
      cancellable_until: null,
      raw: null,
    });
    expect(item.segment_id).toBeNull();

    const assigned = assignItemToSegment(db, item.id, segment.id);
    expect(assigned?.segment_id).toBe(segment.id);

    const booked = updateItem(db, item.id, { status: "booked" });
    expect(booked?.status).toBe("booked");
    expect(listItems(db, trip.id)).toHaveLength(1);
  });

  it("deletes an item", () => {
    const { trip } = makeTripAndSegment(db);
    const item = createItem(db, {
      trip_id: trip.id,
      segment_id: null,
      type: "note",
      status: "idea",
      title: "n",
      place_ref: null,
      starts_at: null,
      ends_at: null,
      cost: null,
      source: { origin: "manual", url: null, agent_name: null },
      cancellable_until: null,
      raw: null,
    });
    expect(deleteItem(db, item.id)).toBe(true);
    expect(listItems(db, trip.id)).toHaveLength(0);
  });
});

describe("preferences repository", () => {
  it("creates and lists preferences for a trip", () => {
    const trip = createTrip(db, {
      title: "T",
      travelers: { adults: 1, children_ages: [] },
      home_base: "IST",
      currency: "EUR",
      budget_total: null,
    });
    createPreference(db, { trip_id: trip.id, text: "no early flights", source: "user" });
    expect(listPreferences(db, trip.id).map((p) => p.text)).toEqual(["no early flights"]);
  });
});

describe("tokens repository", () => {
  it("mints a token scoped to exactly one trip", () => {
    const tripA = createTrip(db, {
      title: "A",
      travelers: { adults: 1, children_ages: [] },
      home_base: "IST",
      currency: "EUR",
      budget_total: null,
    });
    const tripB = createTrip(db, {
      title: "B",
      travelers: { adults: 1, children_ages: [] },
      home_base: "IST",
      currency: "EUR",
      budget_total: null,
    });
    const token = mintTripToken(db, tripA.id);
    expect(resolveTripToken(db, token.token)).toBe(tripA.id);
    expect(resolveTripToken(db, token.token)).not.toBe(tripB.id);
  });

  it("returns null for an unknown or revoked token", () => {
    const trip = createTrip(db, {
      title: "A",
      travelers: { adults: 1, children_ages: [] },
      home_base: "IST",
      currency: "EUR",
      budget_total: null,
    });
    const token = mintTripToken(db, trip.id);
    expect(revokeTripToken(db, token.token)).toBe(true);
    expect(resolveTripToken(db, token.token)).toBeNull();
    expect(resolveTripToken(db, "tmk_garbage")).toBeNull();
  });
});
