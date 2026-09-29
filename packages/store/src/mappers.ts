import type { Item, Preference, Segment, Trip } from "@trip-memory/core";
import type { items, preferences, segments, trips } from "./schema.js";

type TripRow = typeof trips.$inferSelect;
type SegmentRow = typeof segments.$inferSelect;
type ItemRow = typeof items.$inferSelect;
type PreferenceRow = typeof preferences.$inferSelect;

export function rowToTrip(row: TripRow): Trip {
  return {
    id: row.id,
    title: row.title,
    travelers: row.travelers,
    home_base: row.homeBase,
    currency: row.currency,
    budget_total: row.budgetTotal,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function tripToRow(trip: Trip): typeof trips.$inferInsert {
  return {
    id: trip.id,
    title: trip.title,
    travelers: trip.travelers,
    homeBase: trip.home_base,
    currency: trip.currency,
    budgetTotal: trip.budget_total,
    createdAt: trip.created_at,
    updatedAt: trip.updated_at,
  };
}

export function rowToSegment(row: SegmentRow): Segment {
  return {
    id: row.id,
    trip_id: row.tripId,
    kind: row.kind,
    city: row.city,
    start_date: row.startDate,
    end_date: row.endDate,
    order: row.order,
  };
}

export function segmentToRow(segment: Segment): typeof segments.$inferInsert {
  return {
    id: segment.id,
    tripId: segment.trip_id,
    kind: segment.kind,
    city: segment.city,
    startDate: segment.start_date,
    endDate: segment.end_date,
    order: segment.order,
  };
}

export function rowToItem(row: ItemRow): Item {
  return {
    id: row.id,
    trip_id: row.tripId,
    segment_id: row.segmentId,
    type: row.type,
    status: row.status,
    title: row.title,
    place_ref: row.placeRef,
    starts_at: row.startsAt,
    ends_at: row.endsAt,
    cost: row.cost,
    source: row.source,
    captured_at: row.capturedAt,
    expires_at: row.expiresAt,
    cancellable_until: row.cancellableUntil,
    raw: row.raw,
  };
}

export function itemToRow(item: Item): typeof items.$inferInsert {
  return {
    id: item.id,
    tripId: item.trip_id,
    segmentId: item.segment_id,
    type: item.type,
    status: item.status,
    title: item.title,
    placeRef: item.place_ref,
    startsAt: item.starts_at,
    endsAt: item.ends_at,
    cost: item.cost,
    source: item.source,
    capturedAt: item.captured_at,
    expiresAt: item.expires_at,
    cancellableUntil: item.cancellable_until,
    raw: item.raw,
  };
}

export function rowToPreference(row: PreferenceRow): Preference {
  return {
    id: row.id,
    trip_id: row.tripId,
    text: row.text,
    source: row.source,
  };
}

export function preferenceToRow(pref: Preference): typeof preferences.$inferInsert {
  return {
    id: pref.id,
    tripId: pref.trip_id,
    text: pref.text,
    source: pref.source,
  };
}
