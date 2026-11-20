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
  stylelint: { package: "stylelint", command: "stylelint", bin: "bin/stylelint.mjs" },
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
function project(stubs: readonly Stub[] = Object.values(STUBS)): string {
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
  readonly stylelint?: ExecResult;
  /** What Stylelint writes to its --output-file. */
  readonly stylelintOutput?: string;
}

const OK: ExecResult = { code: 0, stdout: "", stderr: "" };

/** ESLint's `--output-file` is the word after the flag. */
function writeOutput(args: readonly string[], text: string): void {
  writeFileSync(args[args.indexOf("--output-file") + 1] ?? "", text);
}

type Tool = "eslint" | "tsc" | "stylelint";

/** Which tool a call is for, by the entry it is run with. */
function toolOf(args: readonly string[]): Tool {
  const entry = args[0] ?? "";
  if (entry.endsWith("tsc")) {
    return "tsc";
  }
  return entry.endsWith("stylelint.mjs") ? "stylelint" : "eslint";
}

function outputFor(script: Script, tool: Tool): string | undefined {
  if (tool === "eslint") {
    return script.eslintOutput;
  }
  return tool === "stylelint" ? script.stylelintOutput : undefined;
}

function emit(script: Script, args: readonly string[]): void {
  const text = outputFor(script, toolOf(args));
  if (text !== undefined) {
    writeOutput(args, text);
  }
}

function respond(script: Script, args: readonly string[]): ExecResult {
  emit(script, args);
  return script[toolOf(args)] ?? OK;
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

const CSS_LAW: ProbeLaw = { id: "W-98", proofs: ["block-no-empty"] };

function cssFixtures(): string {
  const dir = tempDir();
  put(dir, {
    "W-98/bad/a.css": "a {} /* expect: block-no-empty */\n",
    "W-98/clean/a.css": "a { color: red; }\n",
  });
  return dir;
}

const stylelintJson = (cwd: string, rule: string): string =>
  JSON.stringify([
    {
      source: join(realpathSync(cwd), ".web-tops/out/laws-probe/W-98/bad/a.css"),
      warnings: [{ rule, line: 1, text: "m" }],
    },
  ]);

function cssRequest(cwd: string, exec: Exec): ProbeRequest {
  return request(cwd, exec, { laws: [CSS_LAW], fixtures: cssFixtures() });
}

describe("G3b the runner reads CSS twins with Stylelint, and only then", () => {
  it("runs Stylelint alone over the CSS twins, ignoring the project's ignores, and judges the law", async () => {
    const cwd = project();
    const calls: Call[] = [];
    const script = { stylelintOutput: stylelintJson(cwd, "block-no-empty") };
    const outcome = await runProbe(cssRequest(cwd, fake(script, calls)));
    expect(calls).toHaveLength(1);
    const call = nth(calls, 0);
    expect(call.args.slice(1, 4)).toEqual(["--formatter", "json", "--output-file"]);
    expect(call.args).toContain("--ignore-path");
    expect(call.args.at(-1)).toBe(join(".web-tops", "out", "laws-probe", "**", "*.css"));
    expect(call.cwd).toBe(realpathSync(cwd));
    expect(outcome).toMatchObject({
      ok: true,
      report: { laws: [{ id: "W-98", verdict: "pass" }] },
    });
  });

  it("a rule that did not report is silent, and Stylelint exiting 2 means findings and is fine", async () => {
    const cwd = project();
    const found: ExecResult = { code: 2, stdout: "", stderr: "" };
    const script = { stylelint: found, stylelintOutput: "[]" };
    const outcome = await runProbe(cssRequest(cwd, fake(script, [])));
    const kinds = outcome.ok ? outcome.report.laws[0]?.failures.map((failure) => failure.kind) : [];
    expect(kinds).toEqual(["silent"]);
  });

  it("runs ESLint, tsc and Stylelint, in that order, when the twins are both", async () => {
    const cwd = project();
    const calls: Call[] = [];
    const fixtures = cssFixtures();
    put(fixtures, FIXTURES);
    const script = { eslintOutput: "[]", stylelintOutput: "[]" };
    await runProbe(request(cwd, fake(script, calls), { laws: [LAW, CSS_LAW], fixtures }));
    expect(calls.map((call) => toolOf(call.args))).toEqual(["eslint", "tsc", "stylelint"]);
  });

  it("Stylelint exiting 1 is a problem, and a missing Stylelint is an environment problem", async () => {
    const cwd = project();
    const crashed: ExecResult = { code: 1, stdout: "", stderr: "bad config" };
    const failed = await runProbe(cssRequest(cwd, fake({ stylelint: crashed }, [])));
    expect(!failed.ok && failed.problem).toBe("stylelint exited 1: bad config");
    const bare = project([STUBS.eslint, STUBS.tsc]);
    const missing = await runProbe(cssRequest(bare, fake({}, [])));
    expect(missing).toEqual({
      ok: false,
      code: 3,
      problem: "stylelint did not run: tool-missing. stylelint is not installed in node_modules",
    });
  });

  it("Stylelint output it cannot read is a problem that quotes the output", async () => {
    const outcome = await runProbe(cssRequest(project(), fake({ stylelintOutput: "{}" }, [])));
    expect(!outcome.ok && outcome.problem).toBe("stylelint wrote output the probe cannot read: {}");
  });
});

const ASTRO_LAW: ProbeLaw = { id: "W-97", proofs: ["no-thing"] };

function astroFixtures(): string {
  const dir = tempDir();
  put(dir, {
    "W-97/bad/page.astro": "<p /> <!-- expect: no-thing -->\n",
    "W-97/clean/page.astro": "<p />\n",
  });
  return dir;
}

const astroRequest = (cwd: string, exec: Exec): ProbeRequest =>
  request(cwd, exec, { laws: [ASTRO_LAW], fixtures: astroFixtures() });

const astroFinding = (cwd: string, message: Record<string, unknown>): string =>
  JSON.stringify([
    {
      filePath: join(realpathSync(cwd), ".web-tops/out/laws-probe/W-97/bad/page.astro"),
      messages: [message],
    },
  ]);

describe("G3b the runner lints Astro twins under the project's own ESLint config", () => {
  it("names each Astro twin after the scratch directory, hardcodes no parser, and does not compile them", async () => {
    const cwd = project();
    const calls: Call[] = [];
    const found = astroFinding(cwd, { ruleId: "astro/no-thing", line: 1, message: "m" });
    const outcome = await runProbe(astroRequest(cwd, fake({ eslintOutput: found }, calls)));
    const scratch = join(".web-tops", "out", "laws-probe");
    expect(nth(calls, 0).args.slice(-3)).toEqual([
      scratch,
      join(scratch, "W-97/bad/page.astro"),
      join(scratch, "W-97/clean/page.astro"),
    ]);
    expect(nth(calls, 0).args).not.toContain("--parser");
    expect(calls.map((call) => toolOf(call.args))).toEqual(["eslint"]);
    expect(outcome).toMatchObject({
      ok: true,
      report: { laws: [{ id: "W-97", verdict: "pass" }] },
    });
  });

  it("an Astro twin with no Astro config is never a silent pass: ESLint ignores it, and the law fails as not evaluated", async () => {
    const cwd = project();
    const ignored = {
      ruleId: null,
      line: 0,
      message: "File ignored because no matching configuration was supplied.",
    };
    const outcome = await runProbe(
      astroRequest(cwd, fake({ eslintOutput: astroFinding(cwd, ignored) }, [])),
    );
    const kinds = outcome.ok ? outcome.report.laws[0]?.failures.map((failure) => failure.kind) : [];
    expect(kinds).toEqual(["not-evaluated", "silent"]);
    expect(outcome).toMatchObject({ ok: true, report: { laws: [{ verdict: "fail" }] } });
  });

  it("an Astro twin that ESLint did not list at all fails as silent, not as a pass", async () => {
    const outcome = await runProbe(astroRequest(project(), fake({ eslintOutput: "[]" }, [])));
    expect(outcome.ok && outcome.report.laws[0]?.verdict).toBe("fail");
  });

  it("compiles the TypeScript twins beside Astro ones, and only those", async () => {
    const cwd = project();
    const calls: Call[] = [];
    const fixtures = astroFixtures();
    put(fixtures, FIXTURES);
    await runProbe(
      request(cwd, fake({ eslintOutput: "[]" }, calls), { laws: [LAW, ASTRO_LAW], fixtures }),
    );
    expect(calls.map((call) => toolOf(call.args))).toEqual(["eslint", "tsc"]);
  });
});

describe("G3b the runner's exact calls, and each law judged on its own twins", () => {
  it("runs ESLint with no config flag at all when the project names none: the flags, the output file, the scratch directory", async () => {
    const cwd = project();
    const calls: Call[] = [];
    await runProbe(request(cwd, fake({ eslintOutput: "[]" }, calls)));
    const output = join(realpathSync(cwd), ".web-tops", "out", "laws-probe", "eslint.json");
    expect(nth(calls, 0).args.slice(1)).toEqual([
      "--no-ignore",
      "--format",
      "json",
      "--output-file",
      output,
      join(".web-tops", "out", "laws-probe"),
    ]);
  });

  it("a law's twins are its own: another law's clean twin does not stand in for one it lacks", async () => {
    const cwd = project();
    const other: ProbeLaw = { id: "W-98", proofs: ["no-thing"] };
    const fixtures = tempDir();
    put(fixtures, {
      "W-99/bad/a.ts": "export const a = 1; // expect: no-thing\n",
      "W-98/bad/a.ts": "export const a = 1; // expect: no-thing\n",
      "W-98/clean/a.ts": "export const a = 1;\n",
    });
    const output = JSON.stringify([
      {
        filePath: join(realpathSync(cwd), ".web-tops/out/laws-probe/W-99/bad/a.ts"),
        messages: [{ ruleId: "p/no-thing", line: 1, message: "m" }],
      },
      {
        filePath: join(realpathSync(cwd), ".web-tops/out/laws-probe/W-98/bad/a.ts"),
        messages: [{ ruleId: "p/no-thing", line: 1, message: "m" }],
      },
    ]);
    const outcome = await runProbe(
      request(cwd, fake({ eslintOutput: output }, []), { laws: [LAW, other], fixtures }),
    );
    const kinds = (id: string): string[] =>
      outcome.ok
        ? (outcome.report.laws
            .find((law) => law.id === id)
            ?.failures.map((failure) => failure.kind) ?? [])
        : [];
    expect(kinds("W-99")).toEqual(["no-clean-twin"]);
    expect(kinds("W-98")).toEqual([]);
  });

  it("a tool that did not run says what it printed, stdout beside stderr", async () => {
    const timeout: ExecResult = {
      code: null,
      stdout: "partial",
      stderr: "late",
      failure: "tool-timeout",
    };
    const outcome = await runProbe(request(project(), fake({ eslint: timeout }, [])));
    expect(!outcome.ok && outcome.problem).toBe("eslint did not run: tool-timeout. late\npartial");
  });
});

const MIXED_LAW: ProbeLaw = { id: "W-96", proofs: ["no-thing", "astro/no-astro"] };

function mixedFixtures(): string {
  const dir = tempDir();
  put(dir, {
    "W-96/bad/a.ts": "export const a = 1; // expect: no-thing\n",
    "W-96/clean/a.ts": "export const a = 1;\n",
    "W-96/bad/page.astro": "<p /> <!-- expect: astro/no-astro -->\n",
    "W-96/clean/page.astro": "<p />\n",
  });
  return dir;
}

const REASON = "the ui-components preset does not lint .astro files";

describe("R105 the runner skips Astro twins a class cannot lint, and says so", () => {
  const mixed = (cwd: string, exec: Exec, extra: Partial<ProbeRequest> = {}): ProbeRequest =>
    request(cwd, exec, { laws: [MIXED_LAW], fixtures: mixedFixtures(), ...extra });

  it("names no Astro twin to ESLint, reports each as skipped with the reason, and passes on the other twins", async () => {
    const cwd = project();
    const calls: Call[] = [];
    const real = join(realpathSync(cwd), ".web-tops/out/laws-probe");
    const found = JSON.stringify([
      {
        filePath: `${real}/W-96/bad/a.ts`,
        messages: [{ ruleId: "p/no-thing", line: 1, message: "m" }],
      },
    ]);
    const outcome = await runProbe(
      mixed(cwd, fake({ eslintOutput: found }, calls), { astroSkip: REASON }),
    );
    expect(nth(calls, 0).args.join(" ")).not.toContain("page.astro");
    expect(outcome).toMatchObject({
      ok: true,
      report: {
        laws: [{ id: "W-96", verdict: "pass", failures: [] }],
        skipped: [
          { file: "W-96/bad/page.astro", reason: REASON },
          { file: "W-96/clean/page.astro", reason: REASON },
        ],
      },
    });
  });

  it("without a reason the Astro twins are linted and proven, and nothing is skipped", async () => {
    const cwd = project();
    const calls: Call[] = [];
    const outcome = await runProbe(mixed(cwd, fake({ eslintOutput: "[]" }, calls)));
    expect(nth(calls, 0).args.join(" ")).toContain("page.astro");
    expect(outcome).toMatchObject({ ok: true, report: { skipped: [] } });
  });

  it("a law whose every twin is Astro is left out, and a probe with no law left is a problem naming why", async () => {
    const cwd = project();
    const outcome = await runProbe(
      request(cwd, fake({ eslintOutput: "[]" }, []), {
        laws: [ASTRO_LAW],
        fixtures: astroFixtures(),
        astroSkip: REASON,
      }),
    );
    expect(outcome).toEqual({
      ok: false,
      code: 2,
      problem: `every twin of the given laws was skipped: ${REASON}`,
    });
  });

  it("a law with only Astro twins is dropped beside a law that has others, and the other is still judged", async () => {
    const cwd = project();
    const fixtures = mixedFixtures();
    put(fixtures, {
      "W-97/bad/page.astro": "<p /> <!-- expect: no-thing -->\n",
      "W-97/clean/page.astro": "<p />\n",
    });
    const outcome = await runProbe(
      request(cwd, fake({ eslintOutput: "[]" }, []), {
        laws: [MIXED_LAW, ASTRO_LAW],
        fixtures,
        astroSkip: REASON,
      }),
    );
    expect(outcome.ok && outcome.report.laws.map((law) => law.id)).toEqual(["W-96"]);
    expect(outcome.ok && outcome.report.skipped.map((twin) => twin.law)).toEqual([
      "W-96",
      "W-96",
      "W-97",
      "W-97",
    ]);
  });
});

describe("R105 the runner keeps each law's twins and each law's skips apart", () => {
  const OTHER: ProbeLaw = { id: "W-95", proofs: ["no-thing", "astro/no-astro"] };

  it("a proof that another law's skipped twin names is still unproven for a law that has no such twin", async () => {
    const cwd = project();
    const fixtures = mixedFixtures();
    put(fixtures, {
      "W-95/bad/a.ts": "export const a = 1; // expect: no-thing\n",
      "W-95/clean/a.ts": "export const a = 1;\n",
    });
    const real = join(realpathSync(cwd), ".web-tops/out/laws-probe");
    const found = JSON.stringify(
      ["W-95", "W-96"].map((id) => ({
        filePath: `${real}/${id}/bad/a.ts`,
        messages: [{ ruleId: "p/no-thing", line: 1, message: "m" }],
      })),
    );
    const outcome = await runProbe(
      request(cwd, fake({ eslintOutput: found }, []), {
        laws: [MIXED_LAW, OTHER],
        fixtures,
        astroSkip: REASON,
      }),
    );
    expect(outcome.ok && outcome.report.laws.map((law) => `${law.id} ${law.verdict}`)).toEqual([
      "W-96 pass",
      "W-95 fail",
    ]);
    expect(outcome.ok && outcome.report.laws[1]?.failures.map((failure) => failure.kind)).toEqual([
      "unproven",
    ]);
  });

  it("a law with no twin of its own has none, even beside a law that has some", async () => {
    const cwd = project();
    const outcome = await runProbe(
      request(cwd, fake({ eslintOutput: "[]" }, []), {
        laws: [LAW, { id: "W-98", proofs: ["no-thing"] }],
      }),
    );
    expect(outcome.ok && outcome.report.laws[1]?.failures.map((failure) => failure.kind)).toEqual([
      "no-bad-twin",
      "no-clean-twin",
      "unproven",
    ]);
  });

  it("no law to probe and nothing skipped is a report with no law, not a problem", async () => {
    const outcome = await runProbe(request(project(), fake({}, []), { laws: [] }));
    expect(outcome).toEqual({ ok: true, report: { laws: [], skipped: [] } });
  });
});
