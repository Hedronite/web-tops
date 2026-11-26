import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join, relative } from "node:path";
import type { RawFinding } from "../../report/findings.ts";
import type { ExecResult, Layer, LayerContext, LayerResult } from "../../gate/types.ts";
import { COVERAGE_INCLUDE, excludesOf } from "../coverage/scope.ts";
import {
  arrayOf,
  isRecord,
  launchFailure,
  parseJson,
  printed,
  readOutput,
  records,
  failFinding,
  relativeTo,
  runTool,
  str,
  tail,
} from "../hygiene/tooling.ts";

const FOCUSED = /\.only/u;
const SKIPPED: ReadonlySet<string> = new Set(["skipped", "pending", "disabled"]);

/** The project's Vitest config, found as Vitest finds it: `vitest.config.*` before `vite.config.*`. */
const CONFIG_FILES = ["vitest.config", "vite.config"].flatMap((base) =>
  ["ts", "mts", "cts", "js", "mjs", "cjs"].map((extension) => `${base}.${extension}`),
);

function projectConfig(cwd: string): string | undefined {
  const found = CONFIG_FILES.find((name) => existsSync(join(cwd, name)));
  return found === undefined ? undefined : join(cwd, found);
}

/**
 * Where `vite` is, found the way Vitest finds it: from the real directory of the installed `vitest`. In a Bun
 * workspace or any isolated install `vite` sits beside `vitest` and nowhere the project can name, so the kit
 * config imports the file this resolves to (R44). The bare name is the fallback, for a hoisted install.
 */
function viteUrl(cwd: string): string {
  try {
    const vitest = realpathSync(join(cwd, "node_modules", "vitest", "package.json"));
    return pathToFileURL(createRequire(vitest).resolve("vite")).href;
  } catch {
    return "vite";
  }
}

/**
 * The config the gate runs Vitest with. The kit judges the floor itself (gate 3), so it loads the project's
 * own config, whichever form it takes, and removes `test.coverage.thresholds` whole: a glob key, `100: true`,
 * `perFile` and `autoUpdate` all fail a run too, and zeroing the global keys would not stop them (R43).
 */
function kitConfig(project: string | undefined, vite: string, setupPath: string): string {
  if (project === undefined) {
    return "export default {};\n";
  }
  return [
    'import { writeFileSync } from "node:fs";',
    'import { relative, resolve, sep } from "node:path";',
    `const viteUrl = ${JSON.stringify(vite)};`,
    `const project = ${JSON.stringify(project)};`,
    `const setupPath = ${JSON.stringify(setupPath)};`,
    "export default async function config(env) {",
    // A dynamic import by variable, so Vite's config loader does not bundle Vite into the kit config.
    "  const { loadConfigFromFile } = await import(/* @vite-ignore */ viteUrl);",
    "  const loaded = await loadConfigFromFile(env, project);",
    "  const { test = {}, ...rest } = loaded?.config ?? {};",
    "  const { coverage = {}, ...otherTest } = test;",
    "  const { thresholds, ...otherCoverage } = coverage;",
    // Vitest does not instrument setup files, so gate 3 is told which files they are (G4-4).
    "  const root = resolve(rest.root ?? process.cwd());",
    "  const listed = [].concat(otherTest.setupFiles ?? []).map((entry) =>",
    '    relative(process.cwd(), resolve(root, String(entry))).split(sep).join("/"));',
    "  writeFileSync(setupPath, JSON.stringify(listed));",
    "  return { ...rest, test: { ...otherTest, coverage: otherCoverage } };",
    "}",
    "",
  ].join("\n");
}

/**
 * Writes the gate's Vitest config into `directory`: the project's own, without coverage thresholds (see
 * `kitConfig`), and returns its path. Anything else that runs Vitest for the gate, such as the diff engine's
 * per-test-file coverage run, uses this config, so a project's thresholds and coverage scope never decide it.
 */
export function writeKitConfig(cwd: string, directory: string): string {
  const configPath = join(directory, "vitest.config.mjs");
  const setupPath = join(directory, "setup-files.json");
  writeFileSync(setupPath, "[]");
  writeFileSync(configPath, kitConfig(projectConfig(cwd), viteUrl(cwd), setupPath));
  return configPath;
}

function titleOf(assertion: Record<string, unknown>): string {
  return str(assertion["fullName"], str(assertion["title"], "a test"));
}

function messagesOf(assertion: Record<string, unknown>): string[] {
  return arrayOf(assertion["failureMessages"]).map((message) => str(message, ""));
}

const ESCAPE = String.fromCharCode(27);
const COLOUR = new RegExp(`${ESCAPE}\\[[0-9;]*m`, "gu");

/** The first non-empty lines of some output, without colour codes: where a tool names what went wrong. */
function head(text: string, lines: number): string {
  return text
    .replace(COLOUR, "")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(0, lines)
    .join("\n");
}

const STACK_FRAME = /^\s*(?:at |❯)/u;

/** What a failed assertion says: the lines before its stack, so the finding quotes the assertion and not the frames. */
function assertion(messages: string): string {
  const lines = head(messages, Number.MAX_SAFE_INTEGER).split("\n");
  const frame = lines.findIndex((line) => STACK_FRAME.test(line));
  const before = frame === -1 ? lines : lines.slice(0, frame);
  return (before.length > 0 ? before : lines.slice(0, 1)).slice(0, 3).join("\n");
}

/** A test `.only` makes Vitest fail it under `--allowOnly=false`; that failure is a focused test, not a bug in it. */
function failedFinding(name: string, title: string, messages: readonly string[]): RawFinding {
  return messages.some((message) => FOCUSED.test(message))
    ? failFinding("vitest", "focused-test", `${title}: a focused test (.only) is committed`, {
        file: name,
      })
    : failFinding("vitest", "test-failed", `${title}: ${assertion(messages.join("\n"))}`, {
        file: name,
      });
}

/** One failing, skipped or todo test, as a finding. */
function assertionFinding(name: string, assertion: Record<string, unknown>): RawFinding[] {
  const status = str(assertion["status"], "");
  const title = titleOf(assertion);
  if (status === "failed") {
    return [failedFinding(name, title, messagesOf(assertion))];
  }
  if (SKIPPED.has(status)) {
    return [failFinding("vitest", "skipped-test", `${title} is skipped`, { file: name })];
  }
  return status === "todo"
    ? [failFinding("vitest", "todo-test", `${title} is a todo`, { file: name })]
    : [];
}

/** A file that failed with no failing test did not load; with no message at all it holds a focused suite. */
function suiteFinding(name: string, file: Record<string, unknown>): RawFinding[] {
  const assertions = records(file["assertionResults"]);
  if (file["status"] !== "failed" || assertions.some((entry) => entry["status"] === "failed")) {
    return [];
  }
  const message = str(file["message"], "").trim();
  // Under --allowOnly=false a focused suite (describe.only) fails the file with no message at all and skips its tests.
  return [
    message === ""
      ? failFinding("vitest", "focused-test", `${name}: a focused suite (.only) is committed`, {
          file: name,
        })
      : failFinding("vitest", "suite-failed", `${name} did not load: ${tail(message, 3)}`, {
          file: name,
        }),
  ];
}

function testFindings(results: unknown, cwd: string): RawFinding[] {
  return records(results).flatMap((file) => {
    const name = relativeTo(cwd, str(file["name"], "?"));
    return [
      ...records(file["assertionResults"]).flatMap((assertion) =>
        assertionFinding(name, assertion),
      ),
      ...suiteFinding(name, file),
    ];
  });
}

function zeroTests(report: Record<string, unknown>): RawFinding[] {
  const total = report["numTotalTests"];
  return total === 0
    ? [
        failFinding(
          "vitest",
          "zero-tests",
          "no test ran: zero tests is a failure (WEB_TOPS.md section 3.1, gate 2)",
        ),
      ]
    : [];
}

function shuffleArgs(seed: number | undefined): string[] {
  return seed === undefined ? [] : ["--sequence.shuffle", "--sequence.seed", String(seed)];
}

/** One `vitest run`: the gate, not the project's config, chooses what is measured and where it is written (section 6.1). */
function vitestArgs(
  ctx: LayerContext,
  seed: number | undefined,
  jsonPath: string,
  configPath: string,
): string[] {
  const reports = relative(ctx.cwd, join(ctx.outDir, "tests", "coverage"));
  return [
    "run",
    `--config=${relative(ctx.cwd, configPath)}`,
    "--coverage",
    "--coverage.provider=v8",
    `--coverage.include=${COVERAGE_INCLUDE}`,
    "--coverage.reporter=json",
    "--coverage.reporter=lcov",
    `--coverage.reportsDirectory=${reports}`,
    ...excludesOf(ctx.config).map((glob) => `--coverage.exclude=${glob}`),
    "--allowOnly=false",
    ...shuffleArgs(seed),
    // The default reporter runs beside json so that what Vitest prints on stderr names an error it fails the run for.
    "--reporter=default",
    "--reporter=json",
    `--outputFile.json=${jsonPath}`,
  ];
}

function emptyFinding(shown: string, result: ExecResult): RawFinding {
  return result.code === 0
    ? failFinding("vitest", "output-empty", `vitest wrote no results to ${shown}`, { file: shown })
    : failFinding(
        "vitest",
        "vitest-failed",
        `vitest exited ${String(result.code)} before writing results: ${head(printed(result, "stderr"), 6)}`,
      );
}

function parseReport(
  shown: string,
  text: string,
): { readonly report: Record<string, unknown> } | { readonly finding: RawFinding } {
  const value = parseJson(text);
  if (value === undefined) {
    return {
      finding: failFinding(
        "vitest",
        "output-unparseable",
        `vitest results in ${shown} are not JSON`,
        {
          file: shown,
        },
      ),
    };
  }
  return isRecord(value)
    ? { report: value }
    : {
        finding: failFinding(
          "vitest",
          "output-unparseable",
          `vitest results in ${shown} are not an object`,
          {
            file: shown,
          },
        ),
      };
}

function readReport(
  cwd: string,
  path: string,
  result: ExecResult,
): { readonly report: Record<string, unknown> } | { readonly finding: RawFinding } {
  const shown = relativeTo(cwd, path);
  const text = readOutput(path);
  if (text === undefined || text.trim() === "") {
    return { finding: emptyFinding(shown, result) };
  }
  return parseReport(shown, text);
}

/** What the results say: no tests, or a test that failed, was skipped or was focused. */
function judge(report: Record<string, unknown>, cwd: string): RawFinding[] {
  return [...zeroTests(report), ...testFindings(report["testResults"], cwd)];
}

/**
 * Results that show no failing test under a non-zero exit mean Vitest failed the run itself (an unhandled
 * rejection or a thrown timer after a passing test): `vitest-run-failed`, quoting what it printed (R43).
 * The exit code is read only here; a project threshold cannot cause it, because the gate neutralises them.
 */
function withRunFailure(found: readonly RawFinding[], result: ExecResult): RawFinding[] {
  if (found.length > 0 || result.code === 0) {
    return [...found];
  }
  const said = head(printed(result, "stderr"), 6);
  return [
    failFinding(
      "vitest",
      "vitest-run-failed",
      `vitest exited ${String(result.code)} though no test failed: ${said}`,
    ),
  ];
}

function failedResult(finding: RawFinding, seed?: number): LayerResult {
  const entry: LayerResult = { verdict: "fail", findings: [finding], artifacts: {} };
  return seed === undefined ? entry : { ...entry, seed };
}

/** The files gate 2 leaves for gate 3 and for the laws layer, all under `.web-tops/out/tests/`. */
function artifactsOf(directory: string): Record<string, string> {
  const coverage = join(directory, "coverage");
  return {
    "vitest-json": join(directory, "vitest.json"),
    "setup-files": join(directory, "setup-files.json"),
    "vitest-config": join(directory, "vitest.config.mjs"),
    lcov: join(coverage, "lcov.info"),
    "coverage-json": join(coverage, "coverage-final.json"),
  };
}

function finish(
  directory: string,
  findings: readonly RawFinding[],
  seed: number | undefined,
): LayerResult {
  return {
    verdict: findings.some((finding) => finding.verdict === "fail") ? "fail" : "pass",
    findings,
    artifacts: artifactsOf(directory),
    ...(seed === undefined ? {} : { seed }),
  };
}

function seedFor(ctx: LayerContext): number | undefined {
  return ctx.config.tests.shuffle ? randomInt(1, 2 ** 31) : undefined;
}

/** Gate 2: one `vitest run --coverage --sequence.shuffle`; its JSON and LCOV stay in `.web-tops/out/tests/` for gate 3. */
/** Explicit vitest timeout (20 min) so realExec enables detached process-group kill on timeout. */
export const TESTS_TIMEOUT_MS = 20 * 60 * 1000;

async function run(ctx: LayerContext): Promise<LayerResult> {
  const directory = join(ctx.outDir, "tests");
  mkdirSync(directory, { recursive: true });
  const seed = seedFor(ctx);
  const jsonPath = join(directory, "vitest.json");
  const configPath = writeKitConfig(ctx.cwd, directory);
  const result = await runTool(
    ctx,
    "vitest",
    vitestArgs(ctx, seed, jsonPath, configPath),
    TESTS_TIMEOUT_MS,
  );
  const launch = launchFailure("vitest", "vitest", result);
  if (launch !== undefined) {
    return failedResult(launch);
  }
  const read = readReport(ctx.cwd, jsonPath, result);
  if ("finding" in read) {
    return failedResult(read.finding, seed);
  }
  return finish(directory, withRunFailure(judge(read.report, ctx.cwd), result), seed);
}

export const testsLayer: Layer = {
  id: "tests",
  gate: 2,
  tier: 1,
  classes: ["ts-library", "ui-components", "astro-site", "web-app", "node-service"],
  requires: [],
  produces: ["vitest-json", "lcov", "coverage-json", "setup-files", "vitest-config"],
  consumes: [],
  run,
};
