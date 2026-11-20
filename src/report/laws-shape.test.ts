import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateReport } from "../config/report.ts";
import { edit, get } from "../config/test-support.ts";
import { formatText } from "./text.ts";

/** G4d: the report says how many of the class's required laws were judged, and a reader can recount it. */

const root = resolve(import.meta.dirname, "../..");

function fixture(name: string): unknown {
  const value: unknown = JSON.parse(readFileSync(resolve(root, "fixtures/report", name), "utf8"));
  return value;
}

function pointers(report: unknown): string[] {
  const result = validateReport(report);
  return result.ok ? [] : result.problems.map((problem) => problem.pointer);
}

describe("G4d the report's laws block is N of M for the class, recounted from the laws layer's findings", () => {
  it("shape/laws.json is valid: 2 of 3 required laws judged, one refused, one not evaluated", () => {
    const report = fixture("shape/laws.json");
    expect(pointers(report)).toEqual([]);
    expect(get(report, "laws")).toEqual({
      class: "ts-library",
      of: 3,
      judged: 2,
      refused: 1,
      not_evaluated: 1,
    });
  });

  it("a count that the findings do not give is a problem at /laws, whichever number is wrong", () => {
    const report = fixture("shape/laws.json");
    for (const key of ["of", "judged", "refused", "not_evaluated"]) {
      expect(pointers(edit(report, ["laws", key], 0))).toEqual(["/laws"]);
    }
    expect(pointers(edit(report, ["laws", "class"], "web-app"))).toEqual(["/laws"]);
  });

  it("the block has exactly its five fields, all integers from zero", () => {
    const report = fixture("shape/laws.json");
    expect(pointers(edit(report, ["laws", "extra"], 1))).not.toEqual([]);
    expect(pointers(edit(report, ["laws", "of"], -1))).not.toEqual([]);
    expect(pointers(edit(report, ["laws", "judged"], 1.5))).not.toEqual([]);
  });

  it("a report with no laws block is still valid: the block is present when the laws layer ran", () => {
    expect(pointers(fixture("pass.json"))).toEqual([]);
    expect(get(fixture("pass.json"), "laws")).toBeUndefined();
  });

  it("the text report says N of M judged, with the class, beside the layer totals", () => {
    const result = validateReport(fixture("shape/laws.json"));
    if (!result.ok) {
      throw new Error("the fixture is not valid");
    }
    expect(formatText(result.value)).toContain("laws: 2 of 3 judged (ts-library)\nlayers: ");
    const plain = validateReport(fixture("pass.json"));
    expect(plain.ok && formatText(plain.value)).not.toContain("laws: ");
  });
});
