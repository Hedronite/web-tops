import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { at, get } from "../../config/test-support.ts";
import { cfg } from "../../gate/testkit.ts";
import type { ScopeResult } from "../../diff/index.ts";
import type { DiffNeeds, DiffProvider, Exec, GateConfig, LayerContext } from "../../gate/types.ts";
import { crapLayer } from "./index.ts";

/** G4a to G4c: the CRAP layer judges every function in scope against the cap (WEB_TOPS.md section 6.2). */

const root = resolve(import.meta.dirname, "../../..");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tracked(...files: string[]): Exec {
  return () =>
    Promise.resolve({ code: 0, stdout: files.map((file) => `${file}\0`).join(""), stderr: "" });
}

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "webtops-crap-"));
  dirs.push(dir);
  return dir;
}

function crapConfig(over: Partial<GateConfig["crap"]> = {}): GateConfig {
  return cfg({ crap: { cap: 4, scope: "all", nullishDiscount: true, ...over } });
}

function write(dir: string, file: string, text: string): void {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
}

function contextIn(
  cwd: string,
  coverage: string,
  files: readonly string[],
  over: Partial<LayerContext> = {},
): LayerContext {
  return {
    cwd,
    config: crapConfig(),
    base: "origin/main",
    enforce: "hard",
    env: {},
    exec: tracked(...files),
    outDir: scratch(),
    artifacts: new Map([["coverage-json", coverage]]),
    ...over,
  };
}

/** A project holding `files` and a coverage map for them; returns the context to run the layer in. */
function project(
  files: Readonly<Record<string, string>>,
  coverage: unknown,
  over: Partial<LayerContext> = {},
): LayerContext {
  const dir = scratch();
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(join(root, "node_modules", "typescript"), join(dir, "node_modules", "typescript"));
  for (const [file, text] of Object.entries(files)) {
    write(dir, file, text);
  }
  const path = join(dir, ".web-tops", "out", "tests", "coverage", "coverage-final.json");
  write(dir, ".web-tops/out/tests/coverage/coverage-final.json", JSON.stringify(coverage));
  return contextIn(dir, path, Object.keys(files), over);
}

const BRANCHY = [
  "export function pick(a: number, b: number): number {", // 1
  "  if (a > 0 && b > 0) {", // 2
  "    return a;", // 3
  "  }", // 4
  "  return b;", // 5
  "}", // 6
  "",
].join("\n");

const FULL = {
  "src/a.ts": {
    fnMap: {
      "0": { name: "pick", loc: { start: { line: 1, column: 0 }, end: { line: 6, column: 1 } } },
    },
    f: { "0": 2 },
    statementMap: {
      "0": { start: { line: 2, column: 2 }, end: { line: 2, column: 24 } },
      "1": { start: { line: 3, column: 4 }, end: { line: 3, column: 13 } },
      "2": { start: { line: 5, column: 2 }, end: { line: 5, column: 11 } },
    },
    s: { "0": 1, "1": 1, "2": 1 },
  },
};

const NONE = {
  "src/a.ts": { ...FULL["src/a.ts"], f: { "0": 0 }, s: { "0": 0, "1": 0, "2": 0 } },
};

describe("G4a the layer fails a function over the cap, with its CRAP and its place", () => {
  it("passes a function at the cap: complexity 3 fully covered scores 3, under a cap of 4", async () => {
    const result = await crapLayer.run(project({ "src/a.ts": BRANCHY }, FULL));
    expect(result.verdict).toBe("pass");
    expect(result.metrics?.crap).toEqual([
      { file: "src/a.ts", name: "pick", line: 1, complexity: 3, coverage: 1, crap: 3 },
    ]);
  });

  it("fails the same function when no test ran it: 9 * 1 + 3 = 12, over 4", async () => {
    const result = await crapLayer.run(project({ "src/a.ts": BRANCHY }, NONE));
    expect(result.verdict).toBe("fail");
    const finding = result.findings.find((item) => item.rule === "crap-over-cap");
    expect(finding).toMatchObject({ tool: "webtops", verdict: "fail", file: "src/a.ts", line: 1 });
    expect(finding?.message).toContain("12");
    expect(finding?.message).toContain("cap of 4");
    expect(finding?.message).toContain("pick");
  });

  it("is judged against the cap the config carries, exactly: a CRAP equal to the cap passes", async () => {
    const equal = await crapLayer.run(
      project({ "src/a.ts": BRANCHY }, FULL, { config: crapConfig({ cap: 3 }) }),
    );
    expect(equal.verdict).toBe("pass");
    const under = await crapLayer.run(
      project({ "src/a.ts": BRANCHY }, FULL, { config: crapConfig({ cap: 2.99 }) }),
    );
    expect(under.verdict).toBe("fail");
  });

  it("reports one finding for each function over the cap, and a pass summary naming the package", async () => {
    const two = `${BRANCHY}${BRANCHY.replace("pick", "again")}`;
    const result = await crapLayer.run(project({ "src/a.ts": two }, NONE));
    expect(result.findings.filter((item) => item.rule === "crap-over-cap")).toHaveLength(2);
    const ok = await crapLayer.run(project({ "src/a.ts": BRANCHY }, FULL));
    expect(ok.findings.find((item) => item.rule === "crap")?.message).toContain("fixture:");
  });

  it("scores only the tracked files in scope: not a test file, not an untracked one", async () => {
    const context = project(
      { "src/a.ts": BRANCHY, "src/a.test.ts": BRANCHY, "src/untracked.ts": BRANCHY },
      NONE,
    );
    const result = await crapLayer.run({ ...context, exec: tracked("src/a.ts", "src/a.test.ts") });
    expect(result.metrics?.crap?.map((row) => row.file)).toEqual(["src/a.ts"]);
  });
});

describe("G4a the nullish rule of section 6.3 reaches the counter", () => {
  const NULLISH = [
    "export function pick(a?: { b?: number }, c?: number): number {", // 1
    "  return a?.b ?? c ?? 0;", // 2
    "}", // 3
    "",
  ].join("\n");
  const covered = {
    "src/a.ts": {
      fnMap: {
        "0": { name: "pick", loc: { start: { line: 1, column: 0 }, end: { line: 3, column: 1 } } },
      },
      f: { "0": 1 },
      statementMap: { "0": { start: { line: 2, column: 2 }, end: { line: 2, column: 24 } } },
      s: { "0": 1 },
    },
  };

  it("weighs ?. and ?? at 0 by default, and at 1 when the config turns the discount off", async () => {
    const discounted = await crapLayer.run(project({ "src/a.ts": NULLISH }, covered));
    expect(discounted.metrics?.crap).toMatchObject([{ complexity: 1 }]);
    const counted = await crapLayer.run(
      project({ "src/a.ts": NULLISH }, covered, { config: crapConfig({ nullishDiscount: false }) }),
    );
    expect(counted.metrics?.crap).toMatchObject([{ complexity: 4 }]);
  });
});

describe("G4a E2 through the layer, as EXPECTED.yaml states it", () => {
  const id = "e2-one-line-arrow";

  function stated(): unknown {
    const expected: unknown = parse(
      readFileSync(resolve(root, "fixtures/probe/EXPECTED.yaml"), "utf8"),
    );
    const cases = get(expected, "cases");
    return Array.isArray(cases) ? cases.find((item) => get(item, "id") === id) : undefined;
  }

  it("fails the arrow at CRAP 20 under the cap of 4", async () => {
    const dir = resolve(root, "fixtures/probe", id);
    const context = contextIn(dir, resolve(dir, "recorded/coverage-final.json"), [
      "src/sign.ts",
      "src/sign.test.ts",
    ]);
    const result = await crapLayer.run(context);
    expect(result.verdict).toBe(at(stated(), ["outcome", "verdicts", "crap"]));
    expect(result.metrics?.crap).toMatchObject([
      {
        file: "src/sign.ts",
        name: "sign",
        complexity: 4,
        coverage: 0,
        crap: at(stated(), ["outcome", "crap"]),
      },
    ]);
  });
});

/** The diff engine's result for a diff that changed `functions` of src/a.ts (G6's ScopeResult). */
function changedIn(
  ...functions: readonly [number, number][]
): Extract<ScopeResult, { outcome: "scope" }> {
  return {
    outcome: "scope",
    scope: {
      mergeBase: "0123456789abcdef0123456789abcdef01234567",
      files: [],
      changedFunctions: functions.map(([start, end]) => ({
        key: `src/a.ts::f${String(start)}`,
        path: "src/a.ts",
        start,
        end,
      })),
      testFiles: [],
      coveredFunctions: [],
      mutate: functions.map(([start, end]) => `src/a.ts:${String(start)}-${String(end)}`),
    },
  };
}

/** A diff provider that answers `result` and records what the layer asked for. */
function provider(result: ScopeResult): { diff: DiffProvider; asked: DiffNeeds[] } {
  const asked: DiffNeeds[] = [];
  return {
    asked,
    diff: (needs) => {
      asked.push(needs);
      return Promise.resolve(result);
    },
  };
}

describe("G4b scope: the diff, --all, and the provider the gate wires in (R63)", () => {
  const TWO = `${BRANCHY}${BRANCHY.replace("pick", "again")}`;
  const diffConfig = crapConfig({ scope: "diff" });

  it("judges only the functions the diff changed under scope diff", async () => {
    const { diff, asked } = provider(changedIn([7, 12]));
    const result = await crapLayer.run(
      project({ "src/a.ts": TWO }, NONE, { config: diffConfig, diff }),
    );
    expect(result.metrics?.crap?.map((row) => row.name)).toEqual(["again"]);
    expect(result.findings.filter((item) => item.rule === "crap-over-cap")).toHaveLength(1);
    expect(asked).toEqual([{ coveredByTests: false }]);
  });

  it("passes when the changed function is fine and an unchanged one is over the cap", async () => {
    const { diff } = provider(changedIn([1, 6]));
    const mixed = { "src/a.ts": { ...FULL["src/a.ts"] } };
    const result = await crapLayer.run(
      project({ "src/a.ts": TWO }, mixed, { config: diffConfig, diff }),
    );
    expect(result.verdict).toBe("pass");
  });

  it("is vacuous, never a pass, when the diff changed no function, or the engine says vacuous", async () => {
    const none = provider(changedIn());
    const empty = await crapLayer.run(
      project({ "src/a.ts": BRANCHY }, NONE, { config: diffConfig, diff: none.diff }),
    );
    expect(empty.verdict).toBe("vacuous");
    expect(empty.reason).toContain("no function");
    const stated = provider({
      outcome: "vacuous",
      reason: "no changed source line",
      scope: { ...changedIn().scope },
    });
    const vacuous = await crapLayer.run(
      project({ "src/a.ts": BRANCHY }, NONE, { config: diffConfig, diff: stated.diff }),
    );
    expect(vacuous.verdict).toBe("vacuous");
  });

  it("fails when the diff cannot be computed, with the engine's reason, and judges nothing", async () => {
    const { diff } = provider({ outcome: "fail", reason: "no merge base with origin/main" });
    const result = await crapLayer.run(
      project({ "src/a.ts": TWO }, NONE, { config: diffConfig, diff }),
    );
    expect(result.verdict).toBe("fail");
    expect(result.findings[0]).toMatchObject({ rule: "diff-failed", verdict: "fail" });
    expect(result.findings[0]?.message).toContain("no merge base with origin/main");
    expect(result.metrics).toBeUndefined();
  });

  it("does not ask for the diff under --all or scope all: it judges every function", async () => {
    const { diff, asked } = provider(changedIn([7, 12]));
    const withFlag = await crapLayer.run(
      project({ "src/a.ts": TWO }, NONE, { config: diffConfig, diff, all: true }),
    );
    expect(withFlag.metrics?.crap).toHaveLength(2);
    const byConfig = await crapLayer.run(project({ "src/a.ts": TWO }, NONE, { diff }));
    expect(byConfig.metrics?.crap).toHaveLength(2);
    expect(asked).toEqual([]);
  });

  it("judges every function when scope is diff but nothing can provide a diff", async () => {
    const result = await crapLayer.run(project({ "src/a.ts": TWO }, NONE, { config: diffConfig }));
    expect(result.metrics?.crap).toHaveLength(2);
    expect(result.verdict).toBe("fail");
  });

  it("takes a changed function of another file as no change here", async () => {
    const other: ScopeResult = {
      outcome: "scope",
      scope: {
        ...changedIn([7, 12]).scope,
        changedFunctions: [{ key: "src/b.ts::g", path: "src/b.ts", start: 1, end: 9 }],
      },
    };
    const result = await crapLayer.run(
      project({ "src/a.ts": TWO }, NONE, { config: diffConfig, diff: provider(other).diff }),
    );
    expect(result.verdict).toBe("vacuous");
  });
});

describe("G4b ratchet is not-evaluated until the baseline lands, and never a pass", () => {
  it("reports the rows and the reason baseline: M2 for a clean project", async () => {
    const result = await crapLayer.run(
      project({ "src/a.ts": BRANCHY }, FULL, { enforce: "ratchet" }),
    );
    expect(result.verdict).toBe("not-evaluated");
    expect(result.reason).toBe("baseline: M2");
    expect(result.metrics?.crap).toHaveLength(1);
  });

  it("still fails a function over the cap under ratchet: the cap binds a new function", async () => {
    const result = await crapLayer.run(
      project({ "src/a.ts": BRANCHY }, NONE, { enforce: "ratchet" }),
    );
    expect(result.verdict).toBe("fail");
  });
});

describe("G4 the layer cannot judge what it cannot read, and says so", () => {
  it("fails a file that does not parse, naming it and the line", async () => {
    const result = await crapLayer.run(project({ "src/a.ts": "export function (\n" }, NONE));
    expect(result.verdict).toBe("fail");
    expect(result.findings.find((item) => item.rule === "complexity-error")).toMatchObject({
      file: "src/a.ts",
      verdict: "fail",
    });
  });

  it("fails when the coverage input is missing, empty or not JSON", async () => {
    const context = project({ "src/a.ts": BRANCHY }, FULL);
    const path = context.artifacts.get("coverage-json") ?? "";
    writeFileSync(path, "not json");
    const broken = await crapLayer.run(context);
    expect(broken.findings[0]?.rule).toBe("output-unparseable");
    rmSync(path);
    const missing = await crapLayer.run(context);
    expect(missing.findings[0]?.rule).toBe("coverage-json-missing");
  });

  it("is handed its input by the runner: with no coverage artifact the layer throws", async () => {
    const context = project({ "src/a.ts": BRANCHY }, FULL, { artifacts: new Map() });
    await expect(crapLayer.run(context)).rejects.toThrow("coverage-json input was not handed over");
  });

  it("skips a tracked file that is not on disk", async () => {
    const context = project({ "src/a.ts": BRANCHY }, NONE);
    const result = await crapLayer.run({ ...context, exec: tracked("src/a.ts", "src/gone.ts") });
    expect(result.metrics?.crap).toMatchObject([{ file: "src/a.ts" }]);
  });

  it("lets an error that is not the counter's own through: the runner reports it as a failed layer", async () => {
    const context = project({ "src/a.ts": BRANCHY }, NONE);
    const home = join(context.cwd, "node_modules", "typescript");
    rmSync(home, { recursive: true, force: true });
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, "package.json"),
      JSON.stringify({ name: "typescript", main: "index.js" }),
    );
    writeFileSync(
      join(home, "index.js"),
      "const noop = () => {}; module.exports = { createSourceFile() { throw new Error('boom'); }, forEachChild: noop, isTypeNode: noop, flattenDiagnosticMessageText: noop, SyntaxKind: {} };",
    );
    await expect(crapLayer.run(context)).rejects.toThrow();
  });

  it("fails when git cannot list the files", async () => {
    const failing: Exec = () => Promise.resolve({ code: 128, stdout: "", stderr: "not a repo" });
    const result = await crapLayer.run(project({ "src/a.ts": BRANCHY }, FULL, { exec: failing }));
    expect(result.verdict).toBe("fail");
    expect(result.findings[0]?.rule).toBe("git-ls-files-failed");
  });

  it("fails when TypeScript is not installed in the project, and never starts", async () => {
    const context = project({ "src/a.ts": BRANCHY }, FULL);
    const bare = scratch();
    const result = await crapLayer.run({ ...context, cwd: bare });
    expect(result.verdict).toBe("fail");
    expect(result.findings[0]?.rule).toBe("typescript-missing");
  });
});

describe("G4 the layer's declaration", () => {
  it("consumes the coverage JSON gate 2 wrote, requires the tests layer, and produces nothing", () => {
    expect(crapLayer).toMatchObject({
      id: "crap",
      gate: 4,
      tier: 1,
      requires: ["tests"],
      produces: [],
      consumes: [{ artifact: "coverage-json", from: "tests" }],
    });
  });
});
