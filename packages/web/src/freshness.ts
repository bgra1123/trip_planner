export type Freshness = "hot" | "warm" | "cool";

/**
 * Where an item sits in its offer's freshness window. Items with no TTL (notes,
 * or anything expires_at-less) are evergreen and always read as "hot" — there's
 * no staleness signal to degrade them.
 */
export function freshnessOf(
  item: { captured_at: string; expires_at: string | null },
  now: Date = new Date(),
): Freshness {
  if (!item.expires_at) return "hot";

  const captured = new Date(item.captured_at).getTime();
  const expires = new Date(item.expires_at).getTime();
  const total = expires - captured;
  if (total <= 0) return "cool";

  const fraction = (now.getTime() - captured) / total;
  if (fraction < 0.34) return "hot";
  if (fraction < 0.75) return "warm";
  return "cool";
}
