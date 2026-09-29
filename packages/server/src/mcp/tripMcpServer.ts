import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  buildAgentContext,
  deriveGaps,
  ProposeItemInputSchema,
  resolveEffectiveSegments,
  resolvePlace,
  type Item,
} from "@trip-memory/core";
import {
  createItem,
  getTrip,
  listItems,
  listPreferences,
  listSegments,
  type Db,
} from "@trip-memory/store";

/** Segments come back with dates resolved from whichever option is currently
 *  chosen at each node — every caller here wants that view, never the raw stored
 *  dates (there's no "raw dump" consumer of this function, unlike the REST API's
 *  GET /trips/:id, which intentionally stays ground-truth). */
function loadTripData(db: Db, tripId: string) {
  const trip = getTrip(db, tripId);
  if (!trip) throw new Error(`trip ${tripId} not found`);
  const items = listItems(db, tripId);
  return {
    trip,
    segments: resolveEffectiveSegments(listSegments(db, tripId), items),
    items,
    preferences: listPreferences(db, tripId),
  };
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function formatItemLine(item: Item): string {
  const date = item.starts_at ? ` (${item.starts_at.slice(0, 10)})` : "";
  return `[${item.status}] ${item.type}: ${item.title}${date} — ${item.id}`;
}

/**
 * Builds an MCP server scoped to exactly one trip. Every tool call resolves data
 * only for `tripId` — there is no way for a tool to reach another trip, because
 * this server instance never learns another trip's id.
 */
export function buildTripMcpServer(db: Db, tripId: string, webAppBaseUrl: string): McpServer {
  const server = new McpServer({ name: "trip-memory", version: "0.1.0" });

  server.registerTool(
    "get_trip_context",
    {
      title: "Get trip context",
      description:
        "Compact summary of the trip: dates, cities, budget, booked items, gaps, and preferences. Read this before giving any advice.",
      inputSchema: {
        focus: z.string().optional().describe("Optionally narrow the summary to a city or date"),
      },
    },
    async ({ focus }) => {
      const { trip, segments, items, preferences } = loadTripData(db, tripId);
      const context = buildAgentContext(trip, segments, items, preferences);
      if (!focus) return textResult(JSON.stringify(context, null, 2));

      const f = focus.toLowerCase();
      const narrowed = {
        ...context,
        booked: context.booked.filter((line) => line.toLowerCase().includes(f)),
        gaps: context.gaps.filter((line) => line.toLowerCase().includes(f)),
      };
      return textResult(JSON.stringify(narrowed, null, 2));
    },
  );

  server.registerTool(
    "get_gaps",
    {
      title: "Get trip gaps",
      description:
        "Unbooked nights, empty day slots, and missing intercity transport — the concrete planning gaps in this trip.",
      inputSchema: {},
    },
    async () => {
      const { trip, segments, items } = loadTripData(db, tripId);
      const gaps = deriveGaps(trip, segments, items);
      return textResult(JSON.stringify(gaps, null, 2));
    },
  );

  server.registerTool(
    "propose_item",
    {
      title: "Propose a trip item",
      description:
        "Propose an idea for the trip (accommodation, transport, activity, meal, or note). Always lands as an unconfirmed idea for the user to review — never as booked. A claimed price is recorded as unverified, not as a trusted cost.",
      inputSchema: {
        ...ProposeItemInputSchema.shape,
        agent_name: z.string().optional().describe("Which agent is proposing this, e.g. 'claude'"),
      },
    },
    async (args) => {
      const { agent_name, place_ref, cost, ...rest } = args;
      const resolvedPlace = place_ref ? resolvePlace(place_ref) : null;

      const item = createItem(db, {
        trip_id: tripId,
        segment_id: rest.segment_id ?? null,
        type: rest.type,
        status: "idea",
        title: rest.title,
        place_ref: resolvedPlace,
        starts_at: rest.starts_at ?? null,
        ends_at: rest.ends_at ?? null,
        cost: null,
        source: { origin: "agent", url: null, agent_name: agent_name ?? null },
        cancellable_until: rest.cancellable_until ?? null,
        raw: { ...(rest.raw && typeof rest.raw === "object" ? rest.raw : {}), agent_claimed_cost: cost ?? null },
      });

      const deepLink = `${webAppBaseUrl}/trip/${tripId}/inbox?item=${item.id}`;
      const unresolvedNote =
        item.place_ref?.provider === "unresolved" && place_ref
          ? " The place could not be verified and is flagged for review."
          : "";
      return textResult(
        `Added as an idea: "${item.title}" (${item.id}).${unresolvedNote} Review it here: ${deepLink}`,
      );
    },
  );

  server.registerTool(
    "search_trip_memory",
    {
      title: "Search trip memory",
      description: "Full-text search over this trip's items and notes, newest first.",
      inputSchema: {
        query: z.string().describe("Text to search for in item titles and notes"),
      },
    },
    async ({ query }) => {
      const { items } = loadTripData(db, tripId);
      const q = query.toLowerCase();
      const matches = items
        .filter(
          (item) =>
            item.title.toLowerCase().includes(q) ||
            JSON.stringify(item.raw ?? "").toLowerCase().includes(q),
        )
        .sort((a, b) => b.captured_at.localeCompare(a.captured_at));

      if (matches.length === 0) return textResult(`No matches for "${query}".`);
      return textResult(matches.map(formatItemLine).join("\n"));
    },
  );

  server.registerResource(
    "trip-context",
    `trip://${tripId}/context`,
    { title: "Trip context", mimeType: "application/json" },
    async (uri) => {
      const { trip, segments, items, preferences } = loadTripData(db, tripId);
      const context = buildAgentContext(trip, segments, items, preferences);
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(context, null, 2) }],
      };
    },
  );

  return server;
}
