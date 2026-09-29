import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@trip-memory/store/testing";
import type { Db } from "@trip-memory/store";
import { buildApp } from "./app.js";
import type { FastifyInstance } from "fastify";

let db: Db;
let app: FastifyInstance;

beforeEach(() => {
  db = createTestDb();
  app = buildApp(db);
});

async function createTripWithToken() {
  const res = await app.inject({
    method: "POST",
    url: "/trips",
    payload: {
      title: "Iberia Trip",
      travelers: { adults: 2, children_ages: [] },
      home_base: "IST",
      currency: "EUR",
      budget_total: 1000,
    },
  });
  const body = res.json();
  return { trip: body.trip, token: body.token as string };
}

function authed(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("POST /trips", () => {
  it("creates a trip and returns an initial scoped token", async () => {
    const { trip, token } = await createTripWithToken();
    expect(trip.id).toMatch(/^trip_/);
    expect(token).toMatch(/^tmk_/);
  });

  it("rejects an invalid body", async () => {
    const res = await app.inject({ method: "POST", url: "/trips", payload: { title: "x" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("trip-scoped auth", () => {
  it("rejects GET /trips/:id with no token", async () => {
    const { trip } = await createTripWithToken();
    const res = await app.inject({ method: "GET", url: `/trips/${trip.id}` });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a token that belongs to a different trip", async () => {
    const { trip: tripA } = await createTripWithToken();
    const { token: tokenB } = await createTripWithToken();
    const res = await app.inject({
      method: "GET",
      url: `/trips/${tripA.id}`,
      headers: authed(tokenB),
    });
    expect(res.statusCode).toBe(403);
  });

  it("accepts the trip's own token", async () => {
    const { trip, token } = await createTripWithToken();
    const res = await app.inject({
      method: "GET",
      url: `/trips/${trip.id}`,
      headers: authed(token),
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("segments and items round trip", () => {
  it("creates segments and items, then reflects them in GET /trips/:id, /context, and /gaps", async () => {
    const { trip, token } = await createTripWithToken();
    const headers = authed(token);

    const segLisbon = (
      await app.inject({
        method: "POST",
        url: `/trips/${trip.id}/segments`,
        headers,
        payload: {
          kind: "stay",
          city: "Lisbon",
          start_date: "2026-11-01",
          end_date: "2026-11-04",
          order: 0,
        },
      })
    ).json();

    await app.inject({
      method: "POST",
      url: `/trips/${trip.id}/segments`,
      headers,
      payload: {
        kind: "transit",
        city: null,
        start_date: "2026-11-04",
        end_date: "2026-11-04",
        order: 1,
      },
    });

    const segPorto = (
      await app.inject({
        method: "POST",
        url: `/trips/${trip.id}/segments`,
        headers,
        payload: {
          kind: "stay",
          city: "Porto",
          start_date: "2026-11-04",
          end_date: "2026-11-07",
          order: 2,
        },
      })
    ).json();

    // Fully booked Lisbon stay, so no unbooked_nights gap there.
    await app.inject({
      method: "POST",
      url: `/trips/${trip.id}/items`,
      headers,
      payload: {
        segment_id: segLisbon.id,
        type: "accommodation",
        status: "booked",
        title: "Alfama Hotel",
        starts_at: "2026-11-01T15:00:00Z",
        ends_at: "2026-11-04T11:00:00Z",
        cost: { amount: 300, currency: "EUR" },
        source: { origin: "manual", url: null, agent_name: null },
      },
    });

    // Porto has no accommodation booked at all: unbooked_nights gap, and no
    // transport between Lisbon and Porto: missing_transport gap.
    const listRes = await app.inject({ method: "GET", url: `/trips/${trip.id}`, headers });
    const listBody = listRes.json();
    expect(
      listBody.segments
        .filter((s: { kind: string }) => s.kind === "stay")
        .map((s: { city: string }) => s.city),
    ).toEqual(["Lisbon", "Porto"]);
    expect(listBody.items).toHaveLength(1);

    const gapsRes = await app.inject({ method: "GET", url: `/trips/${trip.id}/gaps`, headers });
    const gaps = gapsRes.json();
    expect(gaps.some((g: { kind: string }) => g.kind === "missing_transport")).toBe(true);
    expect(
      gaps.some((g: { kind: string; segment_id: string }) => g.kind === "unbooked_nights" && g.segment_id === segPorto.id),
    ).toBe(true);

    const contextRes = await app.inject({ method: "GET", url: `/trips/${trip.id}/context`, headers });
    const context = contextRes.json();
    expect(context.cities).toEqual(["Lisbon", "Porto"]);
    expect(context.budget).toMatchObject({ total: 1000, committed: 300, tentative: 0 });
    expect(context.booked).toEqual(["accommodation: Alfama Hotel (2026-11-01) — 300 EUR"]);
    expect(context.gaps.length).toBeGreaterThan(0);
  });

  it("updates and deletes an item", async () => {
    const { trip, token } = await createTripWithToken();
    const headers = authed(token);

    const item = (
      await app.inject({
        method: "POST",
        url: `/trips/${trip.id}/items`,
        headers,
        payload: {
          segment_id: null,
          type: "activity",
          status: "idea",
          title: "Sintra day trip",
          source: { origin: "manual", url: null, agent_name: null },
        },
      })
    ).json();

    const patched = (
      await app.inject({
        method: "PATCH",
        url: `/items/${item.id}`,
        headers,
        payload: { status: "shortlisted" },
      })
    ).json();
    expect(patched.status).toBe("shortlisted");

    const del = await app.inject({ method: "DELETE", url: `/items/${item.id}`, headers });
    expect(del.statusCode).toBe(204);

    const listRes = await app.inject({ method: "GET", url: `/trips/${trip.id}`, headers });
    expect(listRes.json().items).toHaveLength(0);
  });
});

describe("POST /trips/:id/tokens", () => {
  it("mints an additional token scoped to the same trip", async () => {
    const { trip, token } = await createTripWithToken();
    const res = await app.inject({
      method: "POST",
      url: `/trips/${trip.id}/tokens`,
      headers: authed(token),
      payload: { label: "claude-desktop" },
    });
    expect(res.statusCode).toBe(201);
    const minted = res.json();
    expect(minted.trip_id).toBe(trip.id);
    expect(minted.label).toBe("claude-desktop");
  });
});
