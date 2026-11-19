import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Exec, ExecResult } from "../gate/types.ts";
import { cleanTemp, put, tempDir } from "../laws/probe/testkit.ts";
import type { ProbeLaw } from "../laws/probe/types.ts";
import { cli } from "./test-support-probe.ts";

afterAll(cleanTemp);

/** The probe's CLI over a fake ESLint and tsc: fast, in this process, so the command's own code is run and judged here. */

const LAW: ProbeLaw = { id: "W-99", proofs: ["no-thing"] };
const laws = (): readonly ProbeLaw[] => [LAW];

/** A project with ESLint and tsc stubs in node_modules, so `resolveTool` finds them and the fake `exec` stands in for node. */
function project(): string {
  const dir = tempDir();
  const stub = (pkg: string, command: string, bin: string): Record<string, string> => ({
    [`node_modules/${pkg}/package.json`]: JSON.stringify({ name: pkg, bin: { [command]: bin } }),
    [`node_modules/${pkg}/${bin}`]: "",
  });
  put(dir, {
    ...stub("eslint", "eslint", "bin/eslint.js"),
    ...stub("typescript", "tsc", "bin/tsc"),
  });
  return dir;
}

function twins(): string {
  const dir = tempDir();
  put(dir, {
    "W-99/bad/a.ts": "export const a = 1; // expect: no-thing\n",
    "W-99/clean/a.ts": "export const a = 1;\n",
  });
  return dir;
}

const OK: ExecResult = { code: 0, stdout: "", stderr: "" };

/** Fake tools: ESLint writes the findings it is given to its `--output-file`; tsc says nothing. */
function fake(cwd: string, findings: readonly string[]): Exec {
  const real = join(realpathSync(cwd), ".web-tops", "out", "laws-probe", "W-99", "bad", "a.ts");
  const messages = findings.map((ruleId) => ({ ruleId, line: 1, message: "m" }));
  return (_command, args) => {
    const at = args.indexOf("--output-file");
    if (at !== -1) {
      writeFileSync(args[at + 1] ?? "", JSON.stringify([{ filePath: real, messages }]));
    }
    return Promise.resolve(OK);
  };
}

const flags = (fixtures: string, ...more: string[]): string[] => [
  "--fixtures",
  fixtures,
  "--law",
  "W-99",
  ...more,
];

describe("G3b the probe's command over fake tools: its text, its JSON and its exit code", () => {
  it("a reader that fires on the bad twin passes: exit 0, a line for the law, and how many pass", async () => {
    const cwd = project();
    const result = await cli(flags(twins()), cwd, { exec: fake(cwd, ["plugin/no-thing"]), laws });
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain("W-99  pass\n");
    expect(result.out.endsWith("1 of 1 laws probed pass\n")).toBe(true);
  });

  it("--json prints the report as JSON, with the same exit code", async () => {
    const cwd = project();
    const result = await cli(flags(twins(), "--json"), cwd, {
      exec: fake(cwd, ["plugin/no-thing"]),
      laws,
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual({
      laws: [{ id: "W-99", verdict: "pass", failures: [], unrelated: [] }],
    });
    expect(result.out.endsWith("}\n")).toBe(true);
  });

  it("a silent reader fails the law: exit 1, and the line says which marker stayed quiet", async () => {
    const cwd = project();
    const result = await cli(flags(twins()), cwd, { exec: fake(cwd, []), laws });
    expect(result.code).toBe(1);
    expect(result.out).toContain("W-99  fail\n");
    expect(result.out).toContain(
      "W-99/bad/a.ts:1 stayed quiet: no-thing did not fire on its bad twin",
    );
  });

  it("a missing tool is exit 3 and the message names it, before anything is judged", async () => {
    const result = await cli(flags(twins()), tempDir(), { exec: fake(tempDir(), []), laws });
    expect(result.code).toBe(3);
    expect(result.err).toBe(
      "webtops laws probe: eslint did not run: tool-missing. eslint is not installed in node_modules\n",
    );
    expect(result.out).toBe("");
  });
});
