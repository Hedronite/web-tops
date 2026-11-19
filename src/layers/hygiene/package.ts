import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RawFinding } from "../../report/findings.ts";
import type { ExecResult } from "../../gate/types.ts";
import {
  arrayOf,
  exitFinding,
  isRecord,
  parseJson,
  ran,
  failFinding,
  str,
  tail,
  printed,
  type StepContext,
  type StepResult,
} from "./tooling.ts";

/** Gate 1, `layers.package_exports`: publint and attw on the packed tarball, for the package classes. */

/** Only a package that is `type: module` and names no `require` condition is ESM-only (R18). */
export function isEsmOnly(step: StepContext): boolean {
  return step.pkg.type === "module" && !step.pkg.exportsText.includes('"require"');
}

const PUBLINT_ITEM = /^\d+\. (.+)$/u;
const PUBLINT_HEADING = /^[A-Z][a-z]+:$/u;

/** The numbered lines under publint's `Errors:` heading; warnings and suggestions do not fail the gate. */
function publintErrors(stdout: string): string[] {
  const lines = stdout.split("\n");
  const start = lines.indexOf("Errors:");
  if (start === -1) {
    return [];
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => PUBLINT_HEADING.test(line));
  const section = end === -1 ? rest : rest.slice(0, end);
  return section.flatMap((line) => {
    const item = PUBLINT_ITEM.exec(line)?.[1];
    return item === undefined ? [] : [item];
  });
}

/** `bun pm pack` into the layer's directory: the tarball's path, or the step result that says why not. */
async function pack(
  step: StepContext,
): Promise<{ readonly file: string } | { readonly failed: StepResult }> {
  const outcome = await ran(step, "bun", ["pm", "pack", "--destination", step.dir], "bun pm pack");
  if ("failed" in outcome) {
    return outcome;
  }
  const { result } = outcome;
  const tarball = readdirSync(step.dir).find((name) => name.endsWith(".tgz"));
  if (result.code !== 0 || tarball === undefined) {
    const said = `bun pm pack exited ${String(result.code)} and left no tarball`;
    return {
      failed: {
        findings: [
          failFinding("bun", "pack-failed", `${said}: ${tail(printed(result, "stderr"))}`),
        ],
      },
    };
  }
  return { file: join(step.dir, tarball) };
}

/** What publint said: its exit code and the errors it listed. The laws layer reads this as `publint-json`. */
export interface PublintReport {
  readonly code: number | null;
  readonly errors: readonly string[];
}

/** What attw said: its exit code and each problem with the entry point it names. The laws layer reads this as `attw-json`. */
export interface AttwReport {
  readonly code: number | null;
  readonly problems: readonly { readonly kind: string; readonly entrypoint: string }[];
}

interface Part<T> {
  readonly findings: RawFinding[];
  readonly report?: T;
}

/** What a publint that exited non-zero is reported as: each error it listed, or the one finding that says what it printed. */
function publintFailures(result: ExecResult, items: readonly string[]): RawFinding[] {
  const shown =
    items.length > 0
      ? items
      : [`publint exited ${String(result.code)}: ${tail(printed(result, "stdout"))}`];
  return shown.map((item) => failFinding("publint", "publint", item));
}

async function publintPart(step: StepContext, file: string): Promise<Part<PublintReport>> {
  const outcome = await ran(step, "publint", ["run", file]);
  if ("failed" in outcome) {
    return { findings: [...outcome.failed.findings] };
  }
  const { result } = outcome;
  const items = result.code === 0 ? [] : publintErrors(result.stdout);
  const findings = result.code === 0 ? [] : publintFailures(result, items);
  return { findings, report: { code: result.code, errors: items } };
}

function entrypointOf(entry: unknown): string {
  return isRecord(entry) ? str(entry["entrypoint"], "?") : "?";
}

function attwProblemList(problems: unknown): AttwReport["problems"] {
  if (!isRecord(problems)) {
    return [];
  }
  return Object.entries(problems).flatMap(([kind, entries]) =>
    arrayOf(entries).map((entry) => ({ kind, entrypoint: entrypointOf(entry) })),
  );
}

function attwProblems(result: ExecResult): RawFinding[] {
  const value = parseJson(result.stdout);
  if (value === undefined) {
    return [exitFinding("attw", "attw-failed", "attw", result, "stderr")];
  }
  const found = attwProblemList(isRecord(value) ? value["problems"] : undefined).map((problem) =>
    failFinding("attw", `attw:${problem.kind}`, `entrypoint ${problem.entrypoint}`),
  );
  return found.length > 0
    ? found
    : [
        failFinding(
          "attw",
          "attw-failed",
          `attw exited ${String(result.code)} with no listed problems`,
        ),
      ];
}

function attwProfile(esmOnly: boolean): RawFinding {
  return {
    tool: "attw",
    rule: "attw-profile",
    verdict: "pass",
    message: esmOnly
      ? "attw ran with --profile esm-only: type module and no require condition in exports"
      : "attw ran with its default profile",
  };
}

function attwReport(result: ExecResult): AttwReport {
  const value = result.code === 0 ? undefined : parseJson(result.stdout);
  return {
    code: result.code,
    problems: attwProblemList(isRecord(value) ? value["problems"] : undefined),
  };
}

async function attwPart(step: StepContext, file: string): Promise<Part<AttwReport>> {
  const esmOnly = isEsmOnly(step);
  const profile = esmOnly ? ["--profile", "esm-only"] : [];
  const head = attwProfile(esmOnly);
  const outcome = await ran(step, "attw", [file, "--format", "json", ...profile]);
  if ("failed" in outcome) {
    return { findings: [head, ...outcome.failed.findings] };
  }
  const { result } = outcome;
  const found = result.code === 0 ? [] : attwProblems(result);
  return { findings: [head, ...found], report: attwReport(result) };
}

/** Writes a tool's report beside the other artifacts of the layer, and names it, or names nothing when the tool gave none. */
function keepReport(
  step: StepContext,
  name: string,
  report: PublintReport | AttwReport | undefined,
): Record<string, string> {
  if (report === undefined) {
    return {};
  }
  const path = step.out(`${name}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return { [`${name}-json`]: path };
}

export async function packageExports(step: StepContext): Promise<StepResult> {
  const packed = await pack(step);
  if ("failed" in packed) {
    return packed.failed;
  }
  const publint = await publintPart(step, packed.file);
  const attw = await attwPart(step, packed.file);
  return {
    findings: [...publint.findings, ...attw.findings],
    artifacts: {
      ...keepReport(step, "publint", publint.report),
      ...keepReport(step, "attw", attw.report),
    },
  };
}
