import { describe, expect, it } from "vitest";
import { isRequired, lawsOfClass, toolsOf } from "./entries.ts";
import type { LawEntry } from "../../laws/readers/types.ts";

const law = (id: string, extra: Partial<LawEntry> = {}): LawEntry => ({
  id,
  severity: "R",
  reader: "tl",
  classes: [],
  judged: true,
  rules: [],
  ...extra,
});

describe("G4d which laws a class maps, and which it requires", () => {
  it("a law with no class list is mapped by every class, and one with a list only by those classes", () => {
    const laws = [law("W-01"), law("W-18", { classes: ["ts-library", "ui-components"] })];
    expect(lawsOfClass(laws, "ts-library").map((found) => found.id)).toEqual(["W-01", "W-18"]);
    expect(lawsOfClass(laws, "node-service").map((found) => found.id)).toEqual(["W-01"]);
  });

  it("a law is required when it is judged and the class maps it", () => {
    expect(isRequired(law("W-01"), "node-service")).toBe(true);
    expect(isRequired(law("W-03", { judged: false }), "node-service")).toBe(false);
    expect(isRequired(law("W-18", { classes: ["ts-library"] }), "node-service")).toBe(false);
    expect(isRequired(law("W-18", { classes: ["ts-library"] }), "ts-library")).toBe(true);
  });

  it("names the tools a law maps rules of, once each", () => {
    const rules = [
      { tool: "eslint", name: "a" },
      { tool: "tsc", name: "b" },
      { tool: "eslint", name: "c" },
    ];
    expect(toolsOf(law("W-13", { rules }))).toEqual(["eslint", "tsc"]);
    expect(toolsOf(law("W-40"))).toEqual([]);
  });
});
