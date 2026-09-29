import { describe, expect, it } from "vitest";
import { buildAgentContext } from "./agentContext.js";
import {
  fixtureItems,
  fixturePreferences,
  fixtureSegments,
  fixtureTrip,
  FIXTURE_NOW,
} from "./fixtures/tripFixture.js";

describe("buildAgentContext", () => {
  const context = buildAgentContext(
    fixtureTrip,
    fixtureSegments,
    fixtureItems,
    fixturePreferences,
    FIXTURE_NOW,
  );

  it("summarizes trip-level fields", () => {
    expect(context.trip).toMatchObject({
      id: "trip-fixture",
      title: "9-Night Iberia Trip",
      dates: { start: "2026-11-01", end: "2026-11-10" },
      travelers: "2 adult(s), 1 child(ren)",
      home_base: "IST",
      currency: "EUR",
    });
  });

  it("lists cities in segment order", () => {
    expect(context.cities).toEqual(["Lisbon", "Porto", "Madrid"]);
  });

  it("computes budget with currency attached", () => {
    expect(context.budget).toMatchObject({
      total: 3000,
      committed: 1170,
      tentative: 60,
      remaining: 1770,
      currency: "EUR",
    });
  });

  it("lists every booked item as one line, in order", () => {
    expect(context.booked).toEqual([
      "accommodation: Alfama Boutique Hotel (2026-11-01) — 450 EUR",
      "accommodation: Ribeira Riverside Guesthouse (2026-11-04) — 180 EUR",
      "accommodation: Sol Central Apartments (2026-11-07) — 500 EUR",
      "transport: Train Lisbon -> Porto (2026-11-04) — 40 EUR",
    ]);
  });

  it("includes the unbooked-nights and missing-transport gaps", () => {
    expect(context.gaps.some((g) => g.includes("Porto without a booked stay"))).toBe(true);
    expect(context.gaps.some((g) => g.includes("Porto to Madrid"))).toBe(true);
  });

  it("carries preferences through verbatim", () => {
    expect(context.preferences).toEqual(["no early flights", "vegetarian-friendly restaurants"]);
  });

  it("excludes the expired offer and the rejected item from every field", () => {
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain("old quote");
    expect(serialized).not.toContain("Overpriced");
  });

  it("has no raw field on the output shape", () => {
    expect(context).not.toHaveProperty("raw");
  });
});
