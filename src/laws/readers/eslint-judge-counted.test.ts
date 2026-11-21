import { describe, expect, it } from "vitest";
import type { Levels } from "../../census/config.ts";
import type { LawEntry } from "./types.ts";
import { readLaw, type Evidence } from "./eslint-judge.ts";

/**
 * A rule lowered for some files is a refusal at a config line, and the errors gate 1's ESLint run found on the same
 * rule are part of the law's refusal: they are said with no file, so no acknowledgement of the config line covers them.
 */

const ANY = "@typescript-eslint/no-explicit-any";
const AWAIT = "no-await-in-loop";

const law = (...names: string[]): LawEntry => ({
  id: "W-12",
  severity: "A",
  reader: "tl",
  classes: [],
  judged: true,
  rules: names.map((name) => ({ tool: "eslint", name })),
});

const levels = (table: Record<string, Record<string, number>>): Levels =>
  new Map(Object.entries(table).map(([file, rules]) => [file, new Map(Object.entries(rules))]));

const CONFIG = [
  {
    file: "eslint.config.js",
    text: [
      "export default [",
      `  { rules: { "${ANY}": "error", "${AWAIT}": "error" } },`,
      `  { files: ["src/legacy.ts"], rules: { "${ANY}": "off" } },`,
      "];",
    ].join("\n"),
  },
];

/** One file with the rule at error, one with it off by an override at line 3 of the config. */
const TABLE = {
  "src/a.ts": { [ANY]: 2, [AWAIT]: 2 },
  "src/legacy.ts": { [ANY]: 0, [AWAIT]: 2 },
};

const evidence = (counts: [string, number][], held = false): Evidence => ({
  levels: levels(TABLE),
  counts: new Map(counts),
  config: CONFIG,
  configFile: "eslint.config.js",
  held,
});

const placed = (reading: { readonly findings: readonly { readonly file?: string }[] }): number =>
  reading.findings.filter((found) => found.file !== undefined).length;

describe("a refusal at a config line keeps the findings of gate 1 on the same rule", () => {
  it("says them with no file, beside the config line, so an acknowledgement of the line leaves them open", () => {
    const reading = readLaw(evidence([[ANY, 2]]), law("no-explicit-any"));
    expect(reading.verdict).toBe("refuse");
    expect(reading.findings).toEqual([
      {
        tool: "eslint",
        rule: ANY,
        law: "W-12",
        verdict: "refuse",
        message: `${ANY} is below error for 1 file(s), such as src/legacy.ts`,
        file: "eslint.config.js",
        line: 3,
      },
      {
        tool: "eslint",
        rule: ANY,
        law: "W-12",
        verdict: "refuse",
        message: "2 finding(s) of no-explicit-any in gate 1's ESLint run, at no config line",
      },
    ]);
    expect(placed(reading)).toBe(1);
  });

  it("says one for each rule of the law that has findings, by the rule's effective id", () => {
    const counts: [string, number][] = [
      [ANY, 1],
      [AWAIT, 3],
      ["other/rule", 9],
    ];
    const reading = readLaw(evidence(counts), law("no-explicit-any", "no-await-in-loop"));
    expect(reading.findings.map((found) => [found.rule, found.file, found.message])).toEqual([
      [ANY, "eslint.config.js", `${ANY} is below error for 1 file(s), such as src/legacy.ts`],
      [ANY, undefined, "1 finding(s) of no-explicit-any in gate 1's ESLint run, at no config line"],
      [
        AWAIT,
        undefined,
        "3 finding(s) of no-await-in-loop in gate 1's ESLint run, at no config line",
      ],
    ]);
  });

  it("says none for a rule the law does not name, or when gate 1 found none on its rules", () => {
    expect(placed(readLaw(evidence([["other/rule", 4]]), law("no-explicit-any")))).toBe(1);
    const none = readLaw(evidence([["other/rule", 4]]), law("no-explicit-any"));
    expect(none.findings).toHaveLength(1);
    expect(readLaw(evidence([]), law("no-explicit-any")).findings).toHaveLength(1);
  });

  it("says none under a held ratchet: the baseline holds those findings, and the line stays a refusal", () => {
    const reading = readLaw(evidence([[ANY, 2]], true), law("no-explicit-any"));
    expect(reading.verdict).toBe("refuse");
    expect(reading.findings).toHaveLength(1);
    expect(reading.findings[0]?.file).toBe("eslint.config.js");
  });

  it("does not change a reading with no config line to refuse: the counted reading stands as it was", () => {
    const clean: Evidence = {
      levels: levels({ "src/a.ts": { [ANY]: 2 } }),
      counts: new Map([[ANY, 2]]),
      config: CONFIG,
      configFile: "eslint.config.js",
      held: false,
    };
    expect(readLaw(clean, law("no-explicit-any"))).toEqual({
      law: "W-12",
      verdict: "refuse",
      findings: [],
      note: "no-explicit-any 2",
    });
  });
});
