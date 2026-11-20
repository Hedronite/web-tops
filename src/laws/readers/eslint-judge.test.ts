import { describe, expect, it } from "vitest";
import type { Levels } from "../../census/config.ts";
import type { LawEntry } from "./types.ts";
import { isTypeScript, matches, readLaw, type Evidence } from "./eslint-judge.ts";

const ANY = "@typescript-eslint/no-explicit-any";
const CAST = "@typescript-eslint/consistent-type-assertions";

const law = (...names: string[]): LawEntry => ({
  id: "W-01",
  severity: "R",
  reader: "tl",
  classes: [],
  judged: true,
  rules: names.map((name) => ({ tool: "eslint", name })),
});

/** Levels for files: each file's rules, by id. */
function levels(table: Record<string, Record<string, number>>): Levels {
  return new Map(
    Object.entries(table).map(([file, rules]) => [file, new Map(Object.entries(rules))]),
  );
}

const CONFIG = [
  {
    file: "eslint.config.js",
    text: [
      "export default [",
      '  { rules: { "@typescript-eslint/no-explicit-any": "error" } },',
      "];",
    ].join("\n"),
  },
];

function evidence(
  table: Record<string, Record<string, number>>,
  extra: Partial<Evidence> = {},
): Evidence {
  return {
    levels: levels(table),
    counts: new Map(),
    config: CONFIG,
    configFile: "eslint.config.js",
    held: false,
    ...extra,
  };
}

describe("G4a the ESLint reader judges a law by each file's effective config", () => {
  it("passes a law whose rules are at error for every TypeScript file, with no finding", () => {
    const table = { "src/a.ts": { [ANY]: 2 }, "src/b.tsx": { [ANY]: 2 } };
    expect(readLaw(evidence(table), law("no-explicit-any"))).toEqual({
      law: "W-01",
      verdict: "pass",
      findings: [],
    });
  });

  it("reads a rule by its short name or its prefixed id", () => {
    const table = { "src/a.ts": { [ANY]: 2 } };
    expect(readLaw(evidence(table), law(ANY)).verdict).toBe("pass");
    expect(readLaw(evidence(table), law("no-explicit-any")).verdict).toBe("pass");
    expect(matches("a/b-c", "b-c")).toBe(true);
    expect(matches("a/xb-c", "b-c")).toBe(false);
  });

  it("sees a per-directory override: one directory's files have the rule off, the rest at error", () => {
    const table = {
      "src/a.ts": { [ANY]: 2 },
      "scripts/run.ts": { [ANY]: 0 },
      "scripts/two.ts": { [ANY]: 0 },
    };
    const config = [
      {
        file: "eslint.config.js",
        text: [
          "export default [",
          '  { rules: { "@typescript-eslint/no-explicit-any": "error" } },',
          '  { files: ["scripts/**"], rules: { "@typescript-eslint/no-explicit-any": "off" } },',
          "];",
        ].join("\n"),
      },
    ];
    const reading = readLaw(evidence(table, { config }), law("no-explicit-any"));
    expect(reading.verdict).toBe("refuse");
    expect(reading.findings).toEqual([
      {
        tool: "eslint",
        rule: ANY,
        law: "W-01",
        verdict: "refuse",
        message: `${ANY} is below error for 2 file(s), such as scripts/run.ts`,
        file: "eslint.config.js",
        line: 3,
      },
    ]);
  });

  it("a rule at warn is below error: refuse, at its line", () => {
    const table = { "src/a.ts": { [CAST]: 1 } };
    const config = [{ file: "eslint.config.js", text: `x\n  "${CAST}": ["warn", { a: 1 }],\n` }];
    const reading = readLaw(evidence(table, { config }), law("consistent-type-assertions"));
    expect(reading.verdict).toBe("refuse");
    expect(reading.findings.map((found) => [found.file, found.line])).toEqual([
      ["eslint.config.js", 2],
    ]);
  });

  it("names each config line that lowers the rule", () => {
    const table = { "a/x.ts": { [ANY]: 0 }, "b/y.ts": { [ANY]: 1 } };
    const config = [
      {
        file: "eslint.config.js",
        text: `{ files: ["a/**"], rules: { "${ANY}": "off" } },\n{ files: ["b/**"], rules: { "${ANY}": "warn" } },`,
      },
    ];
    const reading = readLaw(evidence(table, { config }), law("no-explicit-any"));
    expect(reading.findings.map((found) => found.line)).toEqual([1, 2]);
  });

  it("when no line in the config lowers it, the refusal is at the top of the config file, not unplaced", () => {
    const table = { "src/a.ts": { [ANY]: 0 } };
    const reading = readLaw(evidence(table, { config: [] }), law("no-explicit-any"));
    expect(reading.findings.map((found) => [found.file, found.line])).toEqual([
      ["eslint.config.js", 1],
    ]);
  });

  it("a rule no TypeScript file has at all is not enabled: refuse at the config, never not-evaluated", () => {
    const table = { "src/a.ts": { other: 2 } };
    const reading = readLaw(evidence(table), law("no-explicit-any"));
    expect(reading.verdict).toBe("refuse");
    expect(reading.findings[0]?.message).toBe(
      "no-explicit-any is not enabled for any TypeScript file",
    );
  });

  it("a rule on for the files it is scoped to is fine: the others do not set it", () => {
    const table = { "src/a.test.ts": { "vitest/no-focused-tests": 2 }, "src/a.ts": { other: 2 } };
    expect(readLaw(evidence(table), law("no-focused-tests")).verdict).toBe("pass");
  });

  it("a rule off for JavaScript files by design (type checking disabled) is not a lapse", () => {
    const table = { "src/a.ts": { [ANY]: 2 }, "eslint.config.js": { [ANY]: 0 } };
    expect(readLaw(evidence(table), law("no-explicit-any")).verdict).toBe("pass");
    expect(isTypeScript("a.mts") && isTypeScript("a.cts") && isTypeScript("a.TSX")).toBe(true);
    expect(isTypeScript("a.js") || isTypeScript("a.astro")).toBe(false);
  });

  it("with no TypeScript file linted, no rule can be judged: not-evaluated, with the reason", () => {
    const reading = readLaw(evidence({ "a.js": { [ANY]: 2 } }), law("no-explicit-any"));
    expect(reading).toEqual({
      law: "W-01",
      verdict: "not-evaluated",
      reason: "no TypeScript file was linted",
      findings: [],
    });
  });

  it("a finding of gate 1 on one of its rules refuses the law, and the note counts them by rule", () => {
    const table = { "src/a.ts": { [ANY]: 2 } };
    const counts = new Map([
      [ANY, 2],
      ["other/rule", 5],
    ]);
    const reading = readLaw(evidence(table, { counts }), law("no-explicit-any"));
    expect(reading).toEqual({
      law: "W-01",
      verdict: "refuse",
      findings: [],
      note: "no-explicit-any 2",
    });
  });

  it("under a held ratchet those findings do not refuse the law: the note says the baseline holds them", () => {
    const table = { "src/a.ts": { [ANY]: 2 } };
    const reading = readLaw(
      evidence(table, { counts: new Map([[ANY, 2]]), held: true }),
      law("no-explicit-any"),
    );
    expect(reading).toEqual({
      law: "W-01",
      verdict: "pass",
      findings: [],
      note: "no-explicit-any 2 held by the baseline",
    });
  });

  it("a held ratchet never holds a rule that is turned off: that is a refusal whatever the baseline says", () => {
    const table = { "src/a.ts": { [ANY]: 0 } };
    expect(readLaw(evidence(table, { held: true }), law("no-explicit-any")).verdict).toBe("refuse");
  });

  it("reads only the rules of the eslint tool, and the unused-directive option as a rule", () => {
    const entry: LawEntry = {
      ...law("no-explicit-any"),
      rules: [
        { tool: "eslint", name: "no-explicit-any" },
        { tool: "tsc", name: "noImplicitAny" },
        { tool: "eslint", name: "reportUnusedDisableDirectives" },
      ],
    };
    const table = { "src/a.ts": { [ANY]: 2, reportUnusedDisableDirectives: 1 } };
    const reading = readLaw(evidence(table), entry);
    expect(reading.verdict).toBe("refuse");
    expect(reading.findings.map((found) => found.rule)).toEqual(["reportUnusedDisableDirectives"]);
  });
});

describe("G4a the ESLint reader: the edges", () => {
  it("a rule that two ids match takes the higher level: one at error is enough", () => {
    const table = { "src/a.ts": { "p/no-x": 0, "q/no-x": 2 } };
    expect(readLaw(evidence(table), law("no-x")).verdict).toBe("pass");
  });

  it("says each rule and its count, comma and space apart, for findings and for held findings", () => {
    const table = { "src/a.ts": { "p/a": 2, "p/b": 2 } };
    const counts = new Map([
      ["p/a", 2],
      ["p/b", 1],
    ]);
    expect(readLaw(evidence(table, { counts }), law("a", "b")).note).toBe("a 2, b 1");
    expect(readLaw(evidence(table, { counts, held: true }), law("a", "b")).note).toBe(
      "a 2, b 1 held by the baseline",
    );
  });
});
