import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Runner } from "../census/eslint.ts";
import type { Exec } from "../gate/types.ts";
import { cleanTemp, tempDir } from "../laws/probe/testkit.ts";
import { askRules, parseRules } from "./rules.ts";

afterAll(cleanTemp);

const rules = (inner: unknown): string => JSON.stringify({ rules: inner });

describe("the rules ESLint printed", () => {
  it("are nothing when a part is a number, a string or null where an object belongs", () => {
    expect(parseRules(rules(5))).toBeUndefined();
    expect(parseRules(rules("x"))).toBeUndefined();
    expect(parseRules(rules(null))).toBeUndefined();
    expect(parseRules(rules({ "a.ts": 5 }))).toBeUndefined();
    expect(parseRules(rules({ "a.ts": "x" }))).toBeUndefined();
    expect(parseRules(rules({ "a.ts": null }))).toBeUndefined();
    expect(parseRules(rules({ "a.ts": { r: 5 } }))).toBeUndefined();
    expect(parseRules(rules({ "a.ts": { r: null } }))).toBeUndefined();
    expect(parseRules("5")).toBeUndefined();
    expect(parseRules("null")).toBeUndefined();
  });

  it("are the files and rules of an object, whatever else is printed beside it", () => {
    const text = JSON.stringify({
      other: 1,
      rules: { "a.ts": { r: { level: 1, options: "[]" } } },
    });
    expect([...(parseRules(text) ?? [])]).toEqual([
      ["a.ts", new Map([["r", { level: 1, options: "[]" }]])],
    ]);
  });
});

interface Call {
  readonly timeoutMs: number | undefined;
}

function runner(exec: Exec): Runner {
  return { cwd: "/p", env: {}, exec, outDir: join(tempDir(), "out") };
}

describe("asking ESLint", () => {
  it("gives it five minutes", async () => {
    const calls: Call[] = [];
    const exec: Exec = (_command, _args, options) => {
      calls.push({ timeoutMs: options?.timeoutMs });
      return Promise.resolve({ code: 0, stdout: rules({}), stderr: "" });
    };
    await askRules(runner(exec), []);
    expect(calls).toEqual([{ timeoutMs: 300_000 }]);
  });

  it("names the last three lines ESLint said, without the blank one a final newline leaves", async () => {
    const exec: Exec = () => Promise.resolve({ code: 2, stdout: "", stderr: "a\nb\nc\nd\n" });
    expect(await askRules(runner(exec), [])).toEqual({
      ok: false,
      message: "ESLint could not be asked about the project's files (exit 2: b c d)",
    });
    const padded: Exec = () => Promise.resolve({ code: 2, stdout: "", stderr: "\n  x  \n\n" });
    const read = await askRules(runner(padded), []);
    expect(read.ok ? "" : read.message).toBe(
      "ESLint could not be asked about the project's files (exit 2: x)",
    );
  });

  it("fails on a failure ESLint reports even when its exit code was 0", async () => {
    const exec: Exec = () =>
      Promise.resolve({ code: 0, stdout: rules({}), stderr: "", failure: "tool-missing" });
    expect(await askRules(runner(exec), [])).toEqual({
      ok: false,
      message: `ESLint could not be asked about the project's files (tool-missing: node could not be started in ${runner(exec).cwd}, the folder is missing)`,
    });
  });
});
