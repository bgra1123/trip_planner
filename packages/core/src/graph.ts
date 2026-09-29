import type { Item, ItemType, Segment } from "./schema.js";
import { toDateOnly } from "./dates.js";

const CANDIDATE_TYPE_BY_KIND: Record<Segment["kind"], ItemType> = {
  transit: "transport",
  stay: "accommodation",
};

export type TripNode = {
  segment: Segment;
  /** Which Item type competes for this node: 'transport' for a transit segment,
   *  'accommodation' for a stay segment. */
  candidateType: ItemType;
  /** Non-rejected items of `candidateType` assigned to this segment — the options
   *  being compared at this node. */
  candidates: Item[];
  /** The one candidate with status 'booked', if any — the currently chosen option. */
  chosen: Item | null;
  /** activity/meal/note items assigned to this segment — empty for transit nodes. */
  otherItems: Item[];
};

/**
 * Builds the trip's node chain: one TripNode per Segment, in `order`. A node's
 * candidates are the non-rejected items of the matching type assigned to it, and
 * its chosen option is whichever candidate (at most one) is booked.
 */
export function buildTripGraph(segments: Segment[], items: Item[]): TripNode[] {
  const ordered = [...segments].sort((a, b) => a.order - b.order);

  return ordered.map((segment) => {
    const candidateType = CANDIDATE_TYPE_BY_KIND[segment.kind];
    const segmentItems = items.filter((item) => item.segment_id === segment.id);
    const candidates = segmentItems.filter(
      (item) => item.type === candidateType && item.status !== "rejected",
    );
    const chosen = candidates.find((item) => item.status === "booked") ?? null;
    const otherItems = segmentItems.filter(
      (item) => item.type === "activity" || item.type === "meal" || item.type === "note",
    );
    return { segment, candidateType, candidates, chosen, otherItems };
  });
}

/**
 * Labels a transit node by the cities on either side of it ("Lisbon -> Porto"),
 * since a transit Segment only carries a single `city` field (usually null) — the
 * endpoints come from the nearest stay node on each side.
 */
export function routeLabel(nodes: TripNode[], index: number): string {
  const from = findAdjacentStayCity(nodes, index, -1);
  const to = findAdjacentStayCity(nodes, index, 1);
  return `${from ?? "?"} -> ${to ?? "?"}`;
}

function findAdjacentStayCity(nodes: TripNode[], index: number, direction: 1 | -1): string | null {
  for (let i = index + direction; i >= 0 && i < nodes.length; i += direction) {
    if (nodes[i]!.segment.kind === "stay") return nodes[i]!.segment.city;
  }
  return null;
}

/**
 * A transit node's effective dates come only from its own chosen item — never from
 * a neighbor — so there is no ordering/two-pass hazard when a stay node reads its
 * transit neighbors below: every node it might look at is already fully computable
 * on its own. Do not "fix" this into a two-pass memoized version; it isn't needed.
 */
function transitNodeDates(node: TripNode): { start_date: string; end_date: string } {
  if (node.chosen?.starts_at) {
    const start = toDateOnly(node.chosen.starts_at);
    const end = node.chosen.ends_at ? toDateOnly(node.chosen.ends_at) : start;
    return { start_date: start, end_date: end };
  }
  return { start_date: node.segment.start_date, end_date: node.segment.end_date };
}

/**
 * Computes each node's effective date range: a transit node's own chosen item
 * (or its stored dates, if nothing is chosen yet); a stay node's range from the
 * bracketing transit nodes' effective end/start (or its own stored dates, if a
 * neighbor is missing or has nothing chosen). Pure — never persisted by this
 * function; callers decide whether/where to apply the result.
 */
export function deriveChainDates(nodes: TripNode[]): Map<string, { start_date: string; end_date: string }> {
  const result = new Map<string, { start_date: string; end_date: string }>();

  nodes.forEach((node, i) => {
    if (node.segment.kind === "transit") {
      result.set(node.segment.id, transitNodeDates(node));
      return;
    }

    const prev = nodes[i - 1];
    const next = nodes[i + 1];
    const prevDates = prev && prev.segment.kind === "transit" ? transitNodeDates(prev) : null;
    const nextDates = next && next.segment.kind === "transit" ? transitNodeDates(next) : null;

    result.set(node.segment.id, {
      start_date: prevDates?.end_date ?? node.segment.start_date,
      end_date: nextDates?.start_date ?? node.segment.end_date,
    });
  });

  return result;
}

/**
 * Returns `segments` with `start_date`/`end_date` overridden per `deriveChainDates`
 * — the read-time view every consumer (gaps, conflicts, the graph UI, agent
 * context) should use instead of the raw stored dates. Nothing is written back;
 * call this fresh wherever segments are about to be read.
 */
export function resolveEffectiveSegments(segments: Segment[], items: Item[]): Segment[] {
  const nodes = buildTripGraph(segments, items);
  const dates = deriveChainDates(nodes);

  return segments.map((segment) => {
    const computed = dates.get(segment.id);
    if (!computed) return segment;
    return { ...segment, start_date: computed.start_date, end_date: computed.end_date };
  });
}
