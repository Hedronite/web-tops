import { describe, expect, it } from "vitest";
import { mutationLayer } from "./index.ts";

/** The mutation layer's place in the gate (WEB_TOPS.md section 6.4): which gate, tier and classes, and what it reads. */

describe("the mutation layer's description", () => {
  it("is gate 5, tier 1, for the five classes that run tests, and reads the tests layer's Vitest wrapper", () => {
    expect(mutationLayer).toMatchObject({
      id: "mutation",
      gate: 5,
      tier: 1,
      classes: ["ts-library", "ui-components", "astro-site", "web-app", "node-service"],
      requires: ["tests"],
      produces: [],
      consumes: [{ artifact: "vitest-config", from: "tests" }],
    });
  });
});
