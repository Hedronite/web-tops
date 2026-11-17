import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { realExec } from "../../gate/exec.ts";
import type { Exec } from "../../gate/types.ts";
import { testsLayer } from "./index.ts";
import { SOURCE, realProject, rulesOf, runTests, testFile, type Project } from "./testkit.ts";

const projects: Project[] = [];

afterEach(() => {
  for (const item of projects.splice(0)) {
    item.project.cleanup();
  }
});

function real(files: Record<string, string>): Project {
  const item = realProject(files);
  projects.push(item);
  return item;
}

const CLEAN = testFile('it("adds", () => { expect(add(1, 2)).toBe(3); });');

describe("G4a tests: zero tests, .only and .skip each fail", () => {
  it("a clean shuffled run passes, records its seed, and leaves the JSON and a non-empty LCOV for gate 3", async () => {
    const item = real({ "src/a.ts": SOURCE, "src/a.test.ts": CLEAN });
    const result = await runTests(item, realExec);
    expect(rulesOf(result)).toEqual([]);
    expect(result.verdict).toBe("pass");
    expect(Number.isInteger(result.seed)).toBe(true);
    expect(result.seed).toBeGreaterThan(0);
    expect(result.artifacts["lcov"]).toBe(join(item.outDir, "tests", "coverage", "lcov.info"));
    expect(result.artifacts["vitest-json"]).toBe(join(item.outDir, "tests", "vitest.json"));
    expect(statSync(result.artifacts["lcov"] ?? "").size).toBeGreaterThan(0);
    expect(existsSync(result.artifacts["vitest-json"] ?? "")).toBe(true);
    expect(readFileSync(result.artifacts["lcov"] ?? "", "utf8")).toContain("SF:src/a.ts");
  });

  it.each([
    ["a committed it.only", 'it("a", () => {});\nit.only("b", () => {});', "focused-test"],
    [
      "a committed describe.only",
      'describe.only("g", () => { it("a", () => {}); });\nit("b", () => {});',
      "focused-test",
    ],
    ["a committed it.skip", 'it("a", () => {});\nit.skip("b", () => {});', "skipped-test"],
    ["a conditional skip", 'it("a", () => {});\nit.skipIf(true)("b", () => {});', "skipped-test"],
    ["an it.todo", 'it("a", () => {});\nit.todo("b");', "todo-test"],
    ["a failing test", 'it("a", () => { expect(1).toBe(2); });', "test-failed"],
    ["an empty suite", 'describe("nothing", () => {});', "zero-tests"],
  ])("%s fails with %s", async (_label, body, rule) => {
    const item = real({ "src/a.ts": SOURCE, "src/a.test.ts": testFile(body) });
    const result = await runTests(item, realExec);
    expect(rulesOf(result)).toContain(rule);
    expect(result.verdict).toBe("Refuse");
  });

  it("a focused test fails even though Vitest exits 0 outside CI by default", async () => {
    const item = real({
      "src/a.ts": SOURCE,
      "src/a.test.ts": testFile('it.only("a", () => {});\nit("b", () => {});'),
    });
    const result = await runTests(item, realExec, { env: { PATH: process.env["PATH"] } });
    expect(rulesOf(result)).toContain("focused-test");
  });

  it("no test file at all is zero tests", async () => {
    const item = real({ "src/a.ts": SOURCE });
    const result = await runTests(item, realExec);
    expect(rulesOf(result)).toContain("zero-tests");
  });

  it("a test file that does not load is a suite-failed finding naming the file", async () => {
    const item = real({
      "src/a.ts": SOURCE,
      "src/a.test.ts": CLEAN,
      "src/b.test.ts": 'import { it } from "vitest";\nit("x", () => {\n',
    });
    const result = await runTests(item, realExec);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ rule: "suite-failed", file: "src/b.test.ts" }),
    );
    expect(result.verdict).toBe("Refuse");
  });

  it("test files are not in the LCOV, and a yaml exclusion with a reason is honoured", async () => {
    const item = real({
      "src/a.ts": SOURCE,
      "src/gen/g.ts": "export const g = 1;\n",
      "src/a.test.ts": testFile(
        'import { g } from "./gen/g.ts";\nit("adds", () => { expect(add(1, 2) + g).toBe(4); });',
      ),
    });
    const result = await runTests(item, realExec, {
      coverage: { exclude: [{ glob: "src/gen/**", reason: "written by a generator" }] },
    });
    const lcov = readFileSync(result.artifacts["lcov"] ?? "", "utf8");
    expect(lcov).toContain("SF:src/a.ts");
    expect(lcov).not.toContain("a.test.ts");
    expect(lcov).not.toContain("src/gen/g.ts");
  });

  it("a failing test is judged from the JSON whatever the exit code says", async () => {
    const item = real({});
    const failing = JSON.stringify({
      numTotalTests: 1,
      testResults: [
        {
          name: "a",
          status: "failed",
          assertionResults: [{ status: "failed", title: "a", failureMessages: ["boom"] }],
        },
      ],
    });
    const exec: Exec = async (_tool, args) => {
      const out =
        args.find((arg) => arg.startsWith("--outputFile="))?.slice("--outputFile=".length) ?? "";
      const { writeFileSync } = await import("node:fs");
      writeFileSync(out, failing);
      return { code: 0, stdout: "", stderr: "" };
    };
    const result = await runTests(item, exec);
    expect(rulesOf(result)).toEqual(["test-failed"]);
  });

  it("writes Vitest's JSON under .web-tops/out/tests/ with --reporter=json and --outputFile", async () => {
    const calls: (readonly string[])[] = [];
    const exec: Exec = (_tool, args) => {
      calls.push(args);
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };
    const item = real({});
    await runTests(item, exec);
    const args = calls[0] ?? [];
    expect(args).toContain("--reporter=json");
    expect(args).toContain(`--outputFile=${join(item.outDir, "tests", "vitest.json")}`);
  });

  it("a threshold in the project's own Vitest config does not decide gate 2", async () => {
    const item = real({
      "src/a.ts": `${SOURCE}export const unused = (): number => {\n  return 1;\n};\n`,
      "src/a.test.ts": CLEAN,
      "vitest.config.ts":
        'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { coverage: { thresholds: { lines: 100 } } } });\n',
    });
    const result = await runTests(item, realExec);
    expect(result.verdict).toBe("pass");
  });

  it("is one process: vitest runs once under node on the installed bin, with the gate's own flags", async () => {
    const calls: { tool: string; args: readonly string[] }[] = [];
    const exec: Exec = (tool, args) => {
      calls.push({ tool, args });
      return Promise.resolve({ code: null, stdout: "", stderr: "", failure: "tool-missing" });
    };
    const item = real({});
    await runTests(item, exec, {
      coverage: { exclude: [{ glob: "src/gen/**", reason: "generated" }] },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.tool).toBe("node");
    const [entry, ...args] = calls[0]?.args ?? [];
    expect(entry).toBe(join(item.project.dir, "node_modules", "vitest", "vitest.mjs"));
    expect(args).toEqual(
      expect.arrayContaining([
        "run",
        "--coverage",
        "--coverage.provider=v8",
        "--coverage.include=src/**/*.{ts,tsx}",
        "--coverage.reporter=json",
        "--coverage.reporter=lcov",
        "--coverage.reportsDirectory=.web-tops/out/tests/coverage",
        "--sequence.shuffle",
        "--allowOnly=false",
        "--reporter=json",
        "--coverage.exclude=**/*.d.ts",
        "--coverage.exclude=src/gen/**",
        "--coverage.thresholds.lines=0",
      ]),
    );
  });

  it("passes the shuffle seed as its own argument, and records the same seed on the result", async () => {
    const calls: (readonly string[])[] = [];
    const exec: Exec = (_tool, args) => {
      calls.push(args);
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };
    const item = real({});
    const result = await runTests(item, exec);
    const args = calls[0] ?? [];
    const at = args.indexOf("--sequence.seed");
    expect(at).toBeGreaterThan(-1);
    expect(args[at + 1]).toBe(String(result.seed));
    expect(args[at - 1]).toBe("--sequence.shuffle");
  });

  it("a source file no test imports still gets an SF record at zero hits, and a file outside src does not", async () => {
    const item = real({
      "src/a.ts": SOURCE,
      "src/b.ts": "export const never = (): number => {\n  return 1;\n};\n",
      "src/ui/c.tsx": "export const view = (): number => {\n  return 2;\n};\n",
      "lib/d.ts": "export const other = 1;\n",
      "src/a.test.ts": CLEAN,
    });
    const result = await runTests(item, realExec);
    const lcov = readFileSync(result.artifacts["lcov"] ?? "", "utf8");
    expect(lcov).toContain("SF:src/a.ts");
    expect(lcov).toContain("SF:src/b.ts");
    expect(lcov).toContain("SF:src/ui/c.tsx");
    expect(lcov).not.toContain("lib/d.ts");
    expect(lcov).not.toContain("a.test.ts");
  });

  it("declares what it produces, and consumes nothing", () => {
    expect(testsLayer.produces).toEqual(["vitest-json", "lcov", "coverage-json"]);
    expect(testsLayer.consumes).toEqual([]);
  });

  it("a project with no node_modules is a tool-missing Refuse naming the package, and nothing is started", async () => {
    const calls: string[] = [];
    const exec: Exec = (tool) => {
      calls.push(tool);
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };
    const item = realProject({}, false);
    projects.push(item);
    const result = await runTests(item, exec);
    expect(calls).toEqual([]);
    expect(result.findings).toEqual([
      expect.objectContaining({
        rule: "tool-missing",
        message: "vitest is not installed in node_modules (package vitest)",
      }),
    ]);
  });

  it("gates.tests.shuffle false leaves out the shuffle flags and the seed", async () => {
    const calls: (readonly string[])[] = [];
    const exec: Exec = (_tool, args) => {
      calls.push(args);
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };
    const item = real({});
    const result = await runTests(item, exec, { tests: { shuffle: false } });
    expect(calls[0]?.some((arg) => arg.startsWith("--sequence"))).toBe(false);
    expect(result.seed).toBeUndefined();
  });

  it.each([
    [
      "a missing vitest",
      { code: null, stdout: "", stderr: "", failure: "tool-missing" as const },
      "tool-missing",
    ],
    [
      "a vitest that times out",
      { code: null, stdout: "", stderr: "", failure: "tool-timeout" as const },
      "tool-timeout",
    ],
    ["a crash that wrote no results", { code: 1, stdout: "", stderr: "boom" }, "vitest-failed"],
    ["a clean exit that wrote no results", { code: 0, stdout: "", stderr: "" }, "output-empty"],
  ])("%s is %s", async (_label, answer, rule) => {
    const item = real({});
    const result = await runTests(item, () => Promise.resolve(answer));
    expect(rulesOf(result)).toEqual([rule]);
  });

  it("results that are not JSON, not an object, or all-passing under a non-zero exit are findings, not passes", async () => {
    const item = real({});
    const writes =
      (text: string, code: number): Exec =>
      (_tool, args) => {
        const out =
          args.find((arg) => arg.startsWith("--outputFile="))?.slice("--outputFile=".length) ?? "";
        return import("node:fs").then(({ writeFileSync }) => {
          writeFileSync(out, text);
          return { code, stdout: "", stderr: "" };
        });
      };
    expect(rulesOf(await runTests(item, writes("not json", 0)))).toEqual(["output-unparseable"]);
    expect(rulesOf(await runTests(item, writes("[]", 0)))).toEqual(["output-unparseable"]);
    const oneTest = JSON.stringify({
      numTotalTests: 1,
      testResults: [
        { name: "a", status: "passed", assertionResults: [{ status: "passed", title: "a" }] },
      ],
    });
    // R36: the results decide, never the exit code. A passing JSON under exit 1 (a threshold in the project's
    // config, say) is a pass; the exit code only tells a crash that left no results from a run that wrote them.
    const passing = await runTests(item, writes(oneTest, 1));
    expect(rulesOf(passing)).toEqual([]);
    expect(passing.verdict).toBe("pass");
  });
});
