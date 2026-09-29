import { describe, expect, it } from "vitest";
import { deriveBudget } from "./budget.js";
import { fixtureItems, fixtureTrip } from "./fixtures/tripFixture.js";

describe("deriveBudget", () => {
  it("sums booked costs as committed and shortlisted costs as tentative", () => {
    const budget = deriveBudget(fixtureTrip, fixtureItems);
    // booked: 450 (Lisbon) + 180 (Porto) + 500 (Madrid) + 40 (train) = 1170
    expect(budget.committed).toBe(1170);
    // shortlisted: 60 (Belem tour)
    expect(budget.tentative).toBe(60);
    expect(budget.total).toBe(3000);
    expect(budget.remaining).toBe(3000 - 1170 - 60);
  });

  it("excludes rejected items and ignores idea-status items entirely", () => {
    const budget = deriveBudget(fixtureTrip, fixtureItems);
    // The rejected 900 Madrid suite and the 150 idea-status old quote must not appear.
    expect(budget.committed).not.toBe(1170 + 900);
    expect(budget.tentative).not.toBe(60 + 150);
  });

  it("returns a null remaining when the trip has no budget_total", () => {
    const budget = deriveBudget({ budget_total: null }, fixtureItems);
    expect(budget.remaining).toBeNull();
  });

  it("treats items with no cost as contributing zero", () => {
    const budget = deriveBudget(
      { budget_total: 100 },
      [
        {
          id: "i1",
          trip_id: "t1",
          segment_id: null,
          type: "note",
          status: "booked",
          title: "free thing",
          place_ref: null,
          starts_at: null,
          ends_at: null,
          cost: null,
          source: { origin: "manual", url: null, agent_name: null },
          captured_at: "2026-01-01T00:00:00Z",
          expires_at: null,
          cancellable_until: null,
          raw: null,
        },
      ],
    );
    expect(budget.committed).toBe(0);
    expect(budget.remaining).toBe(100);
  });
});
