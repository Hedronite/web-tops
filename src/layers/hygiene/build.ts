import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadTypeScript } from "../../complexity/load.ts";
import type { ExecResult } from "../../gate/types.ts";
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

/** `bun install --frozen-lockfile`; its exit code is kept as `install-json` for the laws layer (W-40). */
export async function install(step: StepContext): Promise<StepResult> {
  const outcome = await ran(step, "bun", ["install", "--frozen-lockfile"]);
  if ("failed" in outcome) {
    return outcome.failed;
  }
  const { result } = outcome;
  const path = step.out("install.json");
  writeFileSync(
    path,
    `${JSON.stringify({ command: "bun install --frozen-lockfile", code: result.code })}\n`,
  );
  const label = "bun install --frozen-lockfile";
  return {
    findings:
      result.code === 0 ? [] : [exitFinding("bun", "install-failed", label, result, "stderr")],
    artifacts: { "install-json": path },
  };
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

/** One diagnostic of `tsc -b`, as the laws layer reads it from `tsc-diagnostics.json`. */
export interface TscDiagnostic {
  /** Project-relative with `/` separators, or null for a diagnostic about no file, such as a config error. */
  readonly file: string | null;
  readonly line: number | null;
  readonly column: number | null;
  /** `TS` and digits, as tsc prints it. */
  readonly code: string;
  /** The first line of the message. */
  readonly message: string;
}

const TSC_DIAGNOSTIC = /^(?:(.+?)\((\d+),(\d+)\): )?error (TS\d+): (.*)/u;

function optional<T>(text: string | undefined, make: (text: string) => T): T | null {
  return text === undefined ? null : make(text);
}

function diagnosticOf(text: string): TscDiagnostic | undefined {
  const match = TSC_DIAGNOSTIC.exec(text);
  if (match === null) {
    return undefined;
  }
  const count = (digits: string): number => Number.parseInt(digits, 10);
  return {
    file: optional(match[1], (name) => name.replaceAll("\\", "/")),
    line: optional(match[2], count),
    column: optional(match[3], count),
    code: String(match[4]),
    message: String(match[5]),
  };
}

function isDiagnostic(value: TscDiagnostic | undefined): value is TscDiagnostic {
  return value !== undefined;
}

function diagnosticFinding(diagnostic: TscDiagnostic): RawFinding | undefined {
  if (diagnostic.file === null || diagnostic.line === null) {
    return undefined;
  }
  return failFinding("tsc", diagnostic.code, diagnostic.message, {
    file: diagnostic.file,
    line: diagnostic.line,
  });
}

function isFinding(value: RawFinding | undefined): value is RawFinding {
  return value !== undefined;
}

function tscFindings(result: ExecResult, diagnostics: readonly TscDiagnostic[]): RawFinding[] {
  if (result.code === 0) {
    return [];
  }
  const found = diagnostics.map(diagnosticFinding).filter(isFinding);
  return found.length > 0 ? found : [exitFinding("tsc", "tsc-failed", "tsc", result, "stdout")];
}

/**
 * Writes `tsc-diagnostics.json`: every diagnostic, `[]` for a clean compile. A failed run with no diagnostic
 * to read writes nothing, so a missing file means tsc gave no answer, never a clean one.
 */
function keepDiagnostics(
  step: StepContext,
  code: number | null,
  diagnostics: readonly TscDiagnostic[],
): Record<string, string> {
  if (code !== 0 && diagnostics.length === 0) {
    return {};
  }
  const path = step.out("tsc-diagnostics.json");
  writeFileSync(path, `${JSON.stringify(diagnostics, null, 2)}\n`);
  return { "tsc-diagnostics": path };
}

/**
 * Whether `tsconfig.json` lists projects in `references`, read as the JSONC it is (a comment that mentions
 * `references` does not count). tsc refuses a referenced project whose emit is off (TS6310), and `--noEmit` turns it
 * off for every project of the build, so such a root is built without it. A file that cannot be read has none.
 */
function hasReferences(cwd: string): boolean {
  try {
    const ts = loadTypeScript(cwd);
    const read = ts.readConfigFile(join(cwd, "tsconfig.json"), (file) => ts.sys.readFile(file));
    const listed: unknown = Reflect.get(Object(read.config), "references");
    return read.error === undefined && Array.isArray(listed) && listed.length > 0;
  } catch {
    return false;
  }
}

/**
 * `tsc -b --noEmit`, the form checked on 6.0.3 (works composite or not, and writes `tsconfig.tsbuildinfo`); a
 * `tsconfig.json` with `references` is built with `tsc -b`, the referenced projects emitting only their declarations.
 */
export async function tsc(step: StepContext): Promise<StepResult> {
  const outcome = await ran(step, "tsc", hasReferences(step.ctx.cwd) ? ["-b"] : ["-b", "--noEmit"]);
  if ("failed" in outcome) {
    return outcome.failed;
  }
  const { result } = outcome;
  const diagnostics =
    result.code === 0 ? [] : result.stdout.split("\n").map(diagnosticOf).filter(isDiagnostic);
  return {
    findings: tscFindings(result, diagnostics),
    artifacts: keepDiagnostics(step, result.code, diagnostics),
  };
}
