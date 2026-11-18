import { describe, expect, it } from "vitest";
import { analyzeFile } from "./analyze.ts";
import { ts } from "./test-support.ts";

/** G4c: a function assigned with an operator other than `=` has no name to take. */

function keys(source: string): string[] {
  return analyzeFile(ts, "src/a.ts", source).records.map((record) => record.key);
}

describe("G4c assignedName", () => {
  it("names a function assigned to an identifier or a property, and leaves one assigned with += anonymous", () => {
    expect(keys("let f; f = () => 1;\n")).toContain("src/a.ts::f");
    expect(keys("const o: { g?: () => number } = {}; o.g = () => 1;\n")).toContain("src/a.ts::g");
    const compound = keys("let h = 0 as unknown; h += () => 1;\n");
    expect(compound).not.toContain("src/a.ts::h");
    expect(compound.some((key) => key.includes("~"))).toBe(true);
  });

  it("leaves a function assigned to an element access anonymous", () => {
    const found = keys("const o: Record<string, () => number> = {}; o['k'] = () => 1;\n");
    expect(found.some((key) => key.includes("~"))).toBe(true);
  });
});
