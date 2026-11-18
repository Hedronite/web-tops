/** What the generated Stryker config is built from: the ranges and the gate's own files, never the project's settings. */
export interface StrykerPlan {
  /** `file:start-end` entries, or whole files. */
  readonly mutate: readonly string[];
  /** The gate's Vitest wrapper (the kit config, without coverage thresholds), relative to the project root. */
  readonly vitestConfig: string;
  /** Where Stryker writes its JSON report, relative to the project root. */
  readonly report: string;
  /** Stryker's scratch directory, relative to the project root. */
  readonly tempDir: string;
  /** The project's tsconfig for the TypeScript checker, when it has one. */
  readonly tsconfig?: string;
}

/** A test file is never mutated, however the ranges were chosen. */
const NOT_TESTS = "!**/*.{test,spec}.?(c|m)[jt]s?(x)";

/**
 * The Stryker config of one run (WEB_TOPS.md section 6.4): the Vitest runner on the gate's wrapper, the TypeScript
 * checker so invalid mutants are dropped, per-test coverage, and a JSON report. Written under `.web-tops/out/` for
 * each run; a project's own `stryker.config.*` is never read, so nothing in it can change what is judged.
 */
export function strykerConfig(plan: StrykerPlan): Record<string, unknown> {
  return {
    testRunner: "vitest",
    vitest: { configFile: plan.vitestConfig },
    checkers: ["typescript"],
    ...(plan.tsconfig === undefined || plan.tsconfig === "" ? {} : { tsconfigFile: plan.tsconfig }),
    coverageAnalysis: "perTest",
    // Stryker's default writes `// @ts-nocheck` into every file under src/, test/ and lib/, fixtures included.
    disableTypeChecks: false,
    mutate: [...plan.mutate, NOT_TESTS],
    reporters: ["json"],
    jsonReporter: { fileName: plan.report },
    tempDirName: plan.tempDir,
    cleanTempDir: true,
  };
}
