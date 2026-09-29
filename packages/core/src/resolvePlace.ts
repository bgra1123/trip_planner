import type { PlaceRef } from "./schema.js";

export type ResolvePlaceInput = {
  name: string;
  address?: string | null;
  city?: string | null;
};

/**
 * Resolution layer stub (Phase 5 replaces the body with real Google/Mapbox lookups).
 * Always returns `unresolved` for now, which is the correct behavior for an
 * unimplemented provider: callers must treat an unresolved place as unverified,
 * never silently accept it — this stub makes that the only possible outcome today.
 */
export function resolvePlace(input: ResolvePlaceInput): PlaceRef {
  return {
    provider: "unresolved",
    provider_id: null,
    name: input.name,
    address: input.address ?? null,
    lat: null,
    lng: null,
    resolved_at: null,
  };
}
