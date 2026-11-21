import { describe, expect, it } from "vitest";
import type { Project } from "../laws/readers/tsc-judge.ts";
import { flagsOf } from "./flags.ts";

const project = (config: string, options: Record<string, unknown>): Project => ({
  config,
  options,
  spots: new Map(),
  section: { file: config, line: 1 },
  files: 1,
  program: new Set(),
});

const shown = (map: ReadonlyMap<string, { shown: string }>, key: string): string | undefined =>
  map.get(key)?.shown;

describe("the compiler flags of every checked project", () => {
  it("reads a flag as the compiler does: its own value, else strict's for a member of the strict family", () => {
    const flags = flagsOf([
      project("tsconfig.json", {
        strict: true,
        noImplicitAny: false,
        noUncheckedIndexedAccess: true,
      }),
    ]);
    expect(shown(flags, "tsconfig.json: noImplicitAny")).toBe("false");
    expect(shown(flags, "tsconfig.json: strictNullChecks")).toBe("true");
    expect(shown(flags, "tsconfig.json: alwaysStrict")).toBe("true");
    expect(shown(flags, "tsconfig.json: strictBuiltinIteratorReturn")).toBe("true");
    expect(shown(flags, "tsconfig.json: noUncheckedIndexedAccess")).toBe("true");
  });

  it("does not give a flag outside the family what strict says, and names one nobody set as unset", () => {
    const flags = flagsOf([project("tsconfig.json", { strict: true })]);
    expect(shown(flags, "tsconfig.json: noUncheckedIndexedAccess")).toBe("unset");
    expect(shown(flags, "tsconfig.json: strict")).toBe("true");
    expect(flags.get("tsconfig.json: strict")?.rank).toBe(1);
    expect(flags.get("tsconfig.json: noUncheckedIndexedAccess")?.rank).toBe(0);
    expect(flags.get("tsconfig.json: strictNullChecks")?.rank).toBe(1);
  });

  it("holds exactly these seventeen flags, the strict family from the second to the tenth", () => {
    const names = [...flagsOf([project("t.json", {})]).keys()].map((key) => key.slice(8));
    expect(names).toEqual([
      "strict",
      "noImplicitAny",
      "strictNullChecks",
      "strictFunctionTypes",
      "strictBindCallApply",
      "strictPropertyInitialization",
      "noImplicitThis",
      "useUnknownInCatchVariables",
      "alwaysStrict",
      "strictBuiltinIteratorReturn",
      "noUncheckedIndexedAccess",
      "exactOptionalPropertyTypes",
      "noImplicitOverride",
      "noFallthroughCasesInSwitch",
      "verbatimModuleSyntax",
      "isolatedModules",
      "erasableSyntaxOnly",
    ]);
    const family = flagsOf([project("t.json", { strict: true })]);
    const on = [...family].filter(([, value]) => value.rank === 1).map(([key]) => key.slice(8));
    expect(on).toEqual(names.slice(0, 10));
  });

  it("lists the seventeen flags of every project by the project's own config", () => {
    const flags = flagsOf([project("tsconfig.json", {}), project("packages/a/tsconfig.json", {})]);
    expect(flags.size).toBe(34);
    expect([...flags.keys()][17]).toBe("packages/a/tsconfig.json: strict");
    expect(shown(flags, "tsconfig.json: strict")).toBe("unset");
  });
});
