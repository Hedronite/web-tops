import { describe, expect, it } from "vitest";
import { readEslint, readStylelint, readTsc, underRoot } from "./observe.ts";

const ROOT = "/project/.web-tops/out/laws-probe";

const entry = (name: string, messages: unknown[]): unknown => ({
  filePath: `${ROOT}/${name}`,
  messages,
});

describe("G3b observe: what ESLint and tsc reported on the twins", () => {
  it("names a file relative to the scratch root, with / separators", () => {
    expect(underRoot(ROOT, `${ROOT}/W-01/bad/a.ts`)).toBe("W-01/bad/a.ts");
    expect(underRoot(ROOT, "W-01/bad/a.ts")).toBe("W-01/bad/a.ts");
  });

  it("reads each message of ESLint's JSON as a rule on a line of a file", () => {
    const json = [
      entry("W-01/bad/a.ts", [
        { ruleId: "@typescript-eslint/no-explicit-any", line: 3, message: "Unexpected any." },
        { ruleId: "no-fallthrough", line: 9, message: "x" },
      ]),
      entry("W-01/clean/a.ts", []),
    ];
    expect(readEslint(ROOT, json)).toEqual([
      { file: "W-01/bad/a.ts", line: 3, rule: "@typescript-eslint/no-explicit-any" },
      { file: "W-01/bad/a.ts", line: 9, rule: "no-fallthrough" },
    ]);
  });

  it("names a message with no rule: an unused directive by its kind, anything else as a fatal error", () => {
    const json = [
      entry("W-35/bad/a.ts", [
        {
          ruleId: null,
          line: 2,
          message: "Unused eslint-disable directive (no problems were reported).",
        },
        { ruleId: null, line: 1, message: "Parsing error: Unexpected token", fatal: true },
        { ruleId: null, line: 5 },
      ]),
    ];
    expect(readEslint(ROOT, json)?.map((found) => [found.line, found.rule])).toEqual([
      [2, "reportUnusedDisableDirectives"],
      [1, "eslint-fatal"],
      [5, "eslint-fatal"],
    ]);
  });

  it("a message with no line is placed on line 0", () => {
    const json = [entry("a.ts", [{ ruleId: "r" }])];
    expect(readEslint(ROOT, json)).toEqual([{ file: "a.ts", line: 0, rule: "r" }]);
  });

  it("is undefined for output that is not an array of file results, and skips an entry with no messages", () => {
    expect(readEslint(ROOT, { messages: [] })).toBeUndefined();
    expect(readEslint(ROOT, undefined)).toBeUndefined();
    expect(
      readEslint(ROOT, [null, "text", { filePath: "a.ts" }, { filePath: "a.ts", messages: 3 }]),
    ).toEqual([]);
  });

  it("reads each warning of Stylelint's JSON as a rule on a line of a file, with its own words for none", () => {
    const json = [
      {
        source: `${ROOT}/W-26/bad/rules.css`,
        warnings: [
          { rule: "block-no-empty", line: 3, text: "Unexpected empty block" },
          { rule: "", line: 4, text: "x" },
          { line: 9 },
          { rule: "unit-no-unknown" },
        ],
      },
      { source: `${ROOT}/W-26/clean/rules.css`, warnings: [] },
    ];
    expect(readStylelint(ROOT, json)).toEqual([
      { file: "W-26/bad/rules.css", line: 3, rule: "block-no-empty" },
      { file: "W-26/bad/rules.css", line: 4, rule: "stylelint-fatal" },
      { file: "W-26/bad/rules.css", line: 9, rule: "stylelint-fatal" },
      { file: "W-26/bad/rules.css", line: 0, rule: "unit-no-unknown" },
    ]);
  });

  it("is undefined for Stylelint output that is not an array, and skips an entry with no warnings", () => {
    expect(readStylelint(ROOT, { warnings: [] })).toBeUndefined();
    expect(
      readStylelint(ROOT, [null, { source: "a.css" }, { source: "a.css", warnings: 1 }]),
    ).toEqual([]);
  });

  it("reads each diagnostic of tsc as a code on a line, placing the file under the scratch root", () => {
    const text = [
      ".web-tops/out/laws-probe/W-01/bad/a.ts(3,19): error TS7006: Parameter 'x' implicitly has an 'any' type.",
      ".web-tops/out/laws-probe/W-05/bad/e.ts(12,1): error TS1294: This syntax is not allowed.",
      "",
    ].join("\n");
    expect(readTsc(ROOT, "/project", text)).toEqual([
      { file: "W-01/bad/a.ts", line: 3, rule: "TS7006" },
      { file: "W-05/bad/e.ts", line: 12, rule: "TS1294" },
    ]);
  });

  it("is quiet for a clean compile, and ignores a line that is not a diagnostic", () => {
    expect(readTsc(ROOT, "/project", "")).toEqual([]);
    expect(readTsc(ROOT, "/project", "Found 2 errors.\n  continued text (1,2)\n")).toEqual([]);
  });

  it("is undefined when a diagnostic names no file, as for a config it could not read", () => {
    const text = "error TS5083: Cannot read file '/project/tsconfig.json'.\n";
    expect(readTsc(ROOT, "/project", text)).toBeUndefined();
    expect(readTsc(ROOT, "/project", `a.ts(1,1): error TS1:\n${text}`)).toBeUndefined();
  });
});

describe("G3a observe: what a tool's JSON may hold", () => {
  it("lists nothing for a file result with no array under its key, and skips an item that is not a record", () => {
    const json = [
      { filePath: "/r/a.ts" },
      { filePath: "/r/b.ts", messages: "not an array" },
      { filePath: "/r/c.ts", messages: ["junk", 3, null, { ruleId: "x", line: 2 }] },
    ];
    expect(readEslint("/r", json)).toEqual([{ file: "c.ts", line: 2, rule: "x" }]);
    const css = [
      { source: "/r/a.css", warnings: ["junk", { rule: "y", line: 1 }] },
      { source: "/r/b.css" },
    ];
    expect(readStylelint("/r", css)).toEqual([{ file: "a.css", line: 1, rule: "y" }]);
  });

  it("reads a tsc diagnostic with the code and the file as the line names them", () => {
    const text = "src/a b.ts(3,4): error TS7006: x\nnoise\nsrc/c.ts(5,1): error TS2322: y\n";
    expect(readTsc("/r", "/r", text)).toEqual([
      { file: "src/a b.ts", line: 3, rule: "TS7006" },
      { file: "src/c.ts", line: 5, rule: "TS2322" },
    ]);
  });
});
