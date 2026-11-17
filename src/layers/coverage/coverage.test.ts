import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cfg } from "../../gate/testkit.ts";
import type { Exec, ExecResult, GateConfig, LayerContext } from "../../gate/types.ts";
import { realProject, SOURCE, testFile, type Project } from "../tests/testkit.ts";
import { realExec } from "../../gate/exec.ts";
import { testsLayer } from "../tests/index.ts";
import { coverageLayer } from "./index.ts";
import { isBelow, parseRecords, percent, totalsOf } from "./lcov.ts";

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
} {
  const item = realProject({});
  projects.push(item);
  const path = join(item.outDir, "tests", "coverage", "lcov.info");
  mkdirSync(dirname(path), { recursive: true });
  if (text !== undefined) {
    writeFileSync(path, text);
  }
  const base = (floor: number, exclude: GateConfig["coverage"]["exclude"]): LayerContext => ({
    cwd: item.project.dir,
    config: cfg({ coverage: { linesFloor: floor, exclude } }),
    base: "origin/main",
    enforce: "hard",
    env: {},
    exec: tracked(),
    outDir: item.outDir,
    artifacts: new Map([["lcov", path]]),
  });
  return {
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

describe("G4b coverage: empty LCOV fails, below floor fails under hard, ratchet is not-evaluated baseline: M2", () => {
  it.each([
    ["a 0-byte file", ""],
    ["a profile with no records", "TN:\nend_of_record\n"],
    ["records with no instrumented lines", record("src/a.ts", 0, 0)],
  ])("%s is lcov-empty", async (_label, text) => {
    const result = await coverageLayer.run(lcovWith(text).context());
    expect(result.verdict).toBe("Refuse");
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
    expect(coverageLayer.consumes).toEqual([{ artifact: "lcov", from: "tests" }]);
    expect(coverageLayer.requires).toEqual(["tests"]);
    expect(coverageLayer.produces).toEqual([]);
  });

  it("fails 84.99 % against a floor of 85 and passes exactly 85 %", async () => {
    const below = await coverageLayer.run(lcovWith(record("src/a.ts", 10000, 8499)).context());
    expect(below.verdict).toBe("Refuse");
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
    expect(result.verdict).toBe("Refuse");
    expect(result.findings[0]?.message).toContain("50.00 % of 200 lines in 2 files");
  });

  it("under ratchet it is not-evaluated with the reason baseline: M2, never a pass, even above the floor", async () => {
    const result = await coverageLayer.run(
      lcovWith(record("src/a.ts", 100, 100)).context({ enforce: "ratchet" }),
    );
    expect(result.verdict).toBe("not-evaluated");
    expect(result.reason).toBe("baseline: M2");
  });

  it("under ratchet an empty LCOV is still a Refuse: no silent empties", async () => {
    const result = await coverageLayer.run(lcovWith("").context({ enforce: "ratchet" }));
    expect(result.verdict).toBe("Refuse");
  });

  it("measures the LCOV the real tests layer wrote, and fails a project under the floor", async () => {
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
    expect(result.verdict).toBe("Refuse");
    expect(result.findings[0]?.rule).toBe("coverage-below-floor");
  });
});

describe("G4c coverage: every tracked in-scope file has an SF record, or the layer fails (R29 N7)", () => {
  const RULE = "no-coverage-record";

  it("fails a tracked source file that no test imports, and names it", async () => {
    const text = record("src/a.ts", 10, 10);
    const context = lcovWith(text).context({ exec: tracked("src/a.ts", "src/b.ts") });
    const result = await coverageLayer.run(context);
    expect(result.verdict).toBe("Refuse");
    expect(result.findings).toContainEqual(
      expect.objectContaining({ rule: RULE, verdict: "Refuse", file: "src/b.ts" }),
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

  it("under ratchet a missing record is a Refuse, and a complete profile stays not-evaluated baseline: M2", async () => {
    const box = lcovWith(record("src/a.ts", 10, 10));
    const missing = await coverageLayer.run(
      box.context({ enforce: "ratchet", exec: tracked("src/a.ts", "src/b.ts") }),
    );
    expect(missing.verdict).toBe("Refuse");
    const complete = await coverageLayer.run(
      box.context({ enforce: "ratchet", exec: tracked("src/a.ts") }),
    );
    expect(complete).toMatchObject({ verdict: "not-evaluated", reason: "baseline: M2" });
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
    expect(result.verdict).toBe("Refuse");
    expect(result.findings.map((finding) => finding.rule)).toContain(rule);
  });

  it("caps a long list of missing records and says how many it left out", async () => {
    const files = Array.from({ length: 120 }, (_unused, index) => `src/f${String(index)}.ts`);
    const context = lcovWith(record("src/a.ts", 10, 10)).context({
      exec: tracked("src/a.ts", ...files),
    });
    const result = await coverageLayer.run(context);
    expect(result.findings.filter((finding) => finding.rule === RULE)).toHaveLength(100);
    expect(
      result.findings.some((finding) => finding.message.includes("more findings, not listed")),
    ).toBe(true);
  });

  it("a tracked file the real tests layer never imported counts against the floor instead of leaving the denominator", async () => {
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
  });
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
    expect(result.verdict).toBe("Refuse");
    expect(result.findings[0]?.message).toContain("50.00 % of 200 lines in 2 files");
  });

  it("a profile whose records are all out of scope is empty, never a pass", async () => {
    const text = record("src/a.test.ts", 10, 10) + record("lib/x.ts", 10, 10);
    const result = await coverageLayer.run(lcovWith(text).context());
    expect(result.verdict).toBe("Refuse");
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
