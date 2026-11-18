import { describe, expect, it } from "vitest";
import { anchorOf, completeFindings, countsByRuleFile, fingerprint } from "./findings.ts";
import type { RawFinding } from "./findings.ts";

/** G1b, G1c: the finding key survives edits elsewhere in the file, and the counts derive from findings alone. */

const FORMAT = /^fp1:[0-9a-f]{16}$/u;

const SOURCE = [
  "import { a } from './a';",
  "",
  "export function run(input: unknown): number {",
  "  const unused = 1;",
  "  return Number(input);",
  "}",
  "",
].join("\n");

function finding(over: Partial<RawFinding> = {}): RawFinding {
  return {
    tool: "eslint",
    rule: "no-unused-vars",
    verdict: "fail",
    message: "'unused' is assigned a value but never used",
    file: "src/run.ts",
    line: 4,
    ...over,
  };
}

function reading(files: Record<string, string>): (file: string) => string | undefined {
  return (file) => files[file];
}

function keyOf(raw: RawFinding, source: string, file = "src/run.ts"): string {
  const [done] = completeFindings([raw], reading({ [file]: source }));
  if (done === undefined) {
    throw new Error("no finding came back");
  }
  return done.fingerprint;
}

describe("G1c fingerprint: the same finding keeps its key through edits elsewhere in the file", () => {
  it("is fp1 and 16 hex characters, and the same twice", () => {
    const first = keyOf(finding(), SOURCE);
    expect(first).toMatch(FORMAT);
    expect(keyOf(finding(), SOURCE)).toBe(first);
  });

  it("survives lines added above, which move the line number", () => {
    const moved = `// a comment\n// and another\n${SOURCE}`;
    expect(keyOf(finding({ line: 6 }), moved)).toBe(keyOf(finding(), SOURCE));
  });

  it("survives lines removed above", () => {
    const shorter = SOURCE.split("\n").slice(2).join("\n");
    expect(keyOf(finding({ line: 2 }), shorter)).toBe(keyOf(finding(), SOURCE));
  });

  it("survives an edit to another line, below or above", () => {
    const edited = SOURCE.replace(
      "return Number(input);",
      "return Math.trunc(Number(input));",
    ).replace("import { a } from './a';", "import { a, b } from './a';");
    expect(keyOf(finding(), edited)).toBe(keyOf(finding(), SOURCE));
  });

  it("survives a change of indentation or of the spaces inside the flagged line", () => {
    const indented = SOURCE.replace("  const unused = 1;", "      const   unused  =  1;");
    expect(keyOf(finding(), indented)).toBe(keyOf(finding(), SOURCE));
  });

  it("changes when the flagged line itself changes: it is a different finding", () => {
    const changed = SOURCE.replace("const unused = 1;", "const unused = 2;");
    expect(keyOf(finding(), changed)).not.toBe(keyOf(finding(), SOURCE));
  });

  it.each([
    ["the rule", { rule: "no-undef" }],
    ["the tool", { tool: "tsc" as const }],
    ["the file", { file: "src/other.ts" }],
  ])("changes with %s", (_label, over) => {
    const other = finding(over);
    const files = { "src/run.ts": SOURCE, "src/other.ts": SOURCE };
    const [base] = completeFindings([finding()], reading(files));
    const [changed] = completeFindings([other], reading(files));
    expect(changed?.fingerprint).not.toBe(base?.fingerprint);
  });

  it("does not depend on the message, which a tool may reword", () => {
    expect(keyOf(finding({ message: "reworded by a new tool version" }), SOURCE)).toBe(
      keyOf(finding(), SOURCE),
    );
  });

  it("tells two identical lines in one file apart, and keeps that when a line is added above both", () => {
    const twice = "const x = 1;\nconst y = 2;\nconst x = 1;\n";
    const read = reading({ "src/run.ts": twice });
    const both = completeFindings([finding({ line: 1 }), finding({ line: 3 })], read);
    expect(both[0]?.fingerprint).not.toBe(both[1]?.fingerprint);
    const shifted = reading({ "src/run.ts": `// top\n${twice}` });
    const after = completeFindings([finding({ line: 2 }), finding({ line: 4 })], shifted);
    expect(after.map((item) => item.fingerprint)).toEqual(both.map((item) => item.fingerprint));
  });

  it("numbers repeats by line, whatever order the tool listed them in", () => {
    const twice = "const x = 1;\nconst y = 2;\nconst x = 1;\n";
    const read = reading({ "src/run.ts": twice });
    const forward = completeFindings([finding({ line: 1 }), finding({ line: 3 })], read);
    const backward = completeFindings([finding({ line: 3 }), finding({ line: 1 })], read);
    expect(backward.map((item) => item.fingerprint)).toEqual(
      [...forward.map((item) => item.fingerprint)].reverse(),
    );
  });

  it("anchors a finding with no place on its message", () => {
    const noPlace: RawFinding = {
      tool: "audit",
      rule: "GHSA-xxxx",
      verdict: "fail",
      message: "an advisory",
    };
    const [first] = completeFindings([noPlace], reading({}));
    expect(first?.fingerprint).toMatch(FORMAT);
    const [again] = completeFindings(
      [{ ...noPlace, message: "another advisory text" }],
      reading({}),
    );
    expect(again?.fingerprint).not.toBe(first?.fingerprint);
  });

  it("anchors a finding whose file cannot be read on its message too", () => {
    const [gone] = completeFindings([finding()], reading({}));
    const [reworded] = completeFindings([finding({ message: "another text" })], reading({}));
    expect(gone?.fingerprint).toMatch(FORMAT);
    expect(reworded?.fingerprint).not.toBe(gone?.fingerprint);
  });

  it("is a pure function of its parts, and a different hash for each part", () => {
    const parts = { tool: "eslint", rule: "r", file: "f.ts", anchor: "x", occurrence: 1 };
    expect(fingerprint(parts)).toBe(fingerprint({ ...parts }));
    for (const over of [
      { tool: "tsc" },
      { rule: "s" },
      { file: "g.ts" },
      { anchor: "y" },
      { occurrence: 2 },
    ]) {
      expect(fingerprint({ ...parts, ...over })).not.toBe(fingerprint(parts));
    }
    expect(fingerprint({ ...parts, file: null })).toMatch(FORMAT);
  });

  it("an anchor is the trimmed line with its whitespace collapsed", () => {
    expect(anchorOf("   const  a =\t1;  ")).toBe("const a = 1;");
    expect(anchorOf("")).toBe("");
  });
});

describe("G1a completeFindings gives every finding the one shape", () => {
  it("adds law, nulls where there is no place, and a fingerprint, and keeps the rest", () => {
    const [done] = completeFindings(
      [{ tool: "webtops", rule: "lcov-missing", verdict: "fail", message: "no lcov" }],
      reading({}),
    );
    expect(done).toMatchObject({
      tool: "webtops",
      rule: "lcov-missing",
      law: null,
      verdict: "fail",
      message: "no lcov",
      file: null,
      line: null,
    });
    expect(done?.fingerprint).toMatch(FORMAT);
  });

  it("keeps a place, a law, required and an ack when the layer gave them", () => {
    const ack = { source: "comment" as const, reason: "legacy" };
    const [done] = completeFindings(
      [finding({ law: "W-05", required: true, verdict: "pass", ack })],
      reading({ "src/run.ts": SOURCE }),
    );
    expect(done).toMatchObject({ law: "W-05", required: true, ack, file: "src/run.ts", line: 4 });
  });

  it("returns one finding for each it was given, in order", () => {
    const raw = [finding({ line: 5 }), finding({ rule: "other", line: 1 }), finding({ line: 4 })];
    const done = completeFindings(raw, reading({ "src/run.ts": SOURCE }));
    expect(done.map((item) => [item.rule, item.line])).toEqual([
      ["no-unused-vars", 5],
      ["other", 1],
      ["no-unused-vars", 4],
    ]);
  });
});

describe("G1b countsByRuleFile derives the counts from the findings alone", () => {
  const read = reading({ "src/run.ts": SOURCE, "src/b.ts": SOURCE });
  const found = completeFindings(
    [
      finding({ line: 4 }),
      finding({ line: 5 }),
      finding({ rule: "no-undef", line: 3 }),
      finding({ file: "src/b.ts", line: 4 }),
      { tool: "audit", rule: "GHSA-1", verdict: "fail", message: "advisory" },
    ],
    read,
  );

  it("groups by rule and file, counts each, and sorts by rule then file", () => {
    expect(countsByRuleFile(found)).toEqual([
      { rule: "no-undef", file: "src/run.ts", count: 1 },
      { rule: "no-unused-vars", file: "src/b.ts", count: 1 },
      { rule: "no-unused-vars", file: "src/run.ts", count: 2 },
    ]);
  });

  it("counts only findings that have a file: an advisory has no place to ratchet on", () => {
    expect(countsByRuleFile(found).some((row) => row.rule === "GHSA-1")).toBe(false);
  });

  it("is empty for no findings", () => {
    expect(countsByRuleFile([])).toEqual([]);
  });

  it("changes when a finding is added or removed, and by nothing else", () => {
    const fewer = found.slice(1);
    expect(
      countsByRuleFile(fewer).find(
        (row) => row.file === "src/run.ts" && row.rule === "no-unused-vars",
      )?.count,
    ).toBe(1);
    expect(countsByRuleFile([...found].reverse())).toEqual(countsByRuleFile(found));
  });
});
