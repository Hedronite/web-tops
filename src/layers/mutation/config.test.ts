import { describe, expect, it } from "vitest";
import { strykerConfig } from "./config.ts";

/** G7a: the Stryker config is generated for each run, from the gate's own files, never read from the project. */

const BASE = {
  mutate: ["src/a.ts:1-3", "src/b.ts:5-7"],
  vitestConfig: ".web-tops/out/tests/vitest.config.mjs",
  report: ".web-tops/out/mutation/mutation.json",
  tempDir: ".web-tops/out/mutation/.stryker-tmp",
  concurrency: 3,
};
const PLAN = { ...BASE, tsconfig: "tsconfig.json" };

describe("G7a strykerConfig", () => {
  const config = strykerConfig(PLAN);

  it("runs the Vitest runner on the gate's wrapper, with the TypeScript checker and per-test coverage", () => {
    expect(config).toMatchObject({
      testRunner: "vitest",
      vitest: { configFile: ".web-tops/out/tests/vitest.config.mjs" },
      checkers: ["typescript"],
      tsconfigFile: "tsconfig.json",
      coverageAnalysis: "perTest",
    });
  });

  it("runs the number of workers it was given, and waits three times the measured test time (R78)", () => {
    expect(config).toMatchObject({ concurrency: 3, timeoutFactor: 3 });
    expect(strykerConfig({ ...PLAN, concurrency: 1 })).toMatchObject({ concurrency: 1 });
  });

  it("gives the initial test run fifteen minutes, not Stryker's five, whatever the number of mutants", () => {
    expect(strykerConfig(BASE)).toEqual({
      testRunner: "vitest",
      vitest: { configFile: ".web-tops/out/tests/vitest.config.mjs" },
      checkers: ["typescript"],
      coverageAnalysis: "perTest",
      disableTypeChecks: false,
      concurrency: 3,
      timeoutFactor: 3,
      dryRunTimeoutMinutes: 15,
      mutate: ["src/a.ts:1-3", "src/b.ts:5-7", "!**/*.{test,spec}.?(c|m)[jt]s?(x)"],
      reporters: ["json"],
      jsonReporter: { fileName: ".web-tops/out/mutation/mutation.json" },
      tempDirName: ".web-tops/out/mutation/.stryker-tmp",
      cleanTempDir: true,
    });
  });

  it("mutates the given ranges, and never a test file", () => {
    expect(config["mutate"]).toEqual([
      "src/a.ts:1-3",
      "src/b.ts:5-7",
      "!**/*.{test,spec}.?(c|m)[jt]s?(x)",
    ]);
  });

  it("writes the JSON report and its scratch directory under the gate's out directory, and cleans up", () => {
    expect(config).toMatchObject({
      reporters: ["json"],
      jsonReporter: { fileName: ".web-tops/out/mutation/mutation.json" },
      tempDirName: ".web-tops/out/mutation/.stryker-tmp",
      cleanTempDir: true,
    });
  });

  it("holds no setting a project could use to change what is judged", () => {
    expect(Object.keys(config).sort()).toEqual(
      [
        "checkers",
        "cleanTempDir",
        "concurrency",
        "coverageAnalysis",
        "disableTypeChecks",
        "dryRunTimeoutMinutes",
        "jsonReporter",
        "mutate",
        "reporters",
        "tempDirName",
        "testRunner",
        "timeoutFactor",
        "tsconfigFile",
        "vitest",
      ].sort(),
    );
  });

  it("does not let Stryker write a `// @ts-nocheck` header into the files of the project: tests that read fixtures see them as they are", () => {
    expect(config["disableTypeChecks"]).toBe(false);
  });

  it("omits the checker's tsconfig when the project has none to name", () => {
    expect(strykerConfig(BASE)).not.toHaveProperty("tsconfigFile");
  });

  it("is plain data: it round-trips through JSON unchanged", () => {
    expect(JSON.parse(JSON.stringify(config))).toEqual(config);
  });
});
