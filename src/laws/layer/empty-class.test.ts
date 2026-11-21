import { describe, expect, it } from "vitest";
import type { LawEntry } from "../readers/types.ts";
import { forClass } from "./entries.ts";
import { readingsOf } from "./judge.ts";

/** A law none of whose rules holds for the class has nothing to read: it is never a pass. */

const ONLY_ASTRO: LawEntry = {
  id: "W-28",
  severity: "R",
  reader: "tl",
  classes: ["astro-site", "ui-components"],
  judged: true,
  rules: [{ tool: "eslint", name: "webtops/astro-client-load-ack", classes: ["astro-site"] }],
};

describe("a law with no rule for the class", () => {
  it("has no rules once read for the class", () => {
    expect(forClass(ONLY_ASTRO, "ui-components").rules).toEqual([]);
  });

  it("is not-evaluated, with its reason, and not a pass", () => {
    const read = forClass(ONLY_ASTRO, "ui-components");
    const readings = readingsOf(read, [], new Set());
    expect(readings.map((reading) => [reading.law, reading.verdict])).toEqual([
      ["W-28", "not-evaluated"],
    ]);
    expect(readings[0]?.reason).toBe("W-28 has no reader yet");
  });
});
