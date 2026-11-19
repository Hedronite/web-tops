import { describe, expect, it } from "vitest";
import { readEslint, readTsc, underRoot } from "./observe.ts";

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
      [2, "unused-disable-directive"],
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
