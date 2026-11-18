import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DiffScope, ScopeResult } from "../../diff/index.ts";
import { writeBaselineFile } from "../../baseline/test-support.ts";
import { cfg } from "../../gate/testkit.ts";
import type {
  DiffNeeds,
  DiffProvider,
  Exec,
  ExecResult,
  GateConfig,
  LayerContext,
} from "../../gate/types.ts";
import type { RawFinding } from "../../report/findings.ts";
import { keyString } from "../../survivors/key.ts";
import { mutationLayer } from "./index.ts";

/** G7a to G7c: the mutation layer runs Stryker on the gate's Vitest wrapper and judges its report (WEB_TOPS.md section 6.4). */

const root = resolve(import.meta.dirname, "../../..");
const probe = resolve(root, "fixtures/probe");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function put(dir: string, file: string, text: string): void {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
}

function recorded(id: string): string {
  return readFileSync(resolve(probe, id, "recorded/mutation.json"), "utf8");
}

function sourceOf(id: string, file: string): string {
  return readFileSync(resolve(probe, id, file), "utf8");
}

function mutationConfig(over: Partial<GateConfig["mutation"]> = {}): GateConfig {
  return cfg({ mutation: { scope: "all", maxSurvivors: 0, timeBudgetMinutes: 30, ...over } });
}

interface Run {
  readonly calls: { command: string; args: readonly string[]; timeoutMs: number | undefined }[];
  readonly exec: Exec;
}

/** Writes `report` where the generated config says Stryker would. */
function writeReport(
  cwd: string | undefined,
  config: string | undefined,
  report: string | undefined,
): void {
  if (report === undefined || cwd === undefined || config === undefined) {
    return;
  }
  const written: unknown = JSON.parse(readFileSync(join(cwd, config), "utf8"));
  const reporter: unknown = Reflect.get(Object(written), "jsonReporter");
  put(cwd, String(Reflect.get(Object(reporter), "fileName")), report);
}

/** The Stryker config the layer generated for the run, as the fake Stryker read it. */
function generated(dir: string, run: Run): unknown {
  const started = run.calls.find((call) => call.command === "node");
  const config: unknown = JSON.parse(readFileSync(join(dir, started?.args.at(-1) ?? ""), "utf8"));
  return config;
}

/** An exec that lists tracked files and, for Stryker, writes `report` where the config says and answers `result`. */
function fakeExec(
  files: readonly string[],
  report: string | undefined,
  result: ExecResult = { code: 0, stdout: "", stderr: "" },
): Run {
  const calls: Run["calls"] = [];
  const exec: Exec = (command, args, options) => {
    calls.push({ command, args, timeoutMs: options?.timeoutMs });
    if (command === "git") {
      return Promise.resolve({
        code: 0,
        stdout: files.map((file) => `${file}\0`).join(""),
        stderr: "",
      });
    }
    writeReport(options?.cwd, args.at(-1), report);
    return Promise.resolve(result);
  };
  return { calls, exec };
}

/** A project with the probe's sources, TypeScript, and (unless `strykerInstalled` is false) a Stryker the layer can resolve. */
function project(id: string, files: readonly string[], strykerInstalled = true): string {
  const dir = mkdtempSync(join(tmpdir(), "webtops-mutation-"));
  dirs.push(dir);
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  symlinkSync(join(root, "node_modules", "typescript"), join(dir, "node_modules", "typescript"));
  if (strykerInstalled) {
    put(
      dir,
      "node_modules/@stryker-mutator/core/package.json",
      JSON.stringify({ name: "@stryker-mutator/core", bin: { stryker: "bin/stryker.js" } }),
    );
    put(dir, "node_modules/@stryker-mutator/core/bin/stryker.js", "");
  }
  for (const file of files) {
    put(dir, file, sourceOf(id, file));
  }
  put(dir, ".web-tops/out/tests/vitest.config.mjs", "export default {};\n");
  return dir;
}

function contextFor(dir: string, exec: Exec, over: Partial<LayerContext> = {}): LayerContext {
  return {
    cwd: dir,
    config: mutationConfig(),
    base: "origin/main",
    enforce: "hard",
    env: {},
    exec,
    outDir: join(dir, ".web-tops", "out"),
    artifacts: new Map([["vitest-config", join(dir, ".web-tops/out/tests/vitest.config.mjs")]]),
    ...over,
  };
}

const NO_KEY = {
  file: "",
  function: "",
  mutator: "",
  original: "",
  replacement: "",
  occurrence: 0,
};
const keyOf = (item: RawFinding): string => keyString(item.survivor ?? NO_KEY);

const PRICE = ["src/price.ts"];
const NO_COVERAGE = "no-coverage-survivors";

describe("G7a the layer runs Stryker on the gate's wrapper and reads its report", () => {
  it("fails a project whose tests leave the six mutants of an unrun function NoCoverage, one finding each", async () => {
    const dir = project(NO_COVERAGE, PRICE);
    const run = fakeExec(PRICE, recorded(NO_COVERAGE));
    const result = await mutationLayer.run(contextFor(dir, run.exec));
    expect(result.verdict).toBe("fail");
    const survivors = result.findings.filter((item) => item.rule === "no-coverage");
    expect(survivors).toHaveLength(6);
    expect(survivors[0]).toMatchObject({ tool: "stryker", verdict: "fail", file: "src/price.ts" });
    expect(survivors[0]?.survivor).toMatchObject({
      file: "src/price.ts",
      function: "src/price.ts::untested",
      occurrence: 1,
    });
    expect(new Set(survivors.map(keyOf)).size).toBe(6);
  });

  it("reports a count for each Stryker status in its metrics and in its message (R75)", async () => {
    const dir = project(NO_COVERAGE, PRICE);
    const result = await mutationLayer.run(
      contextFor(dir, fakeExec(PRICE, recorded(NO_COVERAGE)).exec),
    );
    expect(result.metrics).toEqual({
      mutation: {
        killed: 8,
        timeout: 0,
        survived: 0,
        no_coverage: 6,
        runtime_error: 0,
        compile_error: 2,
        ignored: 0,
      },
    });
    const said = result.findings.find((item) => item.rule === "mutation")?.message ?? "";
    expect(said).toContain(
      "killed 8, timeout 0, survived 0, no-coverage 6, runtime-error 0, compile-error 2, ignored 0",
    );
  });

  it("carries no metrics when there is no report to count", async () => {
    const dir = project(NO_COVERAGE, PRICE);
    const result = await mutationLayer.run(contextFor(dir, fakeExec(PRICE, undefined).exec));
    expect(result.metrics).toBeUndefined();
  });

  it("starts Stryker from node_modules under node, with the generated config and the gate's wrapper", async () => {
    const dir = project(NO_COVERAGE, PRICE);
    const run = fakeExec(PRICE, recorded(NO_COVERAGE));
    await mutationLayer.run(contextFor(dir, run.exec));
    const started = run.calls.find((call) => call.command === "node");
    expect(started?.args[0]).toBe(join(dir, "node_modules/@stryker-mutator/core/bin/stryker.js"));
    expect(started?.args.slice(1, 2)).toEqual(["run"]);
    expect(generated(dir, run)).toMatchObject({
      vitest: { configFile: ".web-tops/out/tests/vitest.config.mjs" },
      mutate: ["src/price.ts", "!**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    });
  });

  it("passes when the unexplained survivors are at or under the profile's maximum, and says so", async () => {
    const dir = project(NO_COVERAGE, PRICE);
    const run = fakeExec(PRICE, recorded(NO_COVERAGE));
    const result = await mutationLayer.run(
      contextFor(dir, run.exec, { config: mutationConfig({ maxSurvivors: 6 }) }),
    );
    expect(result.verdict).toBe("pass");
    expect(
      result.findings
        .filter((item) => item.rule === "no-coverage")
        .every((item) => item.verdict === "pass"),
    ).toBe(true);
    expect(result.findings.find((item) => item.rule === "mutation")?.message).toContain(
      "6 unexplained",
    );
  });

  it("fails one unexplained survivor over the maximum, and passes at it", async () => {
    const dir = project(NO_COVERAGE, PRICE);
    const over = await mutationLayer.run(
      contextFor(dir, fakeExec(PRICE, recorded(NO_COVERAGE)).exec, {
        config: mutationConfig({ maxSurvivors: 5 }),
      }),
    );
    expect(over.verdict).toBe("fail");
    expect(over.findings.filter((item) => item.verdict === "fail")).toHaveLength(6);
    const at = await mutationLayer.run(
      contextFor(dir, fakeExec(PRICE, recorded(NO_COVERAGE)).exec, {
        config: mutationConfig({ maxSurvivors: 6 }),
      }),
    );
    expect(at.verdict).toBe("pass");
  });

  it("passes a report with no survivor, and the Ignored mutants of a Stryker disable are not survivors", async () => {
    const dir = project("stryker-disable", ["src/clamp.ts"]);
    const run = fakeExec(["src/clamp.ts"], recorded("stryker-disable"));
    const result = await mutationLayer.run(contextFor(dir, run.exec));
    expect(result.verdict).toBe("pass");
    expect(
      result.findings.some((item) => item.rule === "no-coverage" || item.rule === "survived"),
    ).toBe(false);
  });

  it("is vacuous when every mutant was excluded: nothing was judged, so nothing passed", async () => {
    const dir = project(NO_COVERAGE, PRICE);
    const report = recorded(NO_COVERAGE)
      .replaceAll('"status": "NoCoverage"', '"status": "CompileError"')
      .replaceAll('"status": "Killed"', '"status": "CompileError"');
    const result = await mutationLayer.run(contextFor(dir, fakeExec(PRICE, report).exec));
    expect(result.verdict).toBe("vacuous");
    expect(result.reason).toContain("no mutant was judged");
  });

  it("names a Survived mutant by its own rule", async () => {
    const dir = project("assertion-free-test", ["src/total.ts"]);
    const run = fakeExec(["src/total.ts"], recorded("assertion-free-test"));
    const result = await mutationLayer.run(contextFor(dir, run.exec));
    expect(result.verdict).toBe("fail");
    expect(result.findings.filter((item) => item.rule === "survived")).toHaveLength(2);
  });

  it("leaves out a survivor the ledger explains, and counts only the rest against the maximum", async () => {
    const dir = project(NO_COVERAGE, PRICE);
    const run = fakeExec(PRICE, recorded(NO_COVERAGE));
    const first = await mutationLayer.run(contextFor(dir, run.exec));
    const key = first.findings.find((item) => item.survivor !== undefined)?.survivor;
    const explained = new Set(key === undefined ? [] : [keyString(key)]);
    const second = await mutationLayer.run(
      contextFor(dir, fakeExec(PRICE, recorded(NO_COVERAGE)).exec, {
        explained,
        config: mutationConfig({ maxSurvivors: 5 }),
      }),
    );
    expect(second.findings.filter((item) => item.rule === "no-coverage")).toHaveLength(5);
    expect(second.verdict).toBe("pass");
    const accepted = second.findings.filter((item) => item.rule === "explained");
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ verdict: "pass", survivor: key });
    expect(accepted[0]?.message).toContain("is accepted in the survivor ledger");
  });
});

describe("G7b over the time budget is not-evaluated, never a pass", () => {
  it("kills Stryker at the budget and says so, naming the budget", async () => {
    const dir = project(NO_COVERAGE, PRICE);
    const run = fakeExec(PRICE, undefined, {
      code: null,
      stdout: "",
      stderr: "",
      failure: "tool-timeout",
    });
    const result = await mutationLayer.run(
      contextFor(dir, run.exec, { config: mutationConfig({ timeBudgetMinutes: 12 }) }),
    );
    expect(result.verdict).toBe("not-evaluated");
    expect(result.reason).toContain("12 minutes");
    expect(run.calls.find((call) => call.command === "node")?.timeoutMs).toBe(12 * 60 * 1000);
  });

  it("is the profile's budget by default: 30 minutes", async () => {
    const dir = project(NO_COVERAGE, PRICE);
    const run = fakeExec(PRICE, recorded(NO_COVERAGE));
    await mutationLayer.run(
      contextFor(dir, run.exec, {
        config: cfg({ mutation: { scope: "all", maxSurvivors: 0, timeBudgetMinutes: 30 } }),
      }),
    );
    expect(run.calls.find((call) => call.command === "node")?.timeoutMs).toBe(30 * 60 * 1000);
  });
});

describe("G7a what cannot be judged fails, and says why", () => {
  it("fails with tool-missing when Stryker is not installed, and starts nothing", async () => {
    const dir = project(NO_COVERAGE, PRICE, false);
    const run = fakeExec(PRICE, recorded(NO_COVERAGE));
    const result = await mutationLayer.run(contextFor(dir, run.exec));
    expect(result.verdict).toBe("fail");
    expect(result.findings[0]).toMatchObject({ rule: "tool-missing", tool: "stryker" });
    expect(run.calls.some((call) => call.command === "node")).toBe(false);
  });

  it("fails with the output when Stryker exits non-zero and wrote no report", async () => {
    const dir = project(NO_COVERAGE, PRICE);
    const run = fakeExec(PRICE, undefined, { code: 1, stdout: "", stderr: "dry run failed: boom" });
    const result = await mutationLayer.run(contextFor(dir, run.exec));
    expect(result.verdict).toBe("fail");
    expect(result.findings[0]?.rule).toBe("stryker-failed");
    expect(result.findings[0]?.message).toContain("boom");
  });

  it("fails output-empty when Stryker exits 0 and wrote no report, and output-unparseable for a report that is not one", async () => {
    const dir = project(NO_COVERAGE, PRICE);
    const empty = await mutationLayer.run(contextFor(dir, fakeExec(PRICE, undefined).exec));
    expect(empty.findings[0]?.rule).toBe("output-empty");
    const bad = await mutationLayer.run(contextFor(dir, fakeExec(PRICE, "not json").exec));
    expect(bad.findings[0]?.rule).toBe("output-unparseable");
    const shape = await mutationLayer.run(contextFor(dir, fakeExec(PRICE, "{}").exec));
    expect(shape.findings[0]?.rule).toBe("output-unparseable");
  });

  it("fails a status the table does not list, naming it, and never counts it", async () => {
    const dir = project(NO_COVERAGE, PRICE);
    const report = recorded(NO_COVERAGE).replaceAll(
      '"status": "NoCoverage"',
      '"status": "Mystery"',
    );
    const result = await mutationLayer.run(
      contextFor(dir, fakeExec(PRICE, report).exec, {
        config: mutationConfig({ maxSurvivors: 99 }),
      }),
    );
    expect(result.verdict).toBe("fail");
    expect(result.findings.find((item) => item.rule === "unknown-status")?.message).toContain(
      "Mystery",
    );
  });

  it("fails when TypeScript is not in the project, and when the coverage-less wrapper was not handed over", async () => {
    const bare = mkdtempSync(join(tmpdir(), "webtops-bare-"));
    dirs.push(bare);
    const result = await mutationLayer.run(
      contextFor(bare, fakeExec(PRICE, recorded(NO_COVERAGE)).exec),
    );
    expect(result.findings[0]?.rule).toBe("typescript-missing");
    const dir = project(NO_COVERAGE, PRICE);
    await expect(
      mutationLayer.run(contextFor(dir, fakeExec(PRICE, "").exec, { artifacts: new Map() })),
    ).rejects.toThrow("vitest-config input was not handed over");
  });

  it("under ratchet passes a clean run, and still fails over the maximum, with or without a baseline: survivors are judged against the ledger only", async () => {
    const dir = project("stryker-disable", ["src/clamp.ts"]);
    const clean = await mutationLayer.run(
      contextFor(dir, fakeExec(["src/clamp.ts"], recorded("stryker-disable")).exec, {
        enforce: "ratchet",
      }),
    );
    expect(clean.verdict).toBe("pass");
    for (const held of [false, true]) {
      const over = project(NO_COVERAGE, PRICE);
      const context = contextFor(over, fakeExec(PRICE, recorded(NO_COVERAGE)).exec, {
        enforce: "ratchet",
        config: { ...mutationConfig(), ...(held ? { baselinePath: "baseline.json" } : {}) },
      });
      if (held) writeBaselineFile(context.cwd);
      expect((await mutationLayer.run(context)).verdict).toBe("fail");
    }
  });
});

/** The diff engine's result for a diff whose mutate entries are `entries`. */
function scopeOf(...entries: string[]): Extract<ScopeResult, { outcome: "scope" }> {
  const scope: DiffScope = {
    mergeBase: "0123456789abcdef0123456789abcdef01234567",
    files: [],
    changedFunctions: [],
    testFiles: [],
    coveredFunctions: [],
    mutate: entries,
  };
  return { outcome: "scope", scope };
}

function provider(result: ScopeResult): { diff: DiffProvider; asked: DiffNeeds[] } {
  const asked: DiffNeeds[] = [];
  return { asked, diff: (needs) => (asked.push(needs), Promise.resolve(result)) };
}

describe("G7a scope: the diff's ranges snapped to whole functions, or every file (R64)", () => {
  const diffConfig = mutationConfig({ scope: "diff" });

  function mutateOf(dir: string, run: Run): unknown {
    return Reflect.get(Object(generated(dir, run)), "mutate");
  }

  it("asks for the diff with the functions the changed tests cover, and mutates the changed function whole", async () => {
    const dir = project(NO_COVERAGE, PRICE);
    const run = fakeExec(PRICE, recorded(NO_COVERAGE));
    const { diff, asked } = provider(scopeOf("src/price.ts:2-2"));
    await mutationLayer.run(contextFor(dir, run.exec, { config: diffConfig, diff }));
    expect(asked).toEqual([{ coveredByTests: true }]);
    expect(mutateOf(dir, run)).toEqual(["src/price.ts:1-6", "!**/*.{test,spec}.?(c|m)[jt]s?(x)"]);
  });

  it("is vacuous when the diff has nothing to mutate, and fails with the engine's reason when it cannot be computed", async () => {
    const dir = project(NO_COVERAGE, PRICE);
    const vacuous = await mutationLayer.run(
      contextFor(dir, fakeExec(PRICE, recorded(NO_COVERAGE)).exec, {
        config: diffConfig,
        diff: provider({
          outcome: "vacuous",
          reason: "no changed source line",
          scope: scopeOf().scope,
        }).diff,
      }),
    );
    expect(vacuous.verdict).toBe("vacuous");
    const failed = await mutationLayer.run(
      contextFor(dir, fakeExec(PRICE, recorded(NO_COVERAGE)).exec, {
        config: diffConfig,
        diff: provider({ outcome: "fail", reason: "shallow clone" }).diff,
      }),
    );
    expect(failed.verdict).toBe("fail");
    expect(failed.findings[0]).toMatchObject({ rule: "diff-failed" });
    expect(failed.findings[0]?.message).toContain("shallow clone");
  });

  it("--all and scope all mutate every tracked file in scope, and never ask for the diff", async () => {
    const dir = project(NO_COVERAGE, PRICE);
    put(dir, "src/price.test.ts", "export {};\n");
    const run = fakeExec([...PRICE, "src/price.test.ts", "README.md"], recorded(NO_COVERAGE));
    const { diff, asked } = provider(scopeOf("src/price.ts:2-2"));
    await mutationLayer.run(contextFor(dir, run.exec, { config: diffConfig, diff, all: true }));
    expect(asked).toEqual([]);
    expect(mutateOf(dir, run)).toEqual(["src/price.ts", "!**/*.{test,spec}.?(c|m)[jt]s?(x)"]);
  });

  it("is vacuous over a project with no tracked source file", async () => {
    const dir = project(NO_COVERAGE, []);
    const result = await mutationLayer.run(
      contextFor(dir, fakeExec(["README.md"], recorded(NO_COVERAGE)).exec),
    );
    expect(result.verdict).toBe("vacuous");
  });
});

describe("G7 the layer's declaration", () => {
  it("is gate 5, requires the tests layer, consumes the gate's Vitest wrapper and produces nothing", () => {
    expect(mutationLayer).toMatchObject({
      id: "mutation",
      gate: 5,
      tier: 1,
      requires: ["tests"],
      produces: [],
      consumes: [{ artifact: "vitest-config", from: "tests" }],
    });
  });
});
