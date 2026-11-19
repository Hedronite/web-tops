import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Exec, ExecResult } from "../../gate/types.ts";
import { runProbe, type ProbeRequest } from "./run.ts";
import { cleanTemp, put, tempDir } from "./testkit.ts";
import type { ProbeLaw } from "./types.ts";

afterAll(cleanTemp);

const LAW: ProbeLaw = { id: "W-99", proofs: ["no-thing"] };

const FIXTURES = {
  "W-99/bad/a.ts": "export const a = 1; // expect: no-thing\n",
  "W-99/clean/a.ts": "export const a = 1;\n",
};

const STUBS = {
  eslint: { package: "eslint", command: "eslint", bin: "bin/eslint.js" },
  tsc: { package: "typescript", command: "tsc", bin: "bin/tsc" },
} as const;

type Stub = (typeof STUBS)[keyof typeof STUBS];

function install(dir: string, stub: Stub): void {
  const manifest = { name: stub.package, bin: { [stub.command]: stub.bin } };
  put(dir, {
    [`node_modules/${stub.package}/package.json`]: JSON.stringify(manifest),
    [`node_modules/${stub.package}/${stub.bin}`]: "",
  });
}

/** A project with the tools installed as stubs, so `runTool` finds them; the fake `exec` stands in for `node`. */
function project(stubs: readonly Stub[] = [STUBS.eslint, STUBS.tsc]): string {
  const dir = tempDir();
  stubs.forEach((stub) => {
    install(dir, stub);
  });
  return dir;
}

interface Call {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
}

interface Script {
  readonly eslint?: ExecResult;
  /** What ESLint writes to its --output-file. */
  readonly eslintOutput?: string;
  readonly tsc?: ExecResult;
}

const OK: ExecResult = { code: 0, stdout: "", stderr: "" };

/** ESLint's `--output-file` is the word after the flag. */
function writeOutput(args: readonly string[], text: string): void {
  writeFileSync(args[args.indexOf("--output-file") + 1] ?? "", text);
}

const isTsc = (args: readonly string[]): boolean => (args[0] ?? "").endsWith("tsc");

function emit(script: Script, args: readonly string[]): void {
  if (!isTsc(args) && script.eslintOutput !== undefined) {
    writeOutput(args, script.eslintOutput);
  }
}

function respond(script: Script, args: readonly string[]): ExecResult {
  emit(script, args);
  return (isTsc(args) ? script.tsc : script.eslint) ?? OK;
}

function fake(script: Script, calls: Call[]): Exec {
  return (command, args, options) => {
    calls.push({ command, args, cwd: options?.cwd });
    return Promise.resolve(respond(script, args));
  };
}

/** The call at an index: a test that expects one fails with its own message when there is none. */
function nth(calls: readonly Call[], index: number): Call {
  const call = calls[index];
  if (call === undefined) {
    throw new Error(`no call ${String(index)}`);
  }
  return call;
}

function request(cwd: string, exec: Exec, extra: Partial<ProbeRequest> = {}): ProbeRequest {
  const fixtures = tempDir();
  put(fixtures, FIXTURES);
  return {
    cwd,
    env: { PATH: "/bin" },
    exec,
    fixtures,
    scratch: join(cwd, ".web-tops", "out", "laws-probe"),
    laws: [LAW],
    eslintConfig: undefined,
    tsconfig: join(cwd, "tsconfig.json"),
    ...extra,
  };
}

const eslintJson = (rule: string, line: number): string =>
  JSON.stringify([
    {
      filePath: "SCRATCH/W-99/bad/a.ts",
      messages: [{ ruleId: rule, line, message: "m" }],
    },
  ]);

describe("G3b the runner lints the twins once and compiles them once, then judges each law", () => {
  it("runs ESLint over the scratch directory with --no-ignore, and tsc on its tsconfig, from the project", async () => {
    const cwd = project();
    const calls: Call[] = [];
    await runProbe(request(cwd, fake({ eslintOutput: "[]" }, calls)));
    const eslint = nth(calls, 0);
    const tsc = nth(calls, 1);
    expect(eslint.command).toBe("node");
    expect(eslint.args.slice(1, 5)).toEqual(["--no-ignore", "--format", "json", "--output-file"]);
    expect(eslint.args.at(-1)).toBe(join(".web-tops", "out", "laws-probe"));
    expect(eslint.cwd).toBe(realpathSync(cwd));
    expect(tsc.args.slice(1)).toEqual([
      "-p",
      join(realpathSync(cwd), ".web-tops", "out", "laws-probe", "tsconfig.json"),
      "--noEmit",
      "--pretty",
      "false",
    ]);
    expect(calls).toHaveLength(2);
  });

  it("passes the ESLint config given with --config, and none when there is none", async () => {
    const cwd = project();
    const withConfig: Call[] = [];
    const named = request(cwd, fake({ eslintOutput: "[]" }, withConfig), {
      eslintConfig: "/x/e.js",
    });
    await runProbe(named);
    const args = withConfig[0]?.args ?? [];
    expect(args[args.indexOf("--config") + 1]).toBe("/x/e.js");
    const without: Call[] = [];
    await runProbe(request(cwd, fake({ eslintOutput: "[]" }, without)));
    expect(without[0]?.args).not.toContain("--config");
  });

  it("judges the law from what the tools reported: a marked rule that fired passes", async () => {
    const cwd = project();
    const real = join(realpathSync(cwd), ".web-tops/out/laws-probe");
    const output = eslintJson("plugin/no-thing", 1).replace("SCRATCH", real);
    const outcome = await runProbe(request(cwd, fake({ eslintOutput: output }, [])));
    expect(outcome).toMatchObject({
      ok: true,
      report: { laws: [{ id: "W-99", verdict: "pass" }] },
    });
  });

  it("a marked rule that did not fire fails the law as silent", async () => {
    const cwd = project();
    const outcome = await runProbe(request(cwd, fake({ eslintOutput: "[]" }, [])));
    expect(outcome.ok && outcome.report.laws[0]?.failures.map((failure) => failure.kind)).toEqual([
      "silent",
    ]);
  });

  it("reads a tsc diagnostic into the judgement", async () => {
    const cwd = project();
    const diagnostics = ".web-tops/out/laws-probe/W-99/clean/a.ts(1,1): error TS7006: x";
    const tsc: ExecResult = { code: 2, stdout: `${diagnostics}\n`, stderr: "" };
    const law: ProbeLaw = { id: "W-99", proofs: ["noImplicitAny"] };
    const outcome = await runProbe(
      request(cwd, fake({ eslintOutput: "[]", tsc }, []), { laws: [law] }),
    );
    const kinds = outcome.ok ? outcome.report.laws[0]?.failures.map((failure) => failure.kind) : [];
    expect(kinds).toEqual(["silent", "noisy", "unproven"]);
  });

  it("ESLint exiting 1 means findings and is fine; tsc exiting 1 or 2 is fine; ESLint exiting 2 is a problem", async () => {
    const cwd = project();
    const findings: ExecResult = { code: 1, stdout: "", stderr: "" };
    const tsc: ExecResult = { code: 2, stdout: "", stderr: "" };
    expect(
      (await runProbe(request(cwd, fake({ eslintOutput: "[]", eslint: findings, tsc }, [])))).ok,
    ).toBe(true);
    const crashed: ExecResult = { code: 2, stdout: "", stderr: "Oops! Something went wrong" };
    const outcome = await runProbe(request(cwd, fake({ eslint: crashed }, [])));
    expect(outcome).toMatchObject({ ok: false, code: 2 });
    expect(!outcome.ok && outcome.problem).toContain("eslint exited 2: Oops! Something went wrong");
  });

  it("tsc exiting with a code it does not use for diagnostics is a problem", async () => {
    const cwd = project();
    const outcome = await runProbe(
      request(
        cwd,
        fake({ eslintOutput: "[]", tsc: { code: 3, stdout: "out", stderr: "err" } }, []),
      ),
    );
    expect(outcome).toMatchObject({ ok: false, code: 2 });
    expect(!outcome.ok && outcome.problem).toContain("tsc exited 3: err\nout");
  });

  it("a tool that is not installed in node_modules is an environment problem, and nothing is started", async () => {
    const calls: Call[] = [];
    const outcome = await runProbe(request(project([STUBS.tsc]), fake({}, calls)));
    expect(outcome).toEqual({
      ok: false,
      code: 3,
      problem: "eslint did not run: tool-missing. eslint is not installed in node_modules",
    });
    expect(calls).toEqual([]);
  });

  it("a tool that timed out is an environment problem too", async () => {
    const timeout: ExecResult = { code: null, stdout: "", stderr: "late", failure: "tool-timeout" };
    const outcome = await runProbe(request(project(), fake({ eslint: timeout }, [])));
    expect(outcome).toMatchObject({ ok: false, code: 3 });
    expect(!outcome.ok && outcome.problem).toBe("eslint did not run: tool-timeout. late");
  });

  it("output it cannot read is a problem that quotes the output, not an empty result", async () => {
    const cwd = project();
    const notArray = await runProbe(request(cwd, fake({ eslintOutput: '{"a":1}' }, [])));
    expect(!notArray.ok && notArray.problem).toBe(
      'eslint wrote output the probe cannot read: {"a":1}',
    );
    const noFile = await runProbe(
      request(cwd, fake({ eslint: { code: 0, stdout: "", stderr: "no file" } }, [])),
    );
    expect(!noFile.ok && noFile.problem).toBe("eslint wrote output the probe cannot read: no file");
  });

  it("a tsc config error is a problem: the twins were not compiled", async () => {
    const cwd = project();
    const bad: ExecResult = {
      code: 1,
      stdout: "error TS5083: Cannot read file 'x'.\n",
      stderr: "",
    };
    const outcome = await runProbe(request(cwd, fake({ eslintOutput: "[]", tsc: bad }, [])));
    expect(!outcome.ok && outcome.problem).toBe(
      "tsc wrote output the probe cannot read: error TS5083: Cannot read file 'x'.",
    );
  });

  it("cuts a long message to its last 600 characters", async () => {
    const long: ExecResult = { code: 2, stdout: "", stderr: `${"a".repeat(700)}END` };
    const outcome = await runProbe(request(project(), fake({ eslint: long }, [])));
    expect(!outcome.ok && outcome.problem).toBe(`eslint exited 2: ${"a".repeat(597)}END`);
  });
});
