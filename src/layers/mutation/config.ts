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
  /** Stryker's worker count: the CPUs the process can use, less one (`usableWorkers`). */
  readonly concurrency: number;
  /** The project's tsconfig for the TypeScript checker, when it has one. */
  readonly tsconfig?: string;
}

/**
 * How many times the measured test time a mutant's run may take before Stryker calls it a timeout. The default 1.5
 * times the dry run, plus 5 s, is short for a run on a loaded runner; a timeout counts as killed, so one that comes
 * of load and not of a loop would hide a weak test (the layer is `not-evaluated` when many do).
 */
const TIMEOUT_FACTOR = 3;

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
    concurrency: plan.concurrency,
    timeoutFactor: TIMEOUT_FACTOR,
    mutate: [...plan.mutate, NOT_TESTS],
    reporters: ["json"],
    jsonReporter: { fileName: plan.report },
    tempDirName: plan.tempDir,
    cleanTempDir: true,
  };
}
