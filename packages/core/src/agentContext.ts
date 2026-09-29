import type { Item, Preference, Segment, Trip } from "./schema.js";
import { deriveBudget, type BudgetSummary } from "./budget.js";
import { deriveGaps } from "./gaps.js";
import { isItemActive } from "./ttl.js";

export type AgentContext = {
  trip: {
    id: string;
    title: string;
    dates: { start: string | null; end: string | null };
    travelers: string;
    home_base: string;
    currency: string;
  };
  cities: string[];
  budget: BudgetSummary & { currency: string };
  booked: string[];
  gaps: string[];
  preferences: string[];
};

function describeTravelers(trip: Trip): string {
  const kids = trip.travelers.children_ages.length;
  return kids > 0
    ? `${trip.travelers.adults} adult(s), ${kids} child(ren)`
    : `${trip.travelers.adults} adult(s)`;
}

function describeItem(item: Item): string {
  const date = item.starts_at ? ` (${item.starts_at.slice(0, 10)})` : "";
  const cost = item.cost ? ` — ${item.cost.amount} ${item.cost.currency}` : "";
  return `${item.type}: ${item.title}${date}${cost}`;
}

function tripDateRange(segments: Segment[]): { start: string | null; end: string | null } {
  if (segments.length === 0) return { start: null, end: null };
  let start = segments[0]!.start_date;
  let end = segments[0]!.end_date;
  for (const seg of segments) {
    if (seg.start_date < start) start = seg.start_date;
    if (seg.end_date > end) end = seg.end_date;
  }
  return { start, end };
}

/**
 * Compact summary served to agents over MCP. Excludes rejected items, expired items,
 * and the `raw` field — a stale price shown as current is worse than no price.
 */
export function buildAgentContext(
  trip: Trip,
  segments: Segment[],
  items: Item[],
  preferences: Preference[],
  now: Date = new Date(),
): AgentContext {
  const activeItems = items.filter((item) => isItemActive(item, now));
  const staySegments = [...segments]
    .filter((s) => s.kind === "stay")
    .sort((a, b) => a.order - b.order);
  const cities = staySegments
    .map((s) => s.city)
    .filter((city): city is string => city !== null);

  const budget = deriveBudget(trip, activeItems);
  const gaps = deriveGaps(trip, segments, activeItems, now);
  const booked = activeItems.filter((item) => item.status === "booked").map(describeItem);

  return {
    trip: {
      id: trip.id,
      title: trip.title,
      dates: tripDateRange(segments),
      travelers: describeTravelers(trip),
      home_base: trip.home_base,
      currency: trip.currency,
    },
    cities,
    budget: { ...budget, currency: trip.currency },
    booked,
    gaps: gaps.map((g) => g.detail),
    preferences: preferences.map((p) => p.text),
  };
}
