import { describe, expect, it } from "vitest";
import { coverageLayer } from "./index.ts";

/** The coverage layer runs for every class: gate 3 holds the same floor for each (WEB_TOPS.md section 3.3). */
describe("the classes the coverage layer runs for", () => {
  it("are all five, in the order the profile lists them", () => {
    expect(coverageLayer.classes).toEqual([
      "ts-library",
      "ui-components",
      "astro-site",
      "web-app",
      "node-service",
    ]);
  });
});
