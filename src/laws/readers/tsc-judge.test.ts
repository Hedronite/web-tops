import { describe, expect, it } from "vitest";
import type { LawEntry } from "./types.ts";
import {
  strictFamily,
  effective,
  orphans,
  readLaw,
  type Facts,
  type Project,
} from "./tsc-judge.ts";

const KIT = {
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  noImplicitOverride: true,
  noFallthroughCasesInSwitch: true,
  verbatimModuleSyntax: true,
  isolatedModules: true,
  erasableSyntaxOnly: true,
};

const without = (options: Record<string, unknown>, flag: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(options).filter(([name]) => name !== flag));

function project(options: Record<string, unknown>, extra: Partial<Project> = {}): Project {
  return {
    config: "tsconfig.json",
    options,
    spots: new Map(
      Object.keys(options).map((flag, index) => [flag, { file: "tsconfig.json", line: index + 3 }]),
    ),
    section: { file: "tsconfig.json", line: 2 },
    files: 4,
    program: new Set(["src/a.ts"]),
    ...extra,
  };
}

const facts = (projects: Project[], extra: Partial<Facts> = {}): Facts => ({
  projects,
  source: ["src/a.ts"],
  diagnostics: new Map(),
  held: false,
  ...extra,
});

const law = (id: string, ...flags: string[]): LawEntry => ({
  id,
  severity: "R",
  reader: "an",
  classes: [],
  judged: true,
  rules: flags.map((name) => ({ tool: "tsc", name })),
});

const W04 = law(
  "W-04",
  "strict",
  "noUncheckedIndexedAccess",
  "exactOptionalPropertyTypes",
  "noImplicitOverride",
  "noFallthroughCasesInSwitch",
  "verbatimModuleSyntax",
  "isolatedModules",
  "erasableSyntaxOnly",
);

describe("G4b W-04 reads every flag's resolved value, not strict alone", () => {
  it("passes a project that sets strict and each listed flag, with every file in a project", () => {
    expect(readLaw(facts([project(KIT)]), W04)).toEqual({
      law: "W-04",
      verdict: "pass",
      findings: [],
    });
  });

  it("strict: true beside a member set to false is refuse, at the line that sets the member", () => {
    const reading = readLaw(facts([project({ ...KIT, strictNullChecks: false })]), W04);
    expect(reading.verdict).toBe("refuse");
    expect(reading.findings).toEqual([
      {
        tool: "tsc",
        rule: "compilerOptions",
        law: "W-04",
        verdict: "refuse",
        message: "strictNullChecks is false (tsconfig.json)",
        file: "tsconfig.json",
        line: 11,
      },
    ]);
  });

  it("fails on each member of the strict family set to false", () => {
    for (const member of strictFamily()) {
      const reading = readLaw(facts([project({ ...KIT, [member]: false })]), W04);
      expect(reading.findings.map((found) => found.message)).toEqual([
        `${member} is false (tsconfig.json)`,
      ]);
    }
  });

  it("a listed flag that is absent is refuse, placed at the top of compilerOptions", () => {
    const reading = readLaw(facts([project(without(KIT, "noImplicitOverride"))]), W04);
    expect(reading.verdict).toBe("refuse");
    expect(reading.findings.map((found) => [found.message, found.file, found.line])).toEqual([
      ["noImplicitOverride is not set (tsconfig.json)", "tsconfig.json", 2],
    ]);
  });

  it("a flag set to false is refuse for every listed flag", () => {
    for (const flag of Object.keys(KIT).filter((name) => name !== "strict")) {
      const reading = readLaw(facts([project({ ...KIT, [flag]: false })]), W04);
      expect(reading.findings.map((found) => found.message)).toEqual([
        `${flag} is false (tsconfig.json)`,
      ]);
    }
  });

  it("strict off or absent is one refusal, not one for every member it would have turned on", () => {
    const reading = readLaw(facts([project(without(KIT, "strict"))]), W04);
    expect(reading.findings.map((found) => found.message)).toEqual([
      "strict is not set (tsconfig.json)",
    ]);
    const off = readLaw(facts([project({ ...KIT, strict: false })]), W04);
    expect(off.findings.map((found) => found.message)).toEqual(["strict is false (tsconfig.json)"]);
  });

  it("every checked project is judged: a project that selects files and sets nothing refuses", () => {
    const loose = project({}, { config: "tsconfig.build.json" });
    const reading = readLaw(facts([project(KIT), loose]), W04);
    expect(reading.verdict).toBe("refuse");
    expect(reading.findings.every((found) => found.message.endsWith("(tsconfig.build.json)"))).toBe(
      true,
    );
  });

  it("a solution config that only references other projects sets no flag, and is not judged", () => {
    const solution = project({}, { config: "tsconfig.json", files: 0 });
    const reading = readLaw(facts([solution, project(KIT, { config: "tsconfig.app.json" })]), W04);
    expect(reading.verdict).toBe("pass");
  });

  it("with no project that selects a file, the compiler flags cannot be judged", () => {
    expect(readLaw(facts([project({}, { files: 0 })]), W04)).toMatchObject({
      verdict: "not-evaluated",
      reason: "no tsconfig project selects a file",
    });
  });
});

describe("G4b a flag law other than W-04 reads its own flags, through strict for a member of the family", () => {
  it("noImplicitAny is on when strict gives it, and off when the project sets it to false", () => {
    expect(effective(project({ strict: true }), "noImplicitAny")).toBe(true);
    expect(effective(project({ strict: true, noImplicitAny: false }), "noImplicitAny")).toBe(false);
    expect(effective(project({}), "noImplicitAny")).toBe(false);
    expect(effective(project({ strict: true }), "verbatimModuleSyntax")).toBe(false);
    expect(readLaw(facts([project({ strict: true })]), law("W-01", "noImplicitAny")).verdict).toBe(
      "pass",
    );
    expect(readLaw(facts([project({})]), law("W-01", "noImplicitAny")).verdict).toBe("refuse");
  });

  it("only the file-set check of the strict law applies to W-04: another flag law ignores orphans", () => {
    const loose = facts([project(KIT)], { source: ["src/a.ts", "scripts/x.ts"] });
    expect(readLaw(loose, law("W-05", "erasableSyntaxOnly")).verdict).toBe("pass");
  });

  it("ignores the rules of other tools", () => {
    const entry: LawEntry = {
      ...law("W-01", "noImplicitAny"),
      rules: [{ tool: "eslint", name: "no-explicit-any" }],
    };
    expect(readLaw(facts([project({})]), entry).verdict).toBe("pass");
  });
});

describe("G4b file-set completeness: a tracked source file in no checked project is refuse", () => {
  it("names the orphan with its file, under W-04", () => {
    const loose = facts([project(KIT)], { source: ["src/a.ts", "scripts/x.ts"] });
    const reading = readLaw(loose, W04);
    expect(reading.verdict).toBe("refuse");
    expect(reading.findings).toEqual([
      {
        tool: "tsc",
        rule: "file-set",
        law: "W-04",
        verdict: "refuse",
        message:
          "scripts/x.ts is in no tsconfig project the gate checks, so the compiler flags never apply to it",
        file: "scripts/x.ts",
      },
    ]);
  });

  it("a file in any checked project's program is held, and the data trees of section 17 are not orphans", () => {
    const two = [
      project(KIT),
      project(KIT, { config: "tsconfig.test.json", program: new Set(["test/b.ts"]) }),
    ];
    const all = facts(two, {
      source: ["src/a.ts", "test/b.ts", "fixtures/laws/x.ts", "probes/w22/y.tsx"],
    });
    expect(orphans(all)).toEqual([]);
  });

  it("only those two trees, at the top: a data-like directory elsewhere is an orphan", () => {
    const loose = facts([project(KIT)], {
      source: [
        "src/a.ts",
        "src/fixtures/x.ts",
        "examples/fixtures/y.ts",
        "fixtures-old/z.ts",
        "probes.ts",
      ],
    });
    expect(orphans(loose)).toEqual([
      "src/fixtures/x.ts",
      "examples/fixtures/y.ts",
      "fixtures-old/z.ts",
      "probes.ts",
    ]);
  });

  it("with an orphan and a flag both wrong, both are reported", () => {
    const loose = facts([project({ ...KIT, strictNullChecks: false })], { source: ["z.ts"] });
    expect(readLaw(loose, W04).findings).toHaveLength(2);
  });
});

describe("G4b a live flag with a failing diagnostic refuses the law", () => {
  const seen = (codes: Record<string, number>, held = false): Facts =>
    facts([project(KIT)], { diagnostics: new Map(Object.entries(codes)), held });

  it("TS7006 and TS7005 count for noImplicitAny, so W-01 is refuse with the codes noted", () => {
    const reading = readLaw(
      seen({ TS7006: 2, TS7005: 1, TS2322: 9 }),
      law("W-01", "noImplicitAny"),
    );
    expect(reading).toEqual({
      law: "W-01",
      verdict: "refuse",
      findings: [],
      note: "TS7005 1, TS7006 2",
    });
  });

  it("a flag with no diagnostic passes, and a diagnostic of another flag is not this law's", () => {
    expect(readLaw(seen({}), law("W-01", "noImplicitAny")).verdict).toBe("pass");
    expect(readLaw(seen({ TS1294: 1 }), law("W-01", "noImplicitAny")).verdict).toBe("pass");
    expect(readLaw(seen({ TS1294: 1 }), law("W-05", "erasableSyntaxOnly")).verdict).toBe("refuse");
  });

  it("strict is judged through every member of the family, so any member's code refuses W-04", () => {
    for (const code of ["TS7006", "TS2532", "TS2564", "TS2683", "TS18046"]) {
      expect(readLaw(seen({ [code]: 1 }), W04).verdict).toBe("refuse");
    }
  });

  it("the ratchet holds the count, a pass with the note, but never a flag that is off", () => {
    const held = readLaw(seen({ TS7006: 3 }, true), law("W-01", "noImplicitAny"));
    expect(held).toEqual({
      law: "W-01",
      verdict: "pass",
      findings: [],
      note: "TS7006 3 held by the baseline",
    });
    const off = facts([project({})], { diagnostics: new Map([["TS7006", 3]]), held: true });
    expect(readLaw(off, law("W-01", "noImplicitAny")).verdict).toBe("refuse");
  });
});

describe("G4b the strict family, named", () => {
  const family = [
    "noImplicitAny",
    "strictNullChecks",
    "strictFunctionTypes",
    "strictBindCallApply",
    "strictPropertyInitialization",
    "noImplicitThis",
    "useUnknownInCatchVariables",
    "alwaysStrict",
    "strictBuiltinIteratorReturn",
  ];

  it("is these nine members, and each one false beside strict: true is refused by name", () => {
    expect(strictFamily()).toEqual(family);
    for (const member of family) {
      const reading = readLaw(facts([project({ ...KIT, [member]: false })]), W04);
      expect(
        reading.findings.map((found) => found.message),
        member,
      ).toEqual([`${member} is false (tsconfig.json)`]);
    }
  });

  it("a member left unset because strict is off is at the line of strict, not at the top", () => {
    const off = project({ strict: false, noImplicitOverride: true });
    const reading = readLaw(facts([off]), law("W-01", "noImplicitAny"));
    expect(reading.findings.map((found) => [found.message, found.line])).toEqual([
      ["noImplicitAny is not set (tsconfig.json)", 3],
    ]);
  });

  it("a rule of another tool that is named like a flag is not a flag: its code is not counted", () => {
    const entry: LawEntry = { ...law("W-01"), rules: [{ tool: "eslint", name: "noImplicitAny" }] };
    const seen = facts([project(KIT)], { diagnostics: new Map([["TS7006", 4]]) });
    expect(readLaw(seen, entry)).toEqual({ law: "W-01", verdict: "pass", findings: [] });
  });

  it("notes the codes in name order, not the order the table has them", () => {
    const seen = facts([project(KIT)], {
      diagnostics: new Map([
        ["TS2532", 1],
        ["TS18047", 2],
      ]),
    });
    expect(readLaw(seen, law("W-01", "strictNullChecks")).note).toBe("TS18047 2, TS2532 1");
  });
});
