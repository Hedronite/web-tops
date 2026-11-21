import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Runner } from "../census/eslint.ts";
import type { Exec, ExecResult } from "../gate/types.ts";
import { cleanTemp, tempDir } from "../laws/probe/testkit.ts";
import { askRules, parseRules } from "./rules.ts";

afterAll(cleanTemp);

const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: "" });

const printed = JSON.stringify({
  rules: {
    "src/a.ts": { complexity: { level: 2, options: "[4]" }, eqeqeq: { level: 0, options: "[]" } },
  },
});

describe("the rules ESLint printed", () => {
  it("are each rule of each file with its level and its options", () => {
    expect(parseRules(printed)).toEqual(
      new Map([
        [
          "src/a.ts",
          new Map([
            ["complexity", { level: 2, options: "[4]" }],
            ["eqeqeq", { level: 0, options: "[]" }],
          ]),
        ],
      ]),
    );
    expect(parseRules('{ "rules": {} }')?.size).toBe(0);
  });

  it("are nothing when what was printed is not that", () => {
    for (const text of [
      "not json",
      "[]",
      "{}",
      '{ "rules": [] }',
      '{ "rules": { "a.ts": [] } }',
      '{ "rules": { "a.ts": { "r": 2 } } }',
      '{ "rules": { "a.ts": { "r": { "level": "2", "options": "[]" } } } }',
      '{ "rules": { "a.ts": { "r": { "level": 2, "options": 4 } } } }',
      '{ "rules": { "a.ts": { "r": { "level": 2, "options": "[]" } }, "b.ts": null } }',
    ]) {
      expect(parseRules(text), text).toBeUndefined();
    }
  });
});

function runner(exec: Exec): Runner {
  return { cwd: tempDir(), env: { A: "1" }, exec, outDir: join(tempDir(), ".web-tops", "out") };
}

interface Call {
  readonly command: string;
  readonly args: readonly string[];
  readonly marker: string | undefined;
  readonly list: unknown;
}

const envOf = (
  options: { env?: Record<string, string | undefined> } | undefined,
): Record<string, string | undefined> => options?.env ?? {};

function recorder(calls: Call[]): Exec {
  return (command, args, options) => {
    const env = envOf(options);
    const list: unknown = JSON.parse(readFileSync(String(env["WEBTOPS_LAWDIFF_FILES"]), "utf8"));
    calls.push({ command, args, marker: env["A"], list });
    return Promise.resolve(ok(printed));
  };
}

const exits =
  (stderr: string): Exec =>
  () =>
    Promise.resolve({ code: 1, stdout: "", stderr });

const timesOut: Exec = () =>
  Promise.resolve({ code: null, stdout: "", stderr: "", failure: "tool-timeout" });

const says =
  (stdout: string): Exec =>
  () =>
    Promise.resolve(ok(stdout));

describe("asking the checkout's ESLint", () => {
  it("runs one process under node from the checkout, with the files it was given", async () => {
    const calls: Call[] = [];
    const read = await askRules(runner(recorder(calls)), ["src/a.ts", "src/b.ts"]);
    expect(read.ok).toBe(true);
    expect(calls).toMatchObject([{ command: "node", marker: "1", list: ["src/a.ts", "src/b.ts"] }]);
    const args = calls.flatMap((call) => call.args);
    expect(args.slice(0, 2)).toEqual(["--input-type=module", "-e"]);
    expect(args[2]).toContain("calculateConfigForFile");
  });

  it("reads what ESLint prints", async () => {
    const read = await askRules(runner(says(printed)), []);
    expect(read.ok ? [...read.value.keys()] : []).toEqual(["src/a.ts"]);
  });

  it("says why when ESLint cannot be run, exits non-zero, or prints something else", async () => {
    expect(await askRules(runner(exits("a\nb\nc\nd")), [])).toEqual({
      ok: false,
      message: "ESLint could not be asked about the project's files (exit 1: b c d)",
    });
    expect(await askRules(runner(timesOut), [])).toEqual({
      ok: false,
      message: "ESLint could not be asked about the project's files (tool-timeout)",
    });
    const odd = await askRules(runner(says("nope")), []);
    expect(odd).toEqual({ ok: false, message: "ESLint printed something that is not its rules" });
  });
});
