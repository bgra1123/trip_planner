import { useCallback, useEffect, useMemo, useState } from "react";
import { buildTripGraph, deriveBudget, deriveGaps, detectConflicts, resolveEffectiveSegments } from "@trip-memory/core";
import type { Item, Segment, Trip } from "@trip-memory/core";
import { getTripBundle, type Credentials } from "./api.js";

export function useTripData(credentials: Credentials) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const bundle = await getTripBundle(credentials);
      setTrip(bundle.trip);
      setSegments(bundle.segments);
      setItems(bundle.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [credentials]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Segments with start_date/end_date resolved from whichever transport/accommodation
  // item is currently chosen at each node — the view every other derived value and
  // the graph UI should read, instead of the raw stored dates.
  const effectiveSegments = useMemo(() => resolveEffectiveSegments(segments, items), [segments, items]);

  const budget = useMemo(() => (trip ? deriveBudget(trip, items) : null), [trip, items]);
  const gaps = useMemo(
    () => (trip ? deriveGaps(trip, effectiveSegments, items) : []),
    [trip, effectiveSegments, items],
  );
  const conflicts = useMemo(() => detectConflicts(items, effectiveSegments), [items, effectiveSegments]);
  const nodes = useMemo(() => buildTripGraph(effectiveSegments, items), [effectiveSegments, items]);

  return { trip, segments, effectiveSegments, items, nodes, budget, gaps, conflicts, loading, error, refresh };
}
