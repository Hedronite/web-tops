import { readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import type { Exec, ExecResult } from "../../gate/types.ts";
import { TOOLS, parseJson, readOutput, resolveTool } from "../../layers/hygiene/tooling.ts";
import { judgeLaw } from "./judge.ts";
import { parseMarkers } from "./markers.ts";
import { readEslint, readTsc, type Reading } from "./observe.ts";
import { listTwins, materialize } from "./twins.ts";
import type { Expectation, Observed, ProbeLaw, ProbeReport, Twin } from "./types.ts";

export interface ProbeRequest {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly exec: Exec;
  /** The twins: `<fixtures>/W-NN/{bad,clean}/`. */
  readonly fixtures: string;
  /** Where the twins are copied to and linted, inside the project: `.web-tops/out/laws-probe`. */
  readonly scratch: string;
  readonly laws: readonly ProbeLaw[];
  /** The ESLint config to prove, or undefined for the one ESLint finds from the project. */
  readonly eslintConfig: string | undefined;
  /** The tsconfig whose flags are proven: the project's own. */
  readonly tsconfig: string;
}

/** The probe could not run: 3 when a tool is missing or timed out, 2 when a config or output is unusable. */
export interface ProbeProblem {
  readonly ok: false;
  readonly problem: string;
  readonly code: 2 | 3;
}

export type ProbeOutcome = { readonly ok: true; readonly report: ProbeReport } | ProbeProblem;

type Pass = { readonly ok: true; readonly seen: readonly Observed[] } | ProbeProblem;

const TAIL = 600;
const tail = (text: string): string => text.trim().slice(-TAIL);

const problem = (text: string, code: 2 | 3 = 2): ProbeProblem => ({
  ok: false,
  problem: text,
  code,
});

/** Runs a tool from the project's `node_modules` under `node`; a tool that is not installed is not started. */
async function runTool(
  request: ProbeRequest,
  name: string,
  args: readonly string[],
): Promise<ExecResult> {
  const spec = TOOLS.get(name);
  const entry = spec === undefined ? undefined : resolveTool(request.cwd, spec);
  if (entry === undefined) {
    return {
      code: null,
      stdout: "",
      stderr: `${name} is not installed in node_modules`,
      failure: "tool-missing",
    };
  }
  return request.exec("node", [entry, ...args], { cwd: request.cwd, env: request.env });
}

/** A tool that did not run to an exit, or exited with a code outside `fine`, is a problem to report. */
function stopped(
  name: string,
  result: ExecResult,
  fine: readonly number[],
): ProbeProblem | undefined {
  if (result.failure !== undefined) {
    return problem(`${name} did not run: ${result.failure}. ${tail(result.stderr)}`, 3);
  }
  return result.code !== null && fine.includes(result.code)
    ? undefined
    : problem(
        `${name} exited ${String(result.code)}: ${tail(`${result.stderr}\n${result.stdout}`)}`,
      );
}

function passOf(name: string, reading: Reading, shown: string): Pass {
  return reading === undefined
    ? problem(`${name} wrote output the probe cannot read: ${tail(shown)}`)
    : { ok: true, seen: reading };
}

async function eslintPass(request: ProbeRequest): Promise<Pass> {
  const output = join(request.scratch, "eslint.json");
  const config = request.eslintConfig === undefined ? [] : ["--config", request.eslintConfig];
  const args = ["--no-ignore", "--format", "json", "--output-file", output, ...config];
  const result = await runTool(request, "eslint", [
    ...args,
    relative(request.cwd, request.scratch),
  ]);
  const failed = stopped("eslint", result, [0, 1]);
  const text = readOutput(output);
  return (
    failed ?? passOf("eslint", readEslint(request.scratch, parseJson(text)), text ?? result.stderr)
  );
}

async function tscPass(request: ProbeRequest): Promise<Pass> {
  const project = join(request.scratch, "tsconfig.json");
  const result = await runTool(request, "tsc", ["-p", project, "--noEmit", "--pretty", "false"]);
  const failed = stopped("tsc", result, [0, 1, 2]);
  return (
    failed ?? passOf("tsc", readTsc(request.scratch, request.cwd, result.stdout), result.stdout)
  );
}

function marksOf(scratch: string, twins: readonly Twin[]): Expectation[] {
  return twins.flatMap((twin) =>
    parseMarkers(twin.file, readFileSync(join(scratch, twin.file), "utf8")),
  );
}

function report(
  request: ProbeRequest,
  twins: readonly Twin[],
  seen: readonly Observed[],
): ProbeReport {
  const marks = marksOf(request.scratch, twins);
  return {
    laws: request.laws.map((law) =>
      judgeLaw({ law, twins: twins.filter((twin) => twin.law === law.id), marks, seen }),
    ),
  };
}

/**
 * The request with the project and the scratch directory by their real paths: the tools name a file by its real path,
 * and a temp directory may be a link (`/var` on macOS), so a path read back must be compared to a real one.
 */
const real = (request: ProbeRequest): ProbeRequest => ({
  ...request,
  cwd: realpathSync(request.cwd),
  scratch: realpathSync(request.scratch),
});

/**
 * Proves the readers of the given laws: copies the twins into the scratch project, lints them once and compiles them
 * once, under the project's own ESLint config and tsconfig, and judges each law from what the tools reported.
 */
export async function runProbe(given: ProbeRequest): Promise<ProbeOutcome> {
  const twins = listTwins(given.fixtures, given.laws);
  materialize(given.fixtures, given.scratch, given.laws, given.tsconfig);
  const request = real(given);
  const linted = await eslintPass(request);
  if (!linted.ok) {
    return linted;
  }
  const compiled = await tscPass(request);
  if (!compiled.ok) {
    return compiled;
  }
  return { ok: true, report: report(request, twins, [...linted.seen, ...compiled.seen]) };
}
