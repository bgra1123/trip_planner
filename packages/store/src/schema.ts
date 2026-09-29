import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import type { Cost, PlaceRef, Source, Travelers } from "@trip-memory/core";

export const trips = sqliteTable("trips", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  travelers: text("travelers", { mode: "json" }).notNull().$type<Travelers>(),
  homeBase: text("home_base").notNull(),
  currency: text("currency").notNull(),
  budgetTotal: real("budget_total"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const segments = sqliteTable("segments", {
  id: text("id").primaryKey(),
  tripId: text("trip_id")
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["stay", "transit"] }).notNull(),
  city: text("city"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  order: integer("ordering").notNull(),
});

export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  tripId: text("trip_id")
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  segmentId: text("segment_id").references(() => segments.id, { onDelete: "set null" }),
  type: text("type", {
    enum: ["accommodation", "transport", "activity", "meal", "note"],
  }).notNull(),
  status: text("status", { enum: ["idea", "shortlisted", "booked", "rejected"] }).notNull(),
  title: text("title").notNull(),
  placeRef: text("place_ref", { mode: "json" }).$type<PlaceRef | null>(),
  startsAt: text("starts_at"),
  endsAt: text("ends_at"),
  cost: text("cost", { mode: "json" }).$type<Cost | null>(),
  source: text("source", { mode: "json" }).notNull().$type<Source>(),
  capturedAt: text("captured_at").notNull(),
  expiresAt: text("expires_at"),
  cancellableUntil: text("cancellable_until"),
  raw: text("raw", { mode: "json" }).$type<unknown>(),
});

export const preferences = sqliteTable("preferences", {
  id: text("id").primaryKey(),
  tripId: text("trip_id")
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  source: text("source", { enum: ["user", "inferred"] }).notNull(),
});

export const tripTokens = sqliteTable("trip_tokens", {
  token: text("token").primaryKey(),
  tripId: text("trip_id")
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  label: text("label"),
  createdAt: text("created_at").notNull(),
});
