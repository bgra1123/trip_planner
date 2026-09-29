import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createTestDb } from "@trip-memory/store/testing";
import { createSegment, createTrip, listItems, mintTripToken, type Db } from "@trip-memory/store";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";

let db: Db;
let app: FastifyInstance;
let baseUrl: string;

beforeEach(async () => {
  db = createTestDb();
  app = buildApp(db, { webAppBaseUrl: "http://localhost:5173" });
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
});

afterEach(async () => {
  await app.close();
});

function seedTrip() {
  const trip = createTrip(db, {
    title: "MCP Trip",
    travelers: { adults: 2, children_ages: [] },
    home_base: "IST",
    currency: "EUR",
    budget_total: 1500,
  });
  const segment = createSegment(db, {
    trip_id: trip.id,
    kind: "stay",
    city: "Lisbon",
    start_date: "2026-11-01",
    end_date: "2026-11-04",
    order: 0,
  });
  const token = mintTripToken(db, trip.id, "test");
  return { trip, segment, token: token.token };
}

async function connectedClient(token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(transport);
  return client;
}

type ToolTextContent = { content?: Array<{ type: string; text?: string }> };

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const block = (result as ToolTextContent).content?.find((c) => c.type === "text");
  if (!block?.text) throw new Error("no text content in tool result");
  return block.text;
}

describe("MCP connector", () => {
  it("lists the four tools", async () => {
    const { token } = seedTrip();
    const client = await connectedClient(token);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_gaps",
      "get_trip_context",
      "propose_item",
      "search_trip_memory",
    ]);
  });

  it("get_trip_context reflects the seeded trip", async () => {
    const { trip, token } = seedTrip();
    const client = await connectedClient(token);
    const result = await client.callTool({ name: "get_trip_context", arguments: {} });
    const context = JSON.parse(textOf(result));
    expect(context.trip.id).toBe(trip.id);
    expect(context.cities).toEqual(["Lisbon"]);
  });

  it("get_gaps surfaces the unbooked Lisbon nights", async () => {
    const { segment, token } = seedTrip();
    const client = await connectedClient(token);
    const result = await client.callTool({ name: "get_gaps", arguments: {} });
    const gaps = JSON.parse(textOf(result));
    expect(gaps.some((g: { kind: string; segment_id: string }) => g.kind === "unbooked_nights" && g.segment_id === segment.id)).toBe(true);
  });

  it("propose_item creates an idea-status item with an unresolved place, never a trusted cost", async () => {
    const { trip, token } = seedTrip();
    const client = await connectedClient(token);

    const result = await client.callTool({
      name: "propose_item",
      arguments: {
        type: "activity",
        title: "Kayaking on the Tagus",
        agent_name: "claude",
        place_ref: { name: "Some Kayak Outfitter" },
        cost: { amount: 45, currency: "EUR" },
      },
    });
    expect(textOf(result)).toContain("idea");

    const items = listItems(db, trip.id);
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.status).toBe("idea");
    expect(item.source).toEqual({ origin: "agent", url: null, agent_name: "claude" });
    expect(item.cost).toBeNull();
    expect(item.place_ref?.provider).toBe("unresolved");
    expect((item.raw as { agent_claimed_cost: unknown }).agent_claimed_cost).toEqual({
      amount: 45,
      currency: "EUR",
    });
  });

  it("search_trip_memory finds items by title", async () => {
    const { trip, token } = seedTrip();
    const client = await connectedClient(token);
    await client.callTool({
      name: "propose_item",
      arguments: { type: "meal", title: "Dinner at Cervejaria Ramiro" },
    });
    const result = await client.callTool({
      name: "search_trip_memory",
      arguments: { query: "ramiro" },
    });
    expect(textOf(result).toLowerCase()).toContain("ramiro");
    expect(listItems(db, trip.id)).toHaveLength(1);
  });

  it("exposes the trip context as a resource", async () => {
    const { trip, token } = seedTrip();
    const client = await connectedClient(token);
    const { resources } = await client.listResources();
    expect(resources.some((r) => r.uri === `trip://${trip.id}/context`)).toBe(true);

    const read = await client.readResource({ uri: `trip://${trip.id}/context` });
    const content = read.contents[0]!;
    if (!("text" in content)) throw new Error("expected text resource content");
    expect(JSON.parse(content.text).trip.id).toBe(trip.id);
  });

  it("rejects a token scoped to a different trip", async () => {
    seedTrip();
    const other = createTrip(db, {
      title: "Other Trip",
      travelers: { adults: 1, children_ages: [] },
      home_base: "IST",
      currency: "EUR",
      budget_total: null,
    });
    const otherToken = mintTripToken(db, other.id).token;

    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer wrong-${otherToken}` } },
    });
    const client = new Client({ name: "test-client", version: "0.0.1" });
    await expect(client.connect(transport)).rejects.toThrow();
  });
});
