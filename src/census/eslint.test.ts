import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { realExec } from "../gate/exec.ts";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";
import type { Exec, ExecResult } from "../gate/types.ts";
import { eslintIgnores, ruleOff } from "./config.ts";
import type { Levels } from "./config.ts";
import { eslintFacts, hasEslintConfig, parseFacts } from "./eslint.ts";
import type { Runner } from "./eslint.ts";

const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "wt-census-"));
  made.push(dir);
  return dir;
};

const probe = resolve(import.meta.dirname, "../../fixtures/probe");

describe("hasEslintConfig", () => {
  it.each([
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
    "eslint.config.ts",
    "eslint.config.mts",
    "eslint.config.cts",
  ])("sees %s", (name) => {
    const dir = temp();
    writeFileSync(join(dir, name), "export default [];");
    expect(hasEslintConfig(dir)).toBe(true);
  });

  it("sees none in a project with no flat config, and not a legacy one", () => {
    const dir = temp();
    expect(hasEslintConfig(dir)).toBe(false);
    writeFileSync(join(dir, ".eslintrc.json"), "{}");
    expect(hasEslintConfig(dir)).toBe(false);
  });
});

describe("parseFacts", () => {
  const facts = (output: string) => {
    const read = parseFacts(output);
    if (!read.ok) throw new Error(read.message);
    return read.facts;
  };

  it("reads the ignored map", () => {
    const found = facts(JSON.stringify({ ignored: { "a.ts": false, "b.ts": true }, levels: {} }));
    expect([...found.ignored]).toEqual([
      ["a.ts", false],
      ["b.ts", true],
    ]);
  });

  it("reads each file's rule levels", () => {
    const found = facts(JSON.stringify({ ignored: {}, levels: { "a.ts": { x: 2, y: 0 } } }));
    expect([...(found.levels.get("a.ts") ?? [])]).toEqual([
      ["x", 2],
      ["y", 0],
    ]);
  });

  it("takes an ignored value that is not true as false, and drops a level that is not a number", () => {
    const found = facts(
      JSON.stringify({ ignored: { "a.ts": "yes" }, levels: { "a.ts": { x: "2", y: 1 } } }),
    );
    expect([...found.ignored]).toEqual([["a.ts", false]]);
    expect([...(found.levels.get("a.ts") ?? [])]).toEqual([["y", 1]]);
  });

  it("takes a file whose rules are not a map as having none, and a missing part as empty", () => {
    expect([
      ...(facts(JSON.stringify({ levels: { "b.ts": 5 } })).levels.get("b.ts") ?? ["x"]),
    ]).toEqual([]);
    expect(facts("{}").ignored.size).toBe(0);
    expect(facts("{}").levels.size).toBe(0);
  });

  it("refuses output that is not JSON, or is not an object", () => {
    expect(parseFacts("oops")).toEqual({
      ok: false,
      message: "ESLint's census output was not JSON",
    });
    expect(parseFacts("[]")).toEqual({
      ok: false,
      message: "ESLint's census output was not an object",
    });
  });
});

describe("eslintFacts with a fake process", () => {
  const runnerWith = (
    result: ExecResult,
  ): { runner: Runner; calls: [string, readonly string[], object | undefined][] } => {
    const calls: [string, readonly string[], object | undefined][] = [];
    const exec: Exec = (command, args, options) => {
      calls.push([command, args, options]);
      return Promise.resolve(result);
    };
    return {
      runner: { cwd: "/project", env: { PATH: "/bin" }, exec, outDir: join(temp(), "out") },
      calls,
    };
  };

  const field = (from: unknown, key: string): unknown =>
    typeof from === "object" && from !== null ? Reflect.get(from, key) : undefined;

  it("runs one Node process for all the files, from the project", async () => {
    const { runner, calls } = runnerWith({
      code: 0,
      stdout: JSON.stringify({ ignored: { "a.ts": false }, levels: {} }),
      stderr: "",
    });
    const read = await eslintFacts(runner, ["a.ts", "b.ts"]);
    expect(read.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const [command, args, options] = calls[0] ?? [];
    expect(command).toBe("node");
    expect(args).toEqual(expect.arrayContaining(["--input-type=module", "-e"]));
    expect(field(options, "cwd")).toBe("/project");
  });

  it("hands the process the environment it was given", async () => {
    const { runner, calls } = runnerWith({ code: 0, stdout: "{}", stderr: "" });
    await eslintFacts(runner, ["a.ts"]);
    expect(field(field(calls[0]?.[2], "env"), "PATH")).toBe("/bin");
  });

  it("writes the files it asks about to a file, and names it to the process", async () => {
    const { runner, calls } = runnerWith({ code: 0, stdout: "{}", stderr: "" });
    await eslintFacts(runner, ["a.ts", "b.ts"]);
    const list = field(field(calls[0]?.[2], "env"), "WEBTOPS_CENSUS_FILES");
    expect(JSON.parse(readFileSync(String(list), "utf8"))).toEqual(["a.ts", "b.ts"]);
  });

  it("says why when ESLint exits non-zero, with the end of its error", async () => {
    const { runner } = runnerWith({
      code: 2,
      stdout: "",
      stderr: "line1\nline2\nline3\nTypeError: bad config",
    });
    const read = await eslintFacts(runner, ["a.ts"]);
    expect(!read.ok && read.message).toContain("exit 2");
    expect(!read.ok && read.message).toContain("TypeError: bad config");
    expect(!read.ok && read.message).not.toContain("line1");
  });

  it.each(["tool-missing", "tool-timeout"] as const)(
    "says why when the process is %s",
    async (failure) => {
      const { runner } = runnerWith({ code: null, stdout: "", stderr: "", failure });
      const read = await eslintFacts(runner, ["a.ts"]);
      expect(!read.ok && read.message).toContain(failure);
    },
  );

  it("refuses output that is not what the script prints", async () => {
    const { runner } = runnerWith({ code: 0, stdout: "not json", stderr: "" });
    expect((await eslintFacts(runner, ["a.ts"])).ok).toBe(false);
  });
});

/** The real ESLint, on the probe projects the facts were recorded from: the same answers the recordings hold. */
describe("eslintFacts with the real ESLint, on the probe projects", () => {
  const runnerFor = (cwd: string): Runner => {
    const out = join(temp(), "out");
    mkdirSync(out, { recursive: true });
    return { cwd, env: process.env, exec: realExec, outDir: out };
  };

  it(
    "says which files an ignores entry leaves out (census-eslint-ignores)",
    async () => {
      const read = await eslintFacts(runnerFor(join(probe, "census-eslint-ignores")), [
        "src/ok.ts",
        "src/legacy/a.ts",
        "src/legacy/b.ts",
      ]);
      expect(read.ok).toBe(true);
      expect(read.ok && eslintIgnores(read.facts.ignored).map((hit) => hit.file)).toEqual([
        "src/legacy/a.ts",
        "src/legacy/b.ts",
      ]);
    },
    REAL_TOOL_TIMEOUT,
  );

  const RULE = "@typescript-eslint/no-explicit-any";

  const probeLevels = async (): Promise<Levels> => {
    const read = await eslintFacts(runnerFor(join(probe, "rule-off-override")), [
      "src/strict.ts",
      "src/legacy/loose.ts",
    ]);
    if (!read.ok) throw new Error(read.message);
    return read.facts.levels;
  };

  it(
    "gives the effective level of a rule per file (rule-off-override)",
    async () => {
      const levels = await probeLevels();
      expect(levels.get("src/strict.ts")?.get(RULE)).toBe(2);
      expect(levels.get("src/legacy/loose.ts")?.get(RULE)).toBe(0);
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "counts the one file the override turns the rule off for",
    async () => {
      const hits = ruleOff(await probeLevels()).filter((hit) => hit.rule === RULE);
      expect(hits.map((hit) => hit.file)).toEqual(["src/legacy/loose.ts"]);
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "is `ok: false` for a config that does not load",
    async () => {
      const dir = temp();
      writeFileSync(join(dir, "eslint.config.js"), "export default [ nope ];");
      const read = await eslintFacts(runnerFor(dir), ["a.ts"]);
      expect(read.ok).toBe(false);
    },
    REAL_TOOL_TIMEOUT,
  );
});

describe("eslintFacts: what it says and where it writes", () => {
  const runnerWith = (result: ExecResult): { runner: Runner; out: string } => {
    const out = join(temp(), "out");
    const exec: Exec = () => Promise.resolve(result);
    return { runner: { cwd: "/project", env: {}, exec, outDir: out }, out };
  };

  it("writes the list of files under the output folder, in a census folder", async () => {
    const { runner, out } = runnerWith({ code: 0, stdout: "{}", stderr: "" });
    await eslintFacts(runner, ["a.ts"]);
    expect(JSON.parse(readFileSync(join(out, "census", "eslint-files.json"), "utf8"))).toEqual([
      "a.ts",
    ]);
  });

  it("refuses output that is JSON `null`, saying it is not an object", () => {
    expect(parseFacts("null")).toEqual({
      ok: false,
      message: "ESLint's census output was not an object",
    });
    expect(parseFacts("5")).toEqual({
      ok: false,
      message: "ESLint's census output was not an object",
    });
  });

  it("says why for a process that failed even though its exit code was 0", async () => {
    const { runner } = runnerWith({ code: 0, stdout: "{}", stderr: "", failure: "tool-timeout" });
    const read = await eslintFacts(runner, ["a.ts"]);
    expect(read).toEqual({
      ok: false,
      message: "ESLint could not be asked about the project's files (tool-timeout)",
    });
  });

  it("quotes the last three lines of ESLint's error on one line, without its trailing line break", async () => {
    const { runner } = runnerWith({ code: 2, stdout: "", stderr: "a\nb\nc\nd\n" });
    const read = await eslintFacts(runner, ["a.ts"]);
    expect(read).toEqual({
      ok: false,
      message: "ESLint could not be asked about the project's files (exit 2: b c d)",
    });
  });

  it("quotes all of a short error", async () => {
    const { runner } = runnerWith({ code: 1, stdout: "", stderr: "only one line" });
    const read = await eslintFacts(runner, ["a.ts"]);
    expect(!read.ok && read.message).toContain("(exit 1: only one line)");
  });
});
