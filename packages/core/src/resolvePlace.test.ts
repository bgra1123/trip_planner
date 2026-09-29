import { describe, expect, it } from "vitest";
import { resolvePlace } from "./resolvePlace.js";

describe("resolvePlace (stub)", () => {
  it("always returns unresolved, carrying through the given name and address", () => {
    const ref = resolvePlace({ name: "Hallucinated Cafe", address: "123 Nowhere St" });
    expect(ref).toEqual({
      provider: "unresolved",
      provider_id: null,
      name: "Hallucinated Cafe",
      address: "123 Nowhere St",
      lat: null,
      lng: null,
      resolved_at: null,
    });
  });
});
