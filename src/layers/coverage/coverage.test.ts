import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeBaselineFile } from "../../baseline/test-support.ts";
import { cfg } from "../../gate/testkit.ts";
import type { Exec, ExecResult, GateConfig, LayerContext } from "../../gate/types.ts";
import { realProject, SOURCE, testFile, type Project } from "../tests/testkit.ts";
import { realExec } from "../../gate/exec.ts";
import { testsLayer } from "../tests/index.ts";
import { coverageLayer } from "./index.ts";
import { isBelow, parseRecords, percent, totalsOf } from "./lcov.ts";
import { REAL_TOOL_TIMEOUT } from "../../gate/test-support-timeouts.ts";

const projects: Project[] = [];

afterEach(() => {
  for (const item of projects.splice(0)) {
    item.project.cleanup();
  }
});

/** What `git ls-files -z` answers for these tracked files. */
function tracked(...files: string[]): Exec {
  return () =>
    Promise.resolve({ code: 0, stdout: files.map((file) => `${file}\0`).join(""), stderr: "" });
}

function lcovWith(text: string | undefined): {
  context: (overrides?: Partial<LayerContext>, floor?: number) => LayerContext;
  withExclude: (exclude: GateConfig["coverage"]["exclude"]) => LayerContext;
  /** Writes a project file, relative to the project. */
  write: (file: string, text: string) => void;
  /** Writes `.web-tops/out/tests/setup-files.json` and returns the artifact map that hands it over. */
  withSetupFiles: (files: readonly string[]) => ReadonlyMap<string, string>;
} {
  const item = realProject({});
  projects.push(item);
  const path = join(item.outDir, "tests", "coverage", "lcov.info");
  mkdirSync(dirname(path), { recursive: true });
  if (text !== undefined) {
    writeFileSync(path, text);
  }
  const setupPath = join(item.outDir, "tests", "setup-files.json");
  writeFileSync(setupPath, "[]");
  const base = (floor: number, exclude: GateConfig["coverage"]["exclude"]): LayerContext => ({
    cwd: item.project.dir,
    config: cfg({ coverage: { linesFloor: floor, exclude } }),
    base: "origin/main",
    enforce: "hard",
    env: {},
    exec: tracked(),
    outDir: item.outDir,
    artifacts: new Map([
      ["lcov", path],
      ["setup-files", setupPath],
    ]),
  });
  return {
    write: (file, body) => {
      mkdirSync(dirname(join(item.project.dir, file)), { recursive: true });
      writeFileSync(join(item.project.dir, file), body);
    },
    withSetupFiles: (files) => {
      writeFileSync(setupPath, JSON.stringify(files));
      return new Map([
        ["lcov", path],
        ["setup-files", setupPath],
      ]);
    },
    context: (overrides = {}, floor = 85) => ({ ...base(floor, []), ...overrides }),
    withExclude: (exclude) => base(85, exclude),
  };
}

/** A real repository around the project: the files it holds are tracked, `node_modules` and the out directory are not. */
function gitInit(item: Project): void {
  writeFileSync(join(item.project.dir, ".gitignore"), "node_modules\n.web-tops\n");
  const run = (...args: string[]): void => {
    execFileSync("git", args, { cwd: item.project.dir, stdio: "ignore" });
  };
  run("init", "-q");
  run("add", "-A");
}

function record(file: string, found: number, hit: number): string {
  return `TN:\nSF:${file}\nDA:1,1\nLF:${String(found)}\nLH:${String(hit)}\nend_of_record\n`;
}

describe("G4b coverage: empty LCOV fails, below floor fails under hard, and under ratchet until a baseline holds it", () => {
  it.each([
    ["a 0-byte file", ""],
    ["a profile with no records", "TN:\nend_of_record\n"],
    ["records with no instrumented lines", record("src/a.ts", 0, 0)],
  ])("%s is lcov-empty", async (_label, text) => {
    const result = await coverageLayer.run(lcovWith(text).context());
    expect(result.verdict).toBe("fail");
    expect(result.findings[0]?.rule).toBe("lcov-empty");
  });

  it("a missing LCOV file is lcov-missing", async () => {
    const result = await coverageLayer.run(lcovWith(undefined).context());
    expect(result.findings[0]?.rule).toBe("lcov-missing");
  });

  it("is handed its input by the runner: with no lcov artifact the layer throws, and the runner reports it", async () => {
    await expect(
      coverageLayer.run(lcovWith(record("src/a.ts", 1, 1)).context({ artifacts: new Map() })),
    ).rejects.toThrow("lcov input was not handed over");
  });

  it("declares what it consumes, and requires the layer that produces it", () => {
    expect(coverageLayer.consumes).toEqual([
      { artifact: "lcov", from: "tests" },
      { artifact: "setup-files", from: "tests" },
    ]);
    expect(coverageLayer.requires).toEqual(["tests"]);
    expect(coverageLayer.produces).toEqual([]);
  });

  it("fails 84.99 % against a floor of 85 and passes exactly 85 %", async () => {
    const below = await coverageLayer.run(lcovWith(record("src/a.ts", 10000, 8499)).context());
    expect(below.verdict).toBe("fail");
    expect(below.findings[0]).toMatchObject({ rule: "coverage-below-floor" });
    expect(below.findings[0]?.message).toContain("84.99 %");
    const exact = await coverageLayer.run(lcovWith(record("src/a.ts", 10000, 8500)).context());
    expect(exact.verdict).toBe("pass");
    const site = await coverageLayer.run(lcovWith(record("src/a.ts", 100, 70)).context({}, 70));
    expect(site.verdict).toBe("pass");
  });

  it("sums the lines of every file, so one well-covered file does not hide another", async () => {
    const text = record("src/a.ts", 100, 100) + record("src/b.ts", 100, 0);
    const result = await coverageLayer.run(lcovWith(text).context());
    expect(result.verdict).toBe("fail");
    expect(result.findings[0]?.message).toContain("50.00 % of 200 lines in 2 files");
  });

  it("under ratchet with no baseline yet, judges as hard does: the floor applies, so the first baseline is measured", async () => {
    const above = await coverageLayer.run(
      lcovWith(record("src/a.ts", 100, 100)).context({ enforce: "ratchet" }),
    );
    expect(above.verdict).toBe("pass");
    const below = await coverageLayer.run(
      lcovWith(record("src/a.ts", 10000, 8499)).context({ enforce: "ratchet" }),
    );
    expect(below.verdict).toBe("fail");
    expect(below.findings.map((item) => item.rule)).toContain("coverage-below-floor");
  });

  it("under ratchet with a baseline, reports what it measured and leaves the floor to the ratchet: below the floor is a pass", async () => {
    const box = lcovWith(record("src/a.ts", 10000, 8499));
    const context = box.context({
      enforce: "ratchet",
      config: cfg({ baselinePath: "baseline.json" }),
    });
    writeBaselineFile(context.cwd);
    const result = await coverageLayer.run(context);
    expect(result.verdict).toBe("pass");
    expect(result.findings[0]?.message).toContain("held by the baseline");
    expect(result.metrics?.coverage).toHaveLength(1);
  });

  it("under ratchet an empty LCOV is still a fail: no silent empties", async () => {
    const result = await coverageLayer.run(lcovWith("").context({ enforce: "ratchet" }));
    expect(result.verdict).toBe("fail");
  });

  it(
    "measures the LCOV the real tests layer wrote, and fails a project under the floor",
    async () => {
      const item = realProject({
        "src/a.ts": `${SOURCE}export const half = (n: number): number => {\n  if (n > 0) {\n    return n;\n  }\n  return -n;\n};\n`,
        "src/a.test.ts": testFile('it("adds", () => { expect(add(1, 2)).toBe(3); });'),
      });
      projects.push(item);
      gitInit(item);
      const context: LayerContext = {
        cwd: item.project.dir,
        config: cfg({ coverage: { linesFloor: 100, exclude: [] }, tests: { shuffle: true } }),
        base: "origin/main",
        enforce: "hard",
        env: { PATH: process.env["PATH"] },
        exec: realExec,
        outDir: item.outDir,
        artifacts: new Map(),
      };
      const ran = await testsLayer.run(context);
      expect(ran.verdict).toBe("pass");
      const result = await coverageLayer.run({
        ...context,
        artifacts: new Map(Object.entries(ran.artifacts)),
      });
      expect(result.verdict).toBe("fail");
      expect(result.findings[0]?.rule).toBe("coverage-below-floor");
    },
    REAL_TOOL_TIMEOUT,
  );
});

describe("G4c coverage: every tracked in-scope file has an SF record, or the layer fails (R29 N7)", () => {
  const RULE = "no-coverage-record";

  it("fails a tracked source file that no test imports, and names it", async () => {
    const text = record("src/a.ts", 10, 10);
    const context = lcovWith(text).context({ exec: tracked("src/a.ts", "src/b.ts") });
    const result = await coverageLayer.run(context);
    expect(result.verdict).toBe("fail");
    expect(result.findings).toContainEqual(
      expect.objectContaining({ rule: RULE, verdict: "fail", file: "src/b.ts" }),
    );
    expect(result.findings.filter((finding) => finding.rule === RULE)).toHaveLength(1);
  });

  it("passes when every tracked file in scope has a record", async () => {
    const text = record("src/a.ts", 10, 10) + record("src/ui/b.tsx", 10, 10);
    const context = lcovWith(text).context({ exec: tracked("src/a.ts", "src/ui/b.tsx") });
    expect((await coverageLayer.run(context)).verdict).toBe("pass");
  });

  it("reads scope as src/**/*.{ts,tsx} less the default exclusions and the yaml ones", async () => {
    const box = lcovWith(record("src/a.ts", 10, 10));
    const context = box.withExclude([{ glob: "src/gen/**", reason: "written by a generator" }]);
    const result = await coverageLayer.run({
      ...context,
      exec: tracked(
        "src/a.ts",
        "src/a.test.ts",
        "src/types.d.ts",
        "src/gen/g.ts",
        "src/__tests__/t.ts",
        "src/__generated__/x.ts",
        "src/app.config.ts",
        "lib/e.ts",
        "src/readme.md",
        "src/b.tsx",
      ),
    });
    const missing = result.findings.filter((finding) => finding.rule === RULE);
    expect(missing.map((finding) => finding.file)).toEqual(["src/b.tsx"]);
  });

  it("matches an absolute SF path to the tracked file", async () => {
    const box = lcovWith("");
    const context = box.context({ exec: tracked("src/a.ts") });
    writeFileSync(
      context.artifacts.get("lcov") ?? "",
      record(join(context.cwd, "src", "a.ts"), 10, 10),
    );
    expect((await coverageLayer.run(context)).verdict).toBe("pass");
  });

  it("reports the missing records and the floor together, so one run shows both", async () => {
    const context = lcovWith(record("src/a.ts", 100, 10)).context({
      exec: tracked("src/a.ts", "src/b.ts"),
    });
    const result = await coverageLayer.run(context);
    expect(result.findings.map((finding) => finding.rule).sort()).toEqual([
      "coverage-below-floor",
      RULE,
    ]);
  });

  it("under ratchet a missing record is a fail, and a complete profile passes", async () => {
    const box = lcovWith(record("src/a.ts", 10, 10));
    const missing = await coverageLayer.run(
      box.context({ enforce: "ratchet", exec: tracked("src/a.ts", "src/b.ts") }),
    );
    expect(missing.verdict).toBe("fail");
    const complete = await coverageLayer.run(
      box.context({ enforce: "ratchet", exec: tracked("src/a.ts") }),
    );
    expect(complete.verdict).toBe("pass");
  });

  it("asks git for the tracked files, NUL separated, in the project directory", async () => {
    const calls: { command: string; args: readonly string[]; cwd: string | undefined }[] = [];
    const exec: Exec = (command, args, options) => {
      calls.push({ command, args, cwd: options?.cwd });
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };
    const context = lcovWith(record("src/a.ts", 10, 10)).context({ exec });
    await coverageLayer.run(context);
    expect(calls).toEqual([{ command: "git", args: ["ls-files", "-z"], cwd: context.cwd }]);
  });

  it.each([
    [
      "git ls-files exits non-zero",
      { code: 128, stdout: "", stderr: "fatal: not a git repository" },
      "git-ls-files-failed",
    ],
    [
      "git is not installed",
      { code: null, stdout: "", stderr: "", failure: "tool-missing" as const },
      "tool-missing",
    ],
    [
      "git does not finish",
      { code: null, stdout: "", stderr: "", failure: "tool-timeout" as const },
      "tool-timeout",
    ],
  ])("%s: the layer fails with %s", async (_label, answer: ExecResult, rule) => {
    const context = lcovWith(record("src/a.ts", 10, 10)).context({
      exec: () => Promise.resolve(answer),
    });
    const result = await coverageLayer.run(context);
    expect(result.verdict).toBe("fail");
    expect(result.findings.map((finding) => finding.rule)).toContain(rule);
  });

  it("returns every missing record: the report keeps them all and only the printer caps", async () => {
    const files = Array.from({ length: 120 }, (_unused, index) => `src/f${String(index)}.ts`);
    const context = lcovWith(record("src/a.ts", 10, 10)).context({
      exec: tracked("src/a.ts", ...files),
    });
    const result = await coverageLayer.run(context);
    expect(result.findings.filter((finding) => finding.rule === RULE)).toHaveLength(120);
    expect(
      result.findings.some((finding) => finding.message.includes("more findings, not listed")),
    ).toBe(false);
  });

  it(
    "a tracked file the real tests layer never imported counts against the floor instead of leaving the denominator",
    async () => {
      const item = realProject({
        "src/a.ts": SOURCE,
        "src/b.ts": "export const never = (): number => {\n  return 1;\n};\n",
        "src/a.test.ts": testFile('it("adds", () => { expect(add(1, 2)).toBe(3); });'),
      });
      projects.push(item);
      gitInit(item);
      const context: LayerContext = {
        cwd: item.project.dir,
        config: cfg({ coverage: { linesFloor: 100, exclude: [] }, tests: { shuffle: true } }),
        base: "origin/main",
        enforce: "hard",
        env: { PATH: process.env["PATH"] },
        exec: realExec,
        outDir: item.outDir,
        artifacts: new Map(),
      };
      const ran = await testsLayer.run(context);
      const result = await coverageLayer.run({
        ...context,
        artifacts: new Map(Object.entries(ran.artifacts)),
      });
      expect(result.findings.map((finding) => finding.rule)).toEqual(["coverage-below-floor"]);
      expect(result.findings[0]?.message).toContain("in 2 files");
    },
    REAL_TOOL_TIMEOUT,
  );
});

describe("G4e coverage: the floor is over in-scope records only (R36)", () => {
  it("leaves records outside the include or under an exclusion out of the percentage", async () => {
    const text =
      record("src/a.ts", 100, 100) +
      record("src/a.test.ts", 50, 0) +
      record("src/types.d.ts", 50, 0) +
      record("lib/x.ts", 100, 0) +
      record("src/gen/g.ts", 100, 0);
    const box = lcovWith(text);
    const context = box.withExclude([{ glob: "src/gen/**", reason: "generated" }]);
    const result = await coverageLayer.run(context);
    expect(result.verdict).toBe("pass");
    expect(result.findings[0]?.message).toContain("100.00 % of 100 lines in 1 files");
  });

  it("counts an in-scope record that is not tracked, since the profile is what ran", async () => {
    const text = record("src/a.ts", 100, 100) + record("src/b.ts", 100, 0);
    const result = await coverageLayer.run(lcovWith(text).context());
    expect(result.verdict).toBe("fail");
    expect(result.findings[0]?.message).toContain("50.00 % of 200 lines in 2 files");
  });

  it("a profile whose records are all out of scope is empty, never a pass", async () => {
    const text = record("src/a.test.ts", 10, 10) + record("lib/x.ts", 10, 10);
    const result = await coverageLayer.run(lcovWith(text).context());
    expect(result.verdict).toBe("fail");
    expect(result.findings[0]?.rule).toBe("lcov-empty");
  });

  it("an absolute SF path is judged by its path relative to the project", async () => {
    const box = lcovWith("");
    const context = box.context();
    writeFileSync(
      context.artifacts.get("lcov") ?? "",
      record(join(context.cwd, "src", "a.ts"), 10, 10) +
        record(join(context.cwd, "src", "a.test.ts"), 10, 0),
    );
    expect((await coverageLayer.run(context)).verdict).toBe("pass");
  });
});

describe("lcov", () => {
  it("counts files and lines, and compares without rounding", () => {
    const records = parseRecords(record("a", 3, 1) + record("b", 7, 7) + "LF:x\n");
    expect(records.map((entry) => entry.file)).toEqual(["a", "b"]);
    const totals = totalsOf(records);
    expect(totals).toEqual({ files: 2, found: 10, hit: 8 });
    expect(percent(totals)).toBe("80.00");
    expect(percent({ files: 0, found: 0, hit: 0 })).toBe("0");
    expect(isBelow(totals, 80)).toBe(false);
    expect(isBelow(totals, 81)).toBe(true);
  });
});

describe("G2b per-package numbers: a row for each in-scope file, and the package named in the message", () => {
  it("fills metrics.coverage with the in-scope records only, sorted by file, adding up to the totals", async () => {
    const text =
      record("src/b.ts", 20, 10) + record("src/a.ts", 10, 10) + record("src/a.test.ts", 5, 5);
    const lcov = lcovWith(text);
    const result = await coverageLayer.run(
      lcov.context({ exec: tracked("src/a.ts", "src/b.ts", "src/a.test.ts") }, 40),
    );
    expect(result.metrics?.coverage).toEqual([
      { file: "src/a.ts", lines_found: 10, lines_hit: 10 },
      { file: "src/b.ts", lines_found: 20, lines_hit: 10 },
    ]);
    const message = result.findings.find((finding) => finding.rule === "coverage")?.message;
    expect(message).toContain("fixture: 66.67 % of 30 lines in 2 files");
  });

  it("carries the rows when the floor fails too, so the baseline sees the numbers it failed on", async () => {
    const result = await coverageLayer.run(lcovWith(record("src/a.ts", 10, 2)).context());
    expect(result.verdict).toBe("fail");
    expect(result.metrics?.coverage).toEqual([{ file: "src/a.ts", lines_found: 10, lines_hit: 2 }]);
  });
});

const HINT_RULE = "coverage-hint/";

describe("G2b a coverage hint is one pass finding with its file and line (R60)", () => {
  const GUARD = [
    "export function guard(n: number): number {",
    "  /* v8 ignore next 3 */",
    "  if (n < 0) {",
    '    throw new Error("negative");',
    "  }",
    "  /* istanbul ignore next */",
    "  return n;",
    "}",
    "",
  ].join("\n");

  it("emits one coverage-hint finding for each hint in a tracked file in scope, and the layer stays pass", async () => {
    const lcov = lcovWith(record("src/guard.ts", 4, 4));
    lcov.write("src/guard.ts", GUARD);
    const result = await coverageLayer.run(lcov.context({ exec: tracked("src/guard.ts") }));
    expect(result.verdict).toBe("pass");
    const hints = result.findings.filter((finding) => finding.rule.startsWith(HINT_RULE));
    expect(hints).toMatchObject([
      { tool: "webtops", verdict: "pass", file: "src/guard.ts", line: 2 },
      { tool: "webtops", verdict: "pass", file: "src/guard.ts", line: 6 },
    ]);
    expect(hints.map((finding) => finding.rule)).toEqual([
      "coverage-hint/v8",
      "coverage-hint/istanbul",
    ]);
    expect(hints[0]?.message).toContain("v8 ignore");
    expect(hints[1]?.message).toContain("istanbul ignore");
  });

  it("looks only in tracked files in scope: not in a test file, an excluded file or an untracked one", async () => {
    const lcov = lcovWith(record("src/a.ts", 4, 4));
    for (const file of ["src/a.ts", "src/a.test.ts", "src/generated.ts", "src/untracked.ts"]) {
      lcov.write(file, "/* v8 ignore next */\n");
    }
    const context = {
      ...lcov.withExclude([{ glob: "src/generated.ts", reason: "generated" }]),
      exec: tracked("src/a.ts", "src/a.test.ts", "src/generated.ts"),
    };
    const result = await coverageLayer.run(context);
    expect(result.findings.filter((finding) => finding.rule.startsWith(HINT_RULE))).toMatchObject([
      { file: "src/a.ts", line: 1 },
    ]);
  });

  it("a hint does not fail the layer under hard, and does not hide a profile under the floor", async () => {
    const lcov = lcovWith(record("src/guard.ts", 10, 1));
    lcov.write("src/guard.ts", GUARD);
    const result = await coverageLayer.run(lcov.context({ exec: tracked("src/guard.ts") }));
    expect(result.verdict).toBe("fail");
    expect(result.findings.some((finding) => finding.rule.startsWith(HINT_RULE))).toBe(true);
  });
});

describe("G2c G4-4: a Vitest setup file has no record because Vitest does not instrument it", () => {
  const RULE = "no-coverage-record";

  it("says so, and points at gates.coverage.exclude, for a file the tests layer named as a setup file", async () => {
    const lcov = lcovWith(record("src/a.ts", 10, 10));
    const artifacts = lcov.withSetupFiles(["src/setup.ts"]);
    const result = await coverageLayer.run(
      lcov.context({ exec: tracked("src/a.ts", "src/setup.ts"), artifacts }),
    );
    expect(result.verdict).toBe("fail");
    const finding = result.findings.find((item) => item.rule === RULE);
    expect(finding).toMatchObject({ file: "src/setup.ts" });
    expect(finding?.message).toContain("Vitest does not instrument setup files");
    expect(finding?.message).toContain("gates.coverage.exclude");
    expect(finding?.message).not.toContain("no test imports it");
  });

  it("keeps no test imports it for a source file that is not a setup file", async () => {
    const lcov = lcovWith(record("src/a.ts", 10, 10));
    const artifacts = lcov.withSetupFiles(["src/setup.ts"]);
    const result = await coverageLayer.run(
      lcov.context({ exec: tracked("src/a.ts", "src/setup.ts", "src/never.ts"), artifacts }),
    );
    const never = result.findings.find((item) => item.file === "src/never.ts");
    expect(never?.message).toContain("no test imports it");
    expect(never?.message).not.toContain("setup");
  });

  it("an unreadable or malformed setup-files input names no file as a setup file", async () => {
    const lcov = lcovWith(record("src/a.ts", 10, 10));
    lcov.write(".web-tops/out/tests/setup-files.json", "not json");
    const result = await coverageLayer.run(
      lcov.context({ exec: tracked("src/a.ts", "src/setup.ts") }),
    );
    expect(result.findings.find((item) => item.rule === RULE)?.message).toContain(
      "no test imports it",
    );
  });
});

describe("G2-1 the layer measures a source folder named coverage", () => {
  it("counts its files in the totals and the rows, and scans them for hints", async () => {
    const text = record("src/layers/coverage/lcov.ts", 10, 5) + record("src/a.ts", 10, 10);
    const lcov = lcovWith(text);
    lcov.write("src/layers/coverage/lcov.ts", "/* v8 ignore next */\nexport const a = 1;\n");
    const result = await coverageLayer.run(
      lcov.context({ exec: tracked("src/layers/coverage/lcov.ts", "src/a.ts") }, 60),
    );
    expect(result.metrics?.coverage?.map((row) => row.file)).toEqual([
      "src/a.ts",
      "src/layers/coverage/lcov.ts",
    ]);
    expect(result.findings.find((item) => item.rule === "coverage")?.message).toContain("75.00 %");
    expect(result.findings.filter((item) => item.rule.startsWith(HINT_RULE))).toMatchObject([
      { file: "src/layers/coverage/lcov.ts", line: 1 },
    ]);
  });

  it("fails a coverage-folder file no test imports, instead of dropping it from the denominator", async () => {
    const lcov = lcovWith(record("src/a.ts", 10, 10));
    const result = await coverageLayer.run(
      lcov.context({ exec: tracked("src/a.ts", "src/layers/coverage/lcov.ts") }),
    );
    expect(result.verdict).toBe("fail");
    expect(result.findings.find((item) => item.rule === "no-coverage-record")).toMatchObject({
      file: "src/layers/coverage/lcov.ts",
    });
  });
});

describe("R67 the hint kind is in the rule name: coverage-hint/v8, /istanbul and /c8", () => {
  it("names each kind, keeps the tool webtops and the verdict pass", async () => {
    const lcov = lcovWith(record("src/h.ts", 3, 3));
    lcov.write(
      "src/h.ts",
      "/* v8 ignore next */\n// istanbul ignore next\n/* c8 ignore start */\n",
    );
    const result = await coverageLayer.run(lcov.context({ exec: tracked("src/h.ts") }));
    const hints = result.findings.filter((finding) => finding.rule.startsWith(HINT_RULE));
    expect(
      hints.map((finding) => [finding.rule, finding.tool, finding.verdict, finding.line]),
    ).toEqual([
      ["coverage-hint/v8", "webtops", "pass", 1],
      ["coverage-hint/istanbul", "webtops", "pass", 2],
      ["coverage-hint/c8", "webtops", "pass", 3],
    ]);
  });
});
