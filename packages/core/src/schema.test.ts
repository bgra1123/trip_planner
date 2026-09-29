import { describe, expect, it } from "vitest";
import {
  ItemSchema,
  ProposeItemInputSchema,
  SegmentSchema,
  TripSchema,
} from "./schema.js";
import { fixtureItems, fixtureSegments, fixtureTrip } from "./fixtures/tripFixture.js";

describe("schema", () => {
  it("parses the fixture trip, segments, and items", () => {
    expect(() => TripSchema.parse(fixtureTrip)).not.toThrow();
    for (const seg of fixtureSegments) expect(() => SegmentSchema.parse(seg)).not.toThrow();
    for (const item of fixtureItems) expect(() => ItemSchema.parse(item)).not.toThrow();
  });

  it("rejects an item missing required fields", () => {
    expect(() => ItemSchema.parse({ id: "x" })).toThrow();
  });

  it("ProposeItemInputSchema accepts a bare title+type and drops server-controlled fields", () => {
    const parsed = ProposeItemInputSchema.parse({
      type: "activity",
      title: "Kayaking on the Douro",
    });
    expect(parsed).toEqual({ type: "activity", title: "Kayaking on the Douro" });
    expect("status" in parsed).toBe(false);
    expect("source" in parsed).toBe(false);
  });
});
