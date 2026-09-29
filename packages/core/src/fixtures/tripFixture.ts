import { computeExpiry } from "../ttl.js";
import type { Item, Preference, Segment, Trip } from "../schema.js";

/**
 * A 9-night, 3-city trip: Lisbon -> Porto -> Madrid, with real transit segments
 * between each stay (Segment.kind === "transit"). Deliberately contains:
 * - one unbooked night (Porto, night of 2026-11-06)
 * - one missing intercity transport leg (the Porto -> Madrid transit segment has
 *   no booked transport item on it)
 * - one expired offer (an old Porto accommodation idea, TTL long passed)
 * - a mix of booked, shortlisted, idea, and rejected items
 * - an unassigned idea sitting in the inbox (segment_id: null)
 */
export const FIXTURE_NOW = new Date("2026-11-01T08:00:00Z");

export const fixtureTrip: Trip = {
  id: "trip-fixture",
  title: "9-Night Iberia Trip",
  travelers: { adults: 2, children_ages: [4] },
  home_base: "IST",
  currency: "EUR",
  budget_total: 3000,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};

export const fixtureSegments: Segment[] = [
  {
    id: "seg-lisbon",
    trip_id: fixtureTrip.id,
    kind: "stay",
    city: "Lisbon",
    start_date: "2026-11-01",
    end_date: "2026-11-04",
    order: 0,
  },
  {
    id: "seg-transit-lisbon-porto",
    trip_id: fixtureTrip.id,
    kind: "transit",
    city: null,
    start_date: "2026-11-04",
    end_date: "2026-11-04",
    order: 1,
  },
  {
    id: "seg-porto",
    trip_id: fixtureTrip.id,
    kind: "stay",
    city: "Porto",
    start_date: "2026-11-04",
    end_date: "2026-11-07",
    order: 2,
  },
  {
    // No transport item is ever booked on this segment — the missing_transport gap.
    id: "seg-transit-porto-madrid",
    trip_id: fixtureTrip.id,
    kind: "transit",
    city: null,
    start_date: "2026-11-07",
    end_date: "2026-11-07",
    order: 3,
  },
  {
    id: "seg-madrid",
    trip_id: fixtureTrip.id,
    kind: "stay",
    city: "Madrid",
    start_date: "2026-11-07",
    end_date: "2026-11-10",
    order: 4,
  },
];

function manualSource() {
  return { origin: "manual" as const, url: null, agent_name: null };
}

export const fixtureItems: Item[] = [
  {
    id: "item-acc-lisbon",
    trip_id: fixtureTrip.id,
    segment_id: "seg-lisbon",
    type: "accommodation",
    status: "booked",
    title: "Alfama Boutique Hotel",
    place_ref: null,
    starts_at: "2026-11-01T15:00:00Z",
    ends_at: "2026-11-04T11:00:00Z",
    cost: { amount: 450, currency: "EUR" },
    source: manualSource(),
    captured_at: "2026-09-01T00:00:00Z",
    expires_at: computeExpiry("accommodation", "2026-09-01T00:00:00Z"),
    cancellable_until: "2026-10-25T00:00:00Z",
    raw: null,
  },
  {
    // Covers only 2 of Porto's 3 nights (11-04, 11-05) -> the night of 11-06 is unbooked.
    id: "item-acc-porto",
    trip_id: fixtureTrip.id,
    segment_id: "seg-porto",
    type: "accommodation",
    status: "booked",
    title: "Ribeira Riverside Guesthouse",
    place_ref: null,
    starts_at: "2026-11-04T15:00:00Z",
    ends_at: "2026-11-06T11:00:00Z",
    cost: { amount: 180, currency: "EUR" },
    source: manualSource(),
    captured_at: "2026-09-01T00:00:00Z",
    expires_at: computeExpiry("accommodation", "2026-09-01T00:00:00Z"),
    cancellable_until: "2026-10-25T00:00:00Z",
    raw: null,
  },
  {
    id: "item-acc-madrid",
    trip_id: fixtureTrip.id,
    segment_id: "seg-madrid",
    type: "accommodation",
    status: "booked",
    title: "Sol Central Apartments",
    place_ref: null,
    starts_at: "2026-11-07T15:00:00Z",
    ends_at: "2026-11-10T11:00:00Z",
    cost: { amount: 500, currency: "EUR" },
    source: manualSource(),
    captured_at: "2026-09-01T00:00:00Z",
    expires_at: computeExpiry("accommodation", "2026-09-01T00:00:00Z"),
    cancellable_until: "2026-10-25T00:00:00Z",
    raw: null,
  },
  {
    // Lisbon -> Porto transport is booked on the transit segment itself, so no
    // missing_transport gap between them.
    id: "item-transport-lisbon-porto",
    trip_id: fixtureTrip.id,
    segment_id: "seg-transit-lisbon-porto",
    type: "transport",
    status: "booked",
    title: "Train Lisbon -> Porto",
    place_ref: null,
    starts_at: "2026-11-04T12:00:00Z",
    ends_at: "2026-11-04T14:30:00Z",
    cost: { amount: 40, currency: "EUR" },
    source: manualSource(),
    captured_at: "2026-09-01T00:00:00Z",
    expires_at: computeExpiry("transport", "2026-09-01T00:00:00Z"),
    cancellable_until: null,
    raw: null,
  },
  // No Porto -> Madrid transport item exists at all: the missing_transport gap.
  {
    // Captured a month before FIXTURE_NOW; accommodation TTL is 48h, so this is
    // long expired and must be excluded from gaps/agent context (but not deleted).
    id: "item-acc-porto-old-quote",
    trip_id: fixtureTrip.id,
    segment_id: null,
    type: "accommodation",
    status: "idea",
    title: "Alternative Porto Guesthouse (old quote)",
    place_ref: null,
    starts_at: null,
    ends_at: null,
    cost: { amount: 150, currency: "EUR" },
    source: manualSource(),
    captured_at: "2026-10-01T00:00:00Z",
    expires_at: computeExpiry("accommodation", "2026-10-01T00:00:00Z"),
    cancellable_until: null,
    raw: null,
  },
  {
    id: "item-activity-belem",
    trip_id: fixtureTrip.id,
    segment_id: "seg-lisbon",
    type: "activity",
    status: "shortlisted",
    title: "Belem Tower guided tour",
    place_ref: null,
    starts_at: "2026-11-02T10:00:00Z",
    ends_at: "2026-11-02T11:30:00Z",
    cost: { amount: 60, currency: "EUR" },
    source: manualSource(),
    captured_at: "2026-10-20T00:00:00Z",
    expires_at: computeExpiry("activity", "2026-10-20T00:00:00Z"),
    cancellable_until: null,
    raw: null,
  },
  {
    id: "item-meal-timeout",
    trip_id: fixtureTrip.id,
    segment_id: "seg-lisbon",
    type: "meal",
    status: "idea",
    title: "Dinner at Time Out Market",
    place_ref: null,
    starts_at: "2026-11-02T19:30:00Z",
    ends_at: "2026-11-02T21:00:00Z",
    cost: null,
    source: manualSource(),
    captured_at: "2026-10-20T00:00:00Z",
    expires_at: computeExpiry("meal", "2026-10-20T00:00:00Z"),
    cancellable_until: null,
    raw: null,
  },
  {
    // Unassigned idea sitting in the inbox — undated, so starts_at/ends_at are null.
    id: "item-activity-sintra-idea",
    trip_id: fixtureTrip.id,
    segment_id: null,
    type: "activity",
    status: "idea",
    title: "Day trip to Sintra",
    place_ref: null,
    starts_at: null,
    ends_at: null,
    cost: null,
    source: manualSource(),
    captured_at: "2026-10-25T00:00:00Z",
    expires_at: computeExpiry("activity", "2026-10-25T00:00:00Z"),
    cancellable_until: null,
    raw: null,
  },
  {
    // Rejected: must never count toward budget, gaps, or agent context.
    id: "item-acc-madrid-rejected",
    trip_id: fixtureTrip.id,
    segment_id: "seg-madrid",
    type: "accommodation",
    status: "rejected",
    title: "Overpriced Madrid Suite",
    place_ref: null,
    starts_at: "2026-11-07T15:00:00Z",
    ends_at: "2026-11-10T11:00:00Z",
    cost: { amount: 900, currency: "EUR" },
    source: manualSource(),
    captured_at: "2026-09-05T00:00:00Z",
    expires_at: computeExpiry("accommodation", "2026-09-05T00:00:00Z"),
    cancellable_until: null,
    raw: null,
  },
];

export const fixturePreferences: Preference[] = [
  { id: "pref-early-flights", trip_id: fixtureTrip.id, text: "no early flights", source: "user" },
  {
    id: "pref-vegetarian",
    trip_id: fixtureTrip.id,
    text: "vegetarian-friendly restaurants",
    source: "inferred",
  },
];
