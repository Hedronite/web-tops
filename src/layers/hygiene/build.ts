import type { RawFinding } from "../../report/findings.ts";
import {
  exitFinding,
  toolOf,
  ran,
  failFinding,
  type StepContext,
  type StepResult,
} from "./tooling.ts";

/** Gate 1, steps `install`, `tsc` and `astro_check`. */

interface ExitStep {
  readonly tool: string;
  readonly args: readonly string[];
  readonly rule: string;
  /** What the tool is called in the finding. */
  readonly label: string;
  /** Which stream the finding quotes first. */
  readonly first: "stdout" | "stderr";
}

/** A tool whose exit code is the whole answer: clean on 0, one finding quoting its output otherwise. */
async function exitStep(step: StepContext, spec: ExitStep): Promise<StepResult> {
  const outcome = await ran(step, spec.tool, spec.args);
  if ("failed" in outcome) {
    return outcome.failed;
  }
  const { result } = outcome;
  return {
    findings:
      result.code === 0
        ? []
        : [exitFinding(toolOf(spec.tool), spec.rule, spec.label, result, spec.first)],
  };
}

export function install(step: StepContext): Promise<StepResult> {
  return exitStep(step, {
    tool: "bun",
    args: ["install", "--frozen-lockfile"],
    rule: "install-failed",
    label: "bun install --frozen-lockfile",
    first: "stderr",
  });
}

export function astroCheck(step: StepContext): Promise<StepResult> {
  return exitStep(step, {
    tool: "astro",
    args: ["check"],
    rule: "astro-check",
    label: "astro check",
    first: "stdout",
  });
}

const TSC_LINE = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/u;

function group(match: RegExpExecArray, index: number): string {
  return match[index] ?? "";
}

function tscFinding(text: string): RawFinding | undefined {
  const match = TSC_LINE.exec(text);
  if (match === null) {
    return undefined;
  }
  return failFinding("tsc", group(match, 3), group(match, 4), {
    file: group(match, 1),
    line: Number.parseInt(group(match, 2), 10),
  });
}

function isFinding(value: RawFinding | undefined): value is RawFinding {
  return value !== undefined;
}

/** `tsc -b --noEmit`, the form checked on 6.0.3 (works composite or not, and writes `tsconfig.tsbuildinfo`). */
export async function tsc(step: StepContext): Promise<StepResult> {
  const outcome = await ran(step, "tsc", ["-b", "--noEmit"]);
  if ("failed" in outcome) {
    return outcome.failed;
  }
  const { result } = outcome;
  if (result.code === 0) {
    return { findings: [] };
  }
  const found = result.stdout.split("\n").map(tscFinding).filter(isFinding);
  const findings =
    found.length > 0 ? found : [exitFinding("tsc", "tsc-failed", "tsc", result, "stdout")];
  return { findings };
}
