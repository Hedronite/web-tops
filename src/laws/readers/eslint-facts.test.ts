import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Exec, ExecOptions, ExecResult } from "../../gate/types.ts";
import { cleanTemp, tempDir } from "../probe/testkit.ts";
import { UNUSED_DIRECTIVES, askEslint } from "./eslint-facts.ts";

afterAll(cleanTemp);

interface Call {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: ExecOptions | undefined;
}

/** The one call a test expects, or a failure that says there was not one. */
function only(calls: readonly Call[]): Call {
  const [call] = calls;
  if (calls.length !== 1 || call === undefined) {
    throw new Error(`expected one call, got ${String(calls.length)}`);
  }
  return call;
}

/** A runner whose exec answers with the result and keeps what it was asked. */
function runner(result: ExecResult): {
  calls: Call[];
  outDir: string;
  run: Parameters<typeof askEslint>[0];
} {
  const calls: Call[] = [];
  const outDir = tempDir();
  const exec: Exec = (command, args, options) => {
    calls.push({ command, args, options });
    return Promise.resolve(result);
  };
  return {
    calls,
    outDir,
    run: { cwd: "/project", env: { PATH: "/bin", KEEP: "1" }, exec, outDir },
  };
}

const facts = JSON.stringify({
  ignored: { "src/a.ts": false },
  levels: { "src/a.ts": { "@typescript-eslint/no-explicit-any": 2 } },
});

describe("G4a the ESLint question is asked once, in one process, for every file", () => {
  it("runs node on the script, in the project, with the list of files and the environment", async () => {
    const { calls, outDir, run } = runner({ code: 0, stdout: facts, stderr: "" });
    await askEslint(run, ["src/a.ts", "src/b.ts"]);
    const call = only(calls);
    expect(call.command).toBe("node");
    expect(call.args.slice(0, 2)).toEqual(["--input-type=module", "-e"]);
    expect(call.args[2]).toContain("calculateConfigForFile");
    expect(call.args[2]).toContain(UNUSED_DIRECTIVES);
    const list = join(outDir, "laws", "eslint-files.json");
    expect(JSON.parse(readFileSync(list, "utf8"))).toEqual(["src/a.ts", "src/b.ts"]);
    expect(call.options).toEqual({
      cwd: "/project",
      env: { PATH: "/bin", KEEP: "1", WEBTOPS_LAWS_FILES: list },
      timeoutMs: 300_000,
    });
  });

  it("reads the answer: each file's levels by rule", async () => {
    const { run } = runner({ code: 0, stdout: facts, stderr: "" });
    const read = await askEslint(run, ["src/a.ts"]);
    if (!read.ok) {
      throw new Error(read.message);
    }
    expect([...read.facts.levels.keys()]).toEqual(["src/a.ts"]);
    expect([...(read.facts.levels.get("src/a.ts") ?? [])]).toEqual([
      ["@typescript-eslint/no-explicit-any", 2],
    ]);
  });

  it("a process that exits with a code is a problem that names the code and the last lines of what it said", async () => {
    const stderr = "one\ntwo\nthree\nfour\n";
    const { run } = runner({ code: 1, stdout: "", stderr });
    expect(await askEslint(run, [])).toEqual({
      ok: false,
      message: "ESLint could not be asked about the project's files (exit 1: two three four)",
    });
  });

  it("a process that could not run or was killed is a problem that names why", async () => {
    const { run } = runner({ code: null, stdout: "", stderr: "late", failure: "tool-timeout" });
    expect(await askEslint(run, [])).toEqual({
      ok: false,
      message: "ESLint could not be asked about the project's files (tool-timeout)",
    });
  });

  it("an answer that is not the facts is a problem, not an empty set of files", async () => {
    const { run } = runner({ code: 0, stdout: "not json", stderr: "" });
    const read = await askEslint(run, ["a.ts"]);
    expect(read.ok).toBe(false);
  });

  it("the linter option for unused directives is named once, where the reader and the script both find it", () => {
    expect(UNUSED_DIRECTIVES).toBe("reportUnusedDisableDirectives");
  });
});

describe("G4a the question's files", () => {
  it("makes the directory it writes the list in, parents and all", async () => {
    const outDir = join(tempDir(), "a", "b");
    const exec: Exec = () => Promise.resolve({ code: 0, stdout: facts, stderr: "" });
    await askEslint({ cwd: "/p", env: {}, exec, outDir }, ["x.ts"]);
    expect(JSON.parse(readFileSync(join(outDir, "laws", "eslint-files.json"), "utf8"))).toEqual([
      "x.ts",
    ]);
  });

  it("a process that gave an exit code of 0 but says it could not run is still a problem", async () => {
    const { run } = runner({ code: 0, stdout: facts, stderr: "", failure: "tool-missing" });
    expect(await askEslint(run, [])).toEqual({
      ok: false,
      message: "ESLint could not be asked about the project's files (tool-missing)",
    });
  });
});
