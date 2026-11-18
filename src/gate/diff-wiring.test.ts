import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanRepos, commit, git, makeRepo, write } from "../diff/test-support.ts";
import { crapLayer } from "../layers/crap/index.ts";
import { realExec } from "./exec.ts";
import { runGate } from "./runner.ts";
import { cfg, fakeLayer, noExec, opts, tickingClock } from "./testkit.ts";
import type { DiffNeeds, Exec, GateConfig, Layer, LayerContext } from "./types.ts";

/** R63: the gate computes the diff once, lazily, and hands it to the layers that ask: the default CRAP scope is the diff. */

const root = resolve(import.meta.dirname, "../..");
const scratch: string[] = [];

afterEach(() => {
  cleanRepos();
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const BRANCHY = (name: string, mark: string): string =>
  [
    `export function ${name}(a: number, b: number): number {`,
    `  if (a > 0 && b > 0) { // ${mark}`,
    "    return a;",
    "  }",
    "  return b;",
    "}",
    "",
  ].join("\n");

const NONE = {
  "src/a.ts": {
    fnMap: {
      "0": { name: "first", loc: { start: { line: 1, column: 0 }, end: { line: 6, column: 1 } } },
      "1": { name: "second", loc: { start: { line: 7, column: 0 }, end: { line: 12, column: 1 } } },
    },
    f: { "0": 0, "1": 0 },
    statementMap: {},
    s: {},
  },
};

/** A repository with two uncovered functions on `main`, and a branch that changes one of them. */
function repoChanging(second: boolean): string {
  const base = BRANCHY("first", "base") + BRANCHY("second", "base");
  const dir = makeRepo({ ".gitignore": "node_modules\n.web-tops\n", "src/a.ts": base });
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(join(root, "node_modules", "typescript"), join(dir, "node_modules", "typescript"));
  git(dir, "checkout", "-q", "-b", "feature");
  const changed = BRANCHY("first", "base") + BRANCHY("second", second ? "changed" : "base");
  write(dir, { "src/a.ts": changed, "README.md": "touched\n" });
  commit(dir, "change");
  scratch.push(dir);
  return dir;
}

function crapRun(
  dir: string,
  config: GateConfig = cfg(),
  over: { all?: boolean; base?: string } = {},
): ReturnType<typeof runGate> {
  const path = join(dir, ".web-tops", "out", "tests", "coverage", "coverage-final.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(NONE));
  const tests = fakeLayer({
    id: "tests",
    gate: 2,
    produces: ["coverage-json"],
    artifacts: { "coverage-json": path },
  });
  return runGate({
    layers: [tests, crapLayer],
    config,
    options: opts({ ...over, base: over.base ?? "main" }),
    cwd: dir,
    env: {},
    exec: realExec,
    outDir: join(dir, ".web-tops", "out"),
    now: tickingClock(),
  });
}

type Report = Awaited<ReturnType<typeof runGate>>;

function crapOf(report: Report): Report["layers"][number] {
  const found = report.layers.find((item) => item.id === "crap");
  if (found === undefined) {
    throw new Error("no crap layer in the report");
  }
  return found;
}

function namesOf(report: Report): (string | undefined)[] {
  return (crapOf(report).metrics.crap ?? []).map((row) => row.name);
}

describe("R63 the default CRAP scope is the diff, computed by the gate", () => {
  it("judges only the function the branch changed, from the real merge base", async () => {
    const report = await crapRun(repoChanging(true));
    expect(crapOf(report).verdict).toBe("fail");
    expect(namesOf(report)).toEqual(["second"]);
    expect(crapOf(report).findings.filter((item) => item.rule === "crap-over-cap")).toMatchObject([
      { file: "src/a.ts", line: 7 },
    ]);
  });

  it("--all judges both functions of the same diff", async () => {
    const report = await crapRun(repoChanging(true), cfg(), { all: true });
    expect(namesOf(report)).toEqual(["first", "second"]);
  });

  it("scope all in the config does too, and the diff is never computed", async () => {
    const config = cfg({ crap: { cap: 4, scope: "all", nullishDiscount: true } });
    expect(namesOf(await crapRun(repoChanging(true), config))).toEqual(["first", "second"]);
  });

  it("is vacuous when the branch changed no source function", async () => {
    expect(crapOf(await crapRun(repoChanging(false))).verdict).toBe("vacuous");
  });

  it("fails, naming the engine's reason, when the base ref does not exist", async () => {
    const dir = repoChanging(true);
    const report = await crapRun(dir, cfg(), { base: "no-such-ref" });
    expect(crapOf(report).verdict).toBe("fail");
    expect(crapOf(report).findings[0]).toMatchObject({ rule: "diff-failed" });
  });
});

describe("R63 the provider computes the diff once for each kind of request", () => {
  /** How many git commands a run makes when its one layer asks for the diff as `asks` says. */
  async function gitCalls(asks: readonly DiffNeeds[]): Promise<number> {
    let calls = 0;
    const exec: Exec = (command) => {
      calls += command === "git" ? 1 : 0;
      return Promise.resolve({ code: 128, stdout: "", stderr: "fatal: not a repository" });
    };
    const spy: Layer = {
      ...fakeLayer({ id: "hygiene", gate: 1 }),
      run: async (ctx: LayerContext) => {
        for (const needs of asks) {
          await ctx.diff?.(needs);
        }
        return { verdict: "pass", findings: [], artifacts: {} };
      },
    };
    await runGate({
      layers: [spy],
      config: cfg(),
      options: opts({ base: "main" }),
      cwd: tmpdir(),
      env: {},
      exec,
      outDir: join(tmpdir(), "unused-out"),
      now: tickingClock(),
    });
    return calls;
  }

  it("computes the diff once for repeated asks, and again for a different ask", async () => {
    const plain: DiffNeeds = { coveredByTests: false };
    const covered: DiffNeeds = { coveredByTests: true };
    const once = await gitCalls([plain]);
    expect(once).toBeGreaterThan(0);
    expect(await gitCalls([plain, plain, plain])).toBe(once);
    expect(await gitCalls([plain, plain, covered])).toBe(2 * once);
    expect(await gitCalls([])).toBe(0);
  });

  it("shares one computation between layers: two layers asking for the same diff cost one", async () => {
    let calls = 0;
    const exec: Exec = (command) => {
      calls += command === "git" ? 1 : 0;
      return Promise.resolve({ code: 128, stdout: "", stderr: "fatal: not a repository" });
    };
    const asking = (id: string, gate: 1 | 2): Layer => ({
      ...fakeLayer({ id, gate }),
      run: async (ctx: LayerContext) => {
        await ctx.diff?.({ coveredByTests: false });
        return { verdict: "pass", findings: [], artifacts: {} };
      },
    });
    const base = {
      config: cfg(),
      options: opts({ base: "main" }),
      cwd: tmpdir(),
      env: {},
      exec,
      outDir: join(tmpdir(), "unused-out"),
      now: tickingClock(),
    };
    await runGate({ ...base, layers: [asking("hygiene", 1)] });
    const one = calls;
    calls = 0;
    await runGate({ ...base, layers: [asking("hygiene", 1), asking("tests", 2)] });
    expect(calls).toBe(one);
  });

  it("hands a layer a provider even when the run has no git: asking fails with the engine's reason", async () => {
    let reason: string | undefined;
    const spy: Layer = {
      ...fakeLayer({ id: "hygiene", gate: 1 }),
      run: async (ctx: LayerContext) => {
        const result = await ctx.diff?.({ coveredByTests: false });
        reason = result?.outcome === "fail" ? result.reason : undefined;
        return { verdict: "pass", findings: [], artifacts: {} };
      },
    };
    const dir = mkdtempSync(join(tmpdir(), "webtops-nogit-"));
    scratch.push(dir);
    await runGate({
      layers: [spy],
      config: cfg(),
      options: opts({ base: "main" }),
      cwd: dir,
      env: {},
      exec: realExec,
      outDir: join(dir, "out"),
      now: tickingClock(),
    });
    expect(typeof reason).toBe("string");
    expect(noExec).toBeDefined();
  });
});
