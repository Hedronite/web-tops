import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "../../report/types.ts";
import type { ExecResult } from "../../gate/types.ts";
import {
  arrayOf,
  capFindings,
  exitFinding,
  isRecord,
  parseJson,
  ran,
  refuse,
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
      failed: { findings: [refuse("pack-failed", `${said}: ${tail(printed(result, "stderr"))}`)] },
    };
  }
  return { file: join(step.dir, tarball) };
}

async function publintFindings(step: StepContext, file: string): Promise<Finding[]> {
  const outcome = await ran(step, "publint", ["run", file]);
  if ("failed" in outcome) {
    return [...outcome.failed.findings];
  }
  const { result } = outcome;
  if (result.code === 0) {
    return [];
  }
  const items = publintErrors(result.stdout);
  const shown =
    items.length > 0
      ? items
      : [`publint exited ${String(result.code)}: ${tail(printed(result, "stdout"))}`];
  return shown.map((item) => refuse("publint", item));
}

function entrypointOf(entry: unknown): string {
  return isRecord(entry) ? str(entry["entrypoint"], "?") : "?";
}

function attwEntries(problems: unknown): Finding[] {
  if (!isRecord(problems)) {
    return [];
  }
  return Object.entries(problems).flatMap(([kind, entries]) =>
    arrayOf(entries).map((entry) => refuse(`attw:${kind}`, `entrypoint ${entrypointOf(entry)}`)),
  );
}

function attwProblems(result: ExecResult): Finding[] {
  const value = parseJson(result.stdout);
  if (value === undefined) {
    return [exitFinding("attw-failed", "attw", result, "stderr")];
  }
  const found = attwEntries(isRecord(value) ? value["problems"] : undefined);
  return found.length > 0
    ? found
    : [refuse("attw-failed", `attw exited ${String(result.code)} with no listed problems`)];
}

function attwProfile(esmOnly: boolean): Finding {
  return {
    rule: "attw-profile",
    verdict: "pass",
    message: esmOnly
      ? "attw ran with --profile esm-only: type module and no require condition in exports"
      : "attw ran with its default profile",
  };
}

async function attwFindings(step: StepContext, file: string): Promise<Finding[]> {
  const esmOnly = isEsmOnly(step);
  const profile = esmOnly ? ["--profile", "esm-only"] : [];
  const head = attwProfile(esmOnly);
  const outcome = await ran(step, "attw", [file, "--format", "json", ...profile]);
  if ("failed" in outcome) {
    return [head, ...outcome.failed.findings];
  }
  return [head, ...(outcome.result.code === 0 ? [] : attwProblems(outcome.result))];
}

export async function packageExports(step: StepContext): Promise<StepResult> {
  const packed = await pack(step);
  if ("failed" in packed) {
    return packed.failed;
  }
  const findings = [
    ...(await publintFindings(step, packed.file)),
    ...(await attwFindings(step, packed.file)),
  ];
  return { findings: capFindings(findings, "package_exports") };
}
