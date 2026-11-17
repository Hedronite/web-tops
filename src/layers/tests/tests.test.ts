import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
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
        args
          .find((arg) => arg.startsWith("--outputFile.json="))
          ?.slice("--outputFile.json=".length) ?? "";
      const { writeFileSync } = await import("node:fs");
      writeFileSync(out, failing);
      return { code: 0, stdout: "", stderr: "" };
    };
    const result = await runTests(item, exec);
    expect(rulesOf(result)).toEqual(["test-failed"]);
  });

  it("writes Vitest's JSON under .web-tops/out/tests/ with the json reporter beside the default one", async () => {
    const calls: (readonly string[])[] = [];
    const exec: Exec = (_tool, args) => {
      calls.push(args);
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };
    const item = real({});
    await runTests(item, exec);
    const args = calls[0] ?? [];
    expect(args).toContain("--reporter=default");
    expect(args).toContain("--reporter=json");
    expect(args).toContain(`--outputFile.json=${join(item.outDir, "tests", "vitest.json")}`);
    expect(args.some((arg) => arg.startsWith("--outputFile="))).toBe(false);
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
        "--reporter=default",
        "--reporter=json",
        "--coverage.exclude=**/*.d.ts",
        "--coverage.exclude=src/gen/**",
        "--config=.web-tops/out/tests/vitest.config.mjs",
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
    const item = realProject({}, "none");
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

  it("results that are not JSON or not an object are findings, not passes", async () => {
    const item = real({});
    const writes =
      (text: string, code: number): Exec =>
      (_tool, args) => {
        const out =
          args
            .find((arg) => arg.startsWith("--outputFile.json="))
            ?.slice("--outputFile.json=".length) ?? "";
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
    // R43: results with no failing test and a non-zero exit mean Vitest failed the run itself; the gate says so.
    const passing = await runTests(item, writes(oneTest, 1));
    expect(rulesOf(passing)).toEqual(["vitest-run-failed"]);
    expect(passing.verdict).toBe("Refuse");
  });

  describe("R43 a run Vitest fails itself is not a pass", () => {
    const PASSING_RESULTS = JSON.stringify({
      numTotalTests: 1,
      testResults: [
        { name: "a", status: "passed", assertionResults: [{ status: "passed", title: "a" }] },
      ],
    });

    function answers(code: number, stderr: string, stdout = "", text = PASSING_RESULTS): Exec {
      return async (_tool, args) => {
        const out =
          args
            .find((arg) => arg.startsWith("--outputFile.json="))
            ?.slice("--outputFile.json=".length) ?? "";
        const { writeFileSync } = await import("node:fs");
        writeFileSync(out, text);
        return { code, stdout, stderr };
      };
    }

    it("an unhandled rejection after a passing test is vitest-run-failed, quoting the error", async () => {
      const item = real({
        "src/a.ts": SOURCE,
        "src/a.test.ts": testFile(
          'it("adds", () => { expect(add(1, 2)).toBe(3); void Promise.reject(new Error("late rejection")); });',
        ),
      });
      const result = await runTests(item, realExec);
      expect(rulesOf(result)).toEqual(["vitest-run-failed"]);
      expect(result.verdict).toBe("Refuse");
      const message = result.findings[0]?.message ?? "";
      expect(message).toContain("late rejection");
      expect(message).toContain("Unhandled");
      expect(message).not.toContain("node_modules/vitest/dist");
    });

    it("an error thrown from a timer is vitest-run-failed too", async () => {
      const item = real({
        "src/a.ts": SOURCE,
        "src/a.test.ts": testFile(
          'it("adds", () => { expect(add(1, 2)).toBe(3); setTimeout(() => { throw new Error("timer boom"); }, 0); });\nit("waits", async () => { await new Promise((done) => setTimeout(done, 30)); });',
        ),
      });
      const result = await runTests(item, realExec);
      expect(rulesOf(result)).toEqual(["vitest-run-failed"]);
      expect(result.findings[0]?.message).toContain("timer boom");
    });

    it("a project config whose only complaint is a coverage threshold still passes", async () => {
      const item = real({
        "src/a.ts": `${SOURCE}export const unused = (): number => {\n  return 1;\n};\n`,
        "src/a.test.ts": CLEAN,
        "vitest.config.ts":
          'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { coverage: { thresholds: { lines: 100, functions: 100 } } } });\n',
      });
      const result = await runTests(item, realExec);
      expect(rulesOf(result)).toEqual([]);
      expect(result.verdict).toBe("pass");
    });

    it("quotes the first lines of what Vitest printed, with colour codes taken out", async () => {
      const esc = String.fromCharCode(27);
      const stderr = `${esc}[31m⎯⎯ Unhandled Errors ⎯⎯${esc}[39m\n\nVitest caught 1 unhandled error\n${esc}[1mError${esc}[22m: late\n❯ src/a.test.ts:3:1\n  at one\n  at two\n  at three\n  at four\n  at five\n  at six\n`;
      const result = await runTests(real({}), answers(1, stderr));
      const message = result.findings[0]?.message ?? "";
      expect(message).toContain("Error: late");
      expect(message).not.toContain(esc);
      expect(message).not.toContain("at six");
    });

    it("falls back to stdout when Vitest printed nothing on stderr", async () => {
      const result = await runTests(real({}), answers(1, "", "Errors 1 error\n"));
      expect(result.findings[0]?.message).toContain("Errors 1 error");
    });

    it("a failing test under a non-zero exit is test-failed alone: the exit code is already explained", async () => {
      const failing = JSON.stringify({
        numTotalTests: 1,
        testResults: [
          {
            name: "a",
            status: "failed",
            assertionResults: [
              { status: "failed", title: "a", failureMessages: ["AssertionError: x"] },
            ],
          },
        ],
      });
      const result = await runTests(real({}), answers(1, "FAIL", "", failing));
      expect(rulesOf(result)).toEqual(["test-failed"]);
    });

    it("a clean exit with passing results is a pass", async () => {
      const result = await runTests(real({}), answers(0, ""));
      expect(result.verdict).toBe("pass");
    });
  });

  describe("G4-2 a test-failed finding quotes the assertion, not the stack", () => {
    it("quotes the first lines of failureMessages", async () => {
      const failing = JSON.stringify({
        numTotalTests: 1,
        testResults: [
          {
            name: "/x/a.test.ts",
            status: "failed",
            assertionResults: [
              {
                status: "failed",
                fullName: "adds",
                failureMessages: [
                  "AssertionError: expected 3 to be 4 // Object.is equality\n\n- Expected\n+ Received\n\n- 4\n+ 3\n\n ❯ src/a.test.ts:3:5\n ❯ node_modules/vitest/dist/chunks/run.js:1632:35",
                ],
              },
            ],
          },
        ],
      });
      const exec: Exec = async (_tool, args) => {
        const out =
          args
            .find((arg) => arg.startsWith("--outputFile.json="))
            ?.slice("--outputFile.json=".length) ?? "";
        const { writeFileSync } = await import("node:fs");
        writeFileSync(out, failing);
        return { code: 1, stdout: "", stderr: "" };
      };
      const result = await runTests(real({}), exec);
      const message = result.findings[0]?.message ?? "";
      expect(message).toContain("adds: AssertionError: expected 3 to be 4 // Object.is equality");
      expect(message).not.toContain("node_modules");
      expect(message).not.toContain("run.js");
    });

    it("quotes the assertion of a real failing test", async () => {
      const item = real({
        "src/a.ts": SOURCE,
        "src/a.test.ts": testFile('it("adds", () => { expect(add(1, 2)).toBe(4); });'),
      });
      const result = await runTests(item, realExec);
      const message =
        result.findings.find((finding) => finding.rule === "test-failed")?.message ?? "";
      expect(message).toContain("expected 3 to be 4");
      expect(message).not.toContain("node_modules");
      expect(message).not.toMatch(/^\s+at /mu);
    });
  });

  describe("R43 amended: the kit config removes the project's coverage thresholds whole", () => {
    const B_UNTESTED = "export const half = (n: number): number => {\n  return n / 2;\n};\n";

    function project(config: Record<string, string>): Project {
      return real({
        "src/a.ts": SOURCE,
        "src/b.ts": B_UNTESTED,
        "src/a.test.ts": CLEAN,
        ...config,
      });
    }

    it.each([
      [
        "glob-keyed thresholds",
        '{ "src/b.ts": { functions: 100 }, "src/**/*.ts": { lines: 100 } }',
      ],
      ["the 100: true shorthand", "{ 100: true }"],
      ["global thresholds", "{ lines: 100, functions: 100, branches: 100, statements: 100 }"],
      ["per-file thresholds", "{ perFile: true, lines: 100 }"],
      ["auto-updating thresholds", "{ autoUpdate: true, lines: 100 }"],
    ])("%s do not decide gate 2 when every test passes", async (_label, thresholds) => {
      const item = project({
        "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { coverage: { thresholds: ${thresholds} } } });\n`,
      });
      const result = await runTests(item, realExec);
      expect(rulesOf(result)).toEqual([]);
      expect(result.verdict).toBe("pass");
    });

    it("reads the function form of a config", async () => {
      const item = project({
        "vitest.config.ts":
          'import { defineConfig } from "vitest/config";\nexport default defineConfig(() => ({ test: { coverage: { thresholds: { 100: true } } } }));\n',
      });
      expect((await runTests(item, realExec)).verdict).toBe("pass");
    });

    it("reads thresholds from vite.config.ts when there is no vitest config", async () => {
      const item = project({
        "vite.config.ts":
          'import { defineConfig } from "vite";\nexport default defineConfig({ test: { coverage: { thresholds: { lines: 100 } } } });\n',
      });
      expect((await runTests(item, realExec)).verdict).toBe("pass");
    });

    it("prefers vitest.config over vite.config, as Vitest does", async () => {
      const item = real({
        "src/a.ts": SOURCE,
        "src/a.check.ts": CLEAN,
        "vitest.config.ts":
          'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["src/**/*.check.ts"] } });\n',
        "vite.config.ts":
          'import { defineConfig } from "vite";\nexport default defineConfig({ test: { include: ["nothing/**"] } });\n',
      });
      const result = await runTests(item, realExec);
      expect(rulesOf(result)).toEqual([]);
    });

    it("keeps the rest of the project's config: its include still finds the tests", async () => {
      const item = real({
        "src/a.ts": SOURCE,
        "src/a.check.ts": CLEAN,
        "vitest.config.ts":
          'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["src/**/*.check.ts"], coverage: { thresholds: { lines: 100 } } } });\n',
      });
      const result = await runTests(item, realExec);
      expect(rulesOf(result)).toEqual([]);
      expect(result.verdict).toBe("pass");
    });

    it("works with no project config at all", async () => {
      const result = await runTests(real({ "src/a.ts": SOURCE, "src/a.test.ts": CLEAN }), realExec);
      expect(result.verdict).toBe("pass");
    });

    it("still fails an unhandled rejection under a project config with thresholds", async () => {
      const item = real({
        "src/a.ts": SOURCE,
        "src/a.test.ts": testFile(
          'it("adds", () => { expect(add(1, 2)).toBe(3); void Promise.reject(new Error("late rejection")); });',
        ),
        "vitest.config.ts":
          'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { coverage: { thresholds: { 100: true } } } });\n',
      });
      const result = await runTests(item, realExec);
      expect(rulesOf(result)).toEqual(["vitest-run-failed"]);
    });

    it("a project config that does not load is a crash with no results, quoting why", async () => {
      const item = project({
        "vitest.config.ts": 'throw new Error("config is broken");\n',
      });
      const result = await runTests(item, realExec);
      expect(rulesOf(result)).toEqual(["vitest-failed"]);
      expect(result.findings[0]?.message).toContain("config is broken");
    });

    it("still fails a failing test and zero tests under a project config", async () => {
      const item = real({
        "src/a.ts": SOURCE,
        "src/a.test.ts": testFile('it("a", () => { expect(1).toBe(2); });'),
        "vitest.config.ts":
          'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { coverage: { thresholds: { 100: true } } } });\n',
      });
      expect(rulesOf(await runTests(item, realExec))).toEqual(["test-failed"]);
    });

    it("writes the kit config under .web-tops/out/tests/ and passes it with --config", async () => {
      const calls: (readonly string[])[] = [];
      const exec: Exec = (_tool, args) => {
        calls.push(args);
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      };
      const item = real({ "vitest.config.ts": "export default {};\n" });
      await runTests(item, exec);
      const text = readFileSync(join(item.outDir, "tests", "vitest.config.mjs"), "utf8");
      expect(text).toContain("loadConfigFromFile");
      expect(text).toContain(join(item.project.dir, "vitest.config.ts"));
      expect(calls[0]).toContain("--config=.web-tops/out/tests/vitest.config.mjs");
      expect(calls[0]?.some((arg) => arg.startsWith("--coverage.thresholds"))).toBe(false);
    });

    it("resolves vite the way Vitest does: in an isolated install, where vite sits only beside vitest", async () => {
      const item = realProject(
        {
          "src/a.ts": SOURCE,
          "src/b.ts": B_UNTESTED,
          "src/a.test.ts": CLEAN,
          "vitest.config.ts":
            'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { coverage: { thresholds: { 100: true, "src/b.ts": { functions: 100 } } } } });\n',
        },
        "isolated",
      );
      projects.push(item);
      expect(existsSync(join(item.project.dir, "node_modules", "vite"))).toBe(false);
      const result = await runTests(item, realExec);
      expect(rulesOf(result)).toEqual([]);
      expect(result.verdict).toBe("pass");
    });

    it("an isolated install with no project config passes too", async () => {
      const item = realProject({ "src/a.ts": SOURCE, "src/a.test.ts": CLEAN }, "isolated");
      projects.push(item);
      expect((await runTests(item, realExec)).verdict).toBe("pass");
    });

    it("an isolated install with a config that does not load still names why, with no bundler noise first", async () => {
      const item = realProject(
        {
          "src/a.ts": SOURCE,
          "src/a.test.ts": CLEAN,
          "vitest.config.ts": 'throw new Error("config is broken");\n',
        },
        "isolated",
      );
      projects.push(item);
      const result = await runTests(item, realExec);
      expect(rulesOf(result)).toEqual(["vitest-failed"]);
      expect(result.findings[0]?.message).toContain("config is broken");
      expect(result.findings[0]?.message).not.toContain("UNRESOLVED_IMPORT");
    });

    it("imports vite by the file it resolves to from the real vitest directory, not by name", async () => {
      const exec: Exec = () => Promise.resolve({ code: 0, stdout: "", stderr: "" });
      const item = realProject({ "vitest.config.ts": "export default {};\n" }, "isolated");
      projects.push(item);
      await runTests(item, exec);
      const text = readFileSync(join(item.outDir, "tests", "vitest.config.mjs"), "utf8");
      const vite = createRequire(
        realpathSync(join(item.project.dir, "node_modules", "vitest", "package.json")),
      ).resolve("vite");
      expect(text).toContain(pathToFileURL(vite).href);
      expect(text).not.toContain('from "vite"');
    });

    it("loads vite.config only when no vitest.config exists, and none at all when neither does", async () => {
      const exec: Exec = () => Promise.resolve({ code: 0, stdout: "", stderr: "" });
      const only = real({ "vite.config.mts": "export default {};\n" });
      await runTests(only, exec);
      expect(readFileSync(join(only.outDir, "tests", "vitest.config.mjs"), "utf8")).toContain(
        join(only.project.dir, "vite.config.mts"),
      );
      const none = real({});
      await runTests(none, exec);
      expect(readFileSync(join(none.outDir, "tests", "vitest.config.mjs"), "utf8")).not.toContain(
        "vite.config",
      );
    });
  });
});
