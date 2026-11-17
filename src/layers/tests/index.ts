import { randomInt } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { Finding } from "../../report/types.ts";
import type { ExecResult, Layer, LayerContext, LayerResult } from "../../gate/types.ts";
import { COVERAGE_INCLUDE, excludesOf } from "../coverage/scope.ts";
import {
  arrayOf,
  capFindings,
  isRecord,
  launchFailure,
  parseJson,
  printed,
  readOutput,
  records,
  refuse,
  relativeTo,
  runTool,
  str,
  tail,
} from "../hygiene/tooling.ts";

const FOCUSED = /\.only/u;
const SKIPPED: ReadonlySet<string> = new Set(["skipped", "pending", "disabled"]);

/** The kit judges the floor itself (gate 3), so a threshold in the project's config must not decide this gate. */
const NEUTRAL_THRESHOLDS = ["lines", "functions", "branches", "statements"].map(
  (kind) => `--coverage.thresholds.${kind}=0`,
);

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
function failedFinding(name: string, title: string, messages: readonly string[]): Finding {
  return messages.some((message) => FOCUSED.test(message))
    ? refuse("focused-test", `${title}: a focused test (.only) is committed`, { file: name })
    : refuse("test-failed", `${title}: ${assertion(messages.join("\n"))}`, { file: name });
}

/** One failing, skipped or todo test, as a finding. */
function assertionFinding(name: string, assertion: Record<string, unknown>): Finding[] {
  const status = str(assertion["status"], "");
  const title = titleOf(assertion);
  if (status === "failed") {
    return [failedFinding(name, title, messagesOf(assertion))];
  }
  if (SKIPPED.has(status)) {
    return [refuse("skipped-test", `${title} is skipped`, { file: name })];
  }
  return status === "todo" ? [refuse("todo-test", `${title} is a todo`, { file: name })] : [];
}

/** A file that failed with no failing test did not load; with no message at all it holds a focused suite. */
function suiteFinding(name: string, file: Record<string, unknown>): Finding[] {
  const assertions = records(file["assertionResults"]);
  if (file["status"] !== "failed" || assertions.some((entry) => entry["status"] === "failed")) {
    return [];
  }
  const message = str(file["message"], "").trim();
  // Under --allowOnly=false a focused suite (describe.only) fails the file with no message at all and skips its tests.
  return [
    message === ""
      ? refuse("focused-test", `${name}: a focused suite (.only) is committed`, { file: name })
      : refuse("suite-failed", `${name} did not load: ${tail(message, 3)}`, { file: name }),
  ];
}

function testFindings(results: unknown, cwd: string): Finding[] {
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

function zeroTests(report: Record<string, unknown>): Finding[] {
  const total = report["numTotalTests"];
  return total === 0
    ? [
        refuse(
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
function vitestArgs(ctx: LayerContext, seed: number | undefined, jsonPath: string): string[] {
  const reports = relative(ctx.cwd, join(ctx.outDir, "tests", "coverage"));
  return [
    "run",
    "--coverage",
    "--coverage.provider=v8",
    `--coverage.include=${COVERAGE_INCLUDE}`,
    "--coverage.reporter=json",
    "--coverage.reporter=lcov",
    `--coverage.reportsDirectory=${reports}`,
    ...excludesOf(ctx.config).map((glob) => `--coverage.exclude=${glob}`),
    ...NEUTRAL_THRESHOLDS,
    "--allowOnly=false",
    ...shuffleArgs(seed),
    // The default reporter runs beside json so that what Vitest prints on stderr names an error it fails the run for.
    "--reporter=default",
    "--reporter=json",
    `--outputFile.json=${jsonPath}`,
  ];
}

function emptyFinding(shown: string, result: ExecResult): Finding {
  return result.code === 0
    ? refuse("output-empty", `vitest wrote no results to ${shown}`, { file: shown })
    : refuse(
        "vitest-failed",
        `vitest exited ${String(result.code)} before writing results: ${tail(printed(result, "stderr"))}`,
      );
}

function parseReport(
  shown: string,
  text: string,
): { readonly report: Record<string, unknown> } | { readonly finding: Finding } {
  const value = parseJson(text);
  if (value === undefined) {
    return {
      finding: refuse("output-unparseable", `vitest results in ${shown} are not JSON`, {
        file: shown,
      }),
    };
  }
  return isRecord(value)
    ? { report: value }
    : {
        finding: refuse("output-unparseable", `vitest results in ${shown} are not an object`, {
          file: shown,
        }),
      };
}

function readReport(
  cwd: string,
  path: string,
  result: ExecResult,
): { readonly report: Record<string, unknown> } | { readonly finding: Finding } {
  const shown = relativeTo(cwd, path);
  const text = readOutput(path);
  if (text === undefined || text.trim() === "") {
    return { finding: emptyFinding(shown, result) };
  }
  return parseReport(shown, text);
}

/** What the results say: no tests, or a test that failed, was skipped or was focused. */
function judge(report: Record<string, unknown>, cwd: string): Finding[] {
  return [...zeroTests(report), ...testFindings(report["testResults"], cwd)];
}

/**
 * Results that show no failing test under a non-zero exit mean Vitest failed the run itself (an unhandled
 * rejection or a thrown timer after a passing test): `vitest-run-failed`, quoting what it printed (R43).
 * The exit code is read only here; a project threshold cannot cause it, because the gate neutralises them.
 */
function withRunFailure(found: readonly Finding[], result: ExecResult): Finding[] {
  if (found.length > 0 || result.code === 0) {
    return [...found];
  }
  const said = head(printed(result, "stderr"), 6);
  return [
    refuse(
      "vitest-run-failed",
      `vitest exited ${String(result.code)} though no test failed: ${said}`,
    ),
  ];
}

function refused(finding: Finding, seed?: number): LayerResult {
  const entry: LayerResult = { verdict: "Refuse", findings: [finding], artifacts: {} };
  return seed === undefined ? entry : { ...entry, seed };
}

/** The files gate 2 leaves for gate 3 and for the laws layer, all under `.web-tops/out/tests/`. */
function artifactsOf(directory: string): Record<string, string> {
  const coverage = join(directory, "coverage");
  return {
    "vitest-json": join(directory, "vitest.json"),
    lcov: join(coverage, "lcov.info"),
    "coverage-json": join(coverage, "coverage-final.json"),
  };
}

function finish(
  directory: string,
  findings: readonly Finding[],
  seed: number | undefined,
): LayerResult {
  const capped = capFindings(findings, "tests");
  return {
    verdict: capped.some((finding) => finding.verdict === "Refuse") ? "Refuse" : "pass",
    findings: capped,
    artifacts: artifactsOf(directory),
    ...(seed === undefined ? {} : { seed }),
  };
}

function seedFor(ctx: LayerContext): number | undefined {
  return ctx.config.tests.shuffle ? randomInt(1, 2 ** 31) : undefined;
}

/** Gate 2: one `vitest run --coverage --sequence.shuffle`; its JSON and LCOV stay in `.web-tops/out/tests/` for gate 3. */
async function run(ctx: LayerContext): Promise<LayerResult> {
  const directory = join(ctx.outDir, "tests");
  mkdirSync(directory, { recursive: true });
  const seed = seedFor(ctx);
  const jsonPath = join(directory, "vitest.json");
  const result = await runTool(ctx, "vitest", vitestArgs(ctx, seed, jsonPath));
  const launch = launchFailure("vitest", result);
  if (launch !== undefined) {
    return refused(launch);
  }
  const read = readReport(ctx.cwd, jsonPath, result);
  if ("finding" in read) {
    return refused(read.finding, seed);
  }
  return finish(directory, withRunFailure(judge(read.report, ctx.cwd), result), seed);
}

export const testsLayer: Layer = {
  id: "tests",
  gate: 2,
  tier: 1,
  classes: ["ts-library", "ui-components", "astro-site", "web-app", "node-service"],
  requires: [],
  produces: ["vitest-json", "lcov", "coverage-json"],
  consumes: [],
  run,
};
