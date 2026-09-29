import { z } from "zod";

export const TravelersSchema = z.object({
  adults: z.number().int().nonnegative(),
  children_ages: z.array(z.number().int().nonnegative()),
});
export type Travelers = z.infer<typeof TravelersSchema>;

export const TripSchema = z.object({
  id: z.string(),
  title: z.string(),
  travelers: TravelersSchema,
  home_base: z.string(),
  currency: z.string(),
  budget_total: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Trip = z.infer<typeof TripSchema>;

export const SegmentKindSchema = z.enum(["stay", "transit"]);
export type SegmentKind = z.infer<typeof SegmentKindSchema>;

export const SegmentSchema = z.object({
  id: z.string(),
  trip_id: z.string(),
  kind: SegmentKindSchema,
  city: z.string().nullable(),
  start_date: z.string(),
  end_date: z.string(),
  order: z.number().int(),
});
export type Segment = z.infer<typeof SegmentSchema>;

export const ItemTypeSchema = z.enum(["accommodation", "transport", "activity", "meal", "note"]);
export type ItemType = z.infer<typeof ItemTypeSchema>;

export const ItemStatusSchema = z.enum(["idea", "shortlisted", "booked", "rejected"]);
export type ItemStatus = z.infer<typeof ItemStatusSchema>;

export const PlaceRefSchema = z.object({
  provider: z.enum(["google", "mapbox", "unresolved"]),
  provider_id: z.string().nullable(),
  name: z.string(),
  address: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  resolved_at: z.string().nullable(),
});
export type PlaceRef = z.infer<typeof PlaceRefSchema>;

export const CostSchema = z.object({
  amount: z.number(),
  currency: z.string(),
});
export type Cost = z.infer<typeof CostSchema>;

export const SourceSchema = z.object({
  origin: z.enum(["extension", "manual", "agent"]),
  url: z.string().nullable(),
  agent_name: z.string().nullable(),
});
export type Source = z.infer<typeof SourceSchema>;

export const ItemSchema = z.object({
  id: z.string(),
  trip_id: z.string(),
  segment_id: z.string().nullable(),
  type: ItemTypeSchema,
  status: ItemStatusSchema,
  title: z.string(),
  place_ref: PlaceRefSchema.nullable(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  cost: CostSchema.nullable(),
  source: SourceSchema,
  captured_at: z.string(),
  expires_at: z.string().nullable(),
  cancellable_until: z.string().nullable(),
  raw: z.unknown(),
});
export type Item = z.infer<typeof ItemSchema>;

export const PreferenceSourceSchema = z.enum(["user", "inferred"]);
export type PreferenceSource = z.infer<typeof PreferenceSourceSchema>;

export const PreferenceSchema = z.object({
  id: z.string(),
  trip_id: z.string(),
  text: z.string(),
  source: PreferenceSourceSchema,
});
export type Preference = z.infer<typeof PreferenceSchema>;

/** A raw place guess an agent may attach to a proposal — never a trusted PlaceRef.
 *  This is the only shape resolvePlace() accepts, so an agent can never claim a
 *  provider, coordinates, or a resolved_at timestamp directly. */
export const PlaceGuessSchema = z.object({
  name: z.string(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
});
export type PlaceGuess = z.infer<typeof PlaceGuessSchema>;

/** Args an agent may propose an item with — server-controlled fields (status, source,
 *  expires_at, captured_at, id) are never accepted from this shape, and place_ref is
 *  a PlaceGuess rather than a trusted PlaceRef: it must be run through resolvePlace(). */
export const ProposeItemInputSchema = ItemSchema.omit({
  id: true,
  trip_id: true,
  status: true,
  source: true,
  captured_at: true,
  expires_at: true,
  place_ref: true,
})
  .partial({
    segment_id: true,
    starts_at: true,
    ends_at: true,
    cost: true,
    cancellable_until: true,
    raw: true,
  })
  .extend({
    place_ref: PlaceGuessSchema.nullable().optional(),
  });
export type ProposeItemInput = z.infer<typeof ProposeItemInputSchema>;

export const CreateTripInputSchema = TripSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type CreateTripInput = z.infer<typeof CreateTripInputSchema>;

export const CreateSegmentInputSchema = SegmentSchema.omit({ id: true }).partial({ city: true });
export type CreateSegmentInput = z.infer<typeof CreateSegmentInputSchema>;

export const UpdateSegmentInputSchema = SegmentSchema.omit({ id: true, trip_id: true }).partial();
export type UpdateSegmentInput = z.infer<typeof UpdateSegmentInputSchema>;

export const CreateItemInputSchema = ItemSchema.omit({
  id: true,
  captured_at: true,
  expires_at: true,
}).partial({
  segment_id: true,
  place_ref: true,
  starts_at: true,
  ends_at: true,
  cost: true,
  cancellable_until: true,
  raw: true,
});
export type CreateItemInput = z.infer<typeof CreateItemInputSchema>;

export const UpdateItemInputSchema = ItemSchema.pick({
  status: true,
  segment_id: true,
  starts_at: true,
  ends_at: true,
  cost: true,
  place_ref: true,
  title: true,
}).partial();
export type UpdateItemInput = z.infer<typeof UpdateItemInputSchema>;

export const CreatePreferenceInputSchema = PreferenceSchema.omit({ id: true });
export type CreatePreferenceInput = z.infer<typeof CreatePreferenceInputSchema>;
