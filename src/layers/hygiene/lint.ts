import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "../../report/types.ts";
import {
  arrayOf,
  capFindings,
  exitFinding,
  isRecord,
  place,
  ran,
  readJsonOutput,
  readResultsFile,
  records,
  refuse,
  shapeFinding,
  str,
  tail,
  unexplained,
  type StepContext,
  type StepResult,
} from "./tooling.ts";
import type { ExecResult } from "../../gate/types.ts";

/** Gate 1, steps `eslint`, `stylelint`, `format` and `dependency_cruiser`. */

function eslintArgs(config: string | undefined, path: string): string[] {
  return [
    "--format",
    "json",
    "--output-file",
    path,
    ...(config === undefined ? [] : ["--config", config]),
    ".",
  ];
}

function eslintFinding(
  step: StepContext,
  entry: Record<string, unknown>,
  message: Record<string, unknown>,
): Finding {
  return refuse(
    str(message["ruleId"], "eslint-fatal"),
    str(message["message"], "no message"),
    place(step.ctx.cwd, entry["filePath"], message["line"]),
  );
}

/** ESLint runs once with its JSON kept in `outDir`; the laws layer reads that file, not a second run. */
export async function eslint(step: StepContext): Promise<StepResult> {
  const path = step.out("eslint.json");
  const outcome = await ran(step, "eslint", eslintArgs(step.settings.eslintConfig, path));
  if ("failed" in outcome) {
    return outcome.failed;
  }
  const { result } = outcome;
  const read = readResultsFile(step, "eslint", path, result);
  if ("finding" in read) {
    return { findings: [read.finding] };
  }
  if (!Array.isArray(read.value)) {
    return {
      findings: [shapeFinding(step, path, "eslint JSON is not an array of file results")],
    };
  }
  const found = records(read.value).flatMap((entry) =>
    records(entry["messages"]).map((message) => eslintFinding(step, entry, message)),
  );
  return {
    findings: capFindings(unexplained(found, result, "eslint-failed", "eslint"), "eslint"),
    artifacts: { "eslint-json": path },
  };
}

function stylelintFinding(
  step: StepContext,
  entry: Record<string, unknown>,
  warning: Record<string, unknown>,
): Finding {
  return refuse(
    str(warning["rule"], "stylelint"),
    str(warning["text"], "no message"),
    place(step.ctx.cwd, entry["source"], warning["line"]),
  );
}

/** Stylelint writes its JSON to a file: its `json` formatter prints to stderr, which a tool wrapper should not scrape. */
export async function stylelint(step: StepContext, globs: readonly string[]): Promise<StepResult> {
  const path = step.out("stylelint.json");
  const args = ["--formatter", "json", "--output-file", path, "--allow-empty-input", ...globs];
  const outcome = await ran(step, "stylelint", args);
  if ("failed" in outcome) {
    return outcome.failed;
  }
  const { result } = outcome;
  const read = readResultsFile(step, "stylelint", path, result);
  if ("finding" in read) {
    return { findings: [read.finding] };
  }
  const found = records(read.value).flatMap((entry) =>
    records(entry["warnings"]).map((warning) => stylelintFinding(step, entry, warning)),
  );
  return {
    findings: capFindings(unexplained(found, result, "stylelint-failed", "stylelint"), "stylelint"),
    artifacts: { "stylelint-json": path },
  };
}

const PRETTIER_CONFIGS = [
  "prettier.config.js",
  "prettier.config.mjs",
  "prettier.config.cjs",
  "prettier.config.ts",
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  ".prettierrc.js",
  ".prettierrc.mjs",
  ".prettierrc.cjs",
  ".prettierrc.toml",
];
const BIOME_CONFIGS = ["biome.json", "biome.jsonc"];

function hasConfig(step: StepContext, names: readonly string[]): boolean {
  return names.some((name) => existsSync(join(step.ctx.cwd, name)));
}

/** Both configs, or neither: the repo does not say which formatter to use. */
function formatterFinding(bothPresent: boolean): Finding {
  return bothPresent
    ? refuse(
        "formatter-ambiguous",
        "both a Prettier and a Biome config are present; set gates.hygiene.format.tool",
      )
    : refuse(
        "formatter-unset",
        "no Prettier or Biome config is present; set gates.hygiene.format.tool",
      );
}

/** `format.tool` when set, else the one formatter config in the repo (WEB_TOPS.md section 9). */
export function chooseFormatter(
  step: StepContext,
): { tool: "prettier" | "biome" } | { finding: Finding } {
  const set = step.settings.formatTool;
  if (set !== undefined) {
    return { tool: set };
  }
  const prettier = hasConfig(step, PRETTIER_CONFIGS);
  if (prettier === hasConfig(step, BIOME_CONFIGS)) {
    return { finding: formatterFinding(prettier) };
  }
  return { tool: prettier ? "prettier" : "biome" };
}

const PRETTIER_WARN = /^\[warn\] (.+)$/u;

const FORMAT_ARGS: Readonly<Record<"prettier" | "biome", readonly string[]>> = {
  prettier: ["--check", "."],
  biome: ["format", "."],
};

function unformatted(result: ExecResult): Finding[] {
  return `${result.stdout}\n${result.stderr}`.split("\n").flatMap((line) => {
    const file = PRETTIER_WARN.exec(line)?.[1];
    return file === undefined || file.startsWith("Code style issues")
      ? []
      : [refuse("format", `${file} is not formatted`, { file })];
  });
}

function formatFindings(tool: string, result: ExecResult): Finding[] {
  if (result.code === 0) {
    return [];
  }
  const files = unformatted(result);
  return files.length > 0 ? files : [exitFinding("format-failed", tool, result, "stderr")];
}

export async function format(step: StepContext): Promise<StepResult> {
  const chosen = chooseFormatter(step);
  if ("finding" in chosen) {
    return { findings: [chosen.finding] };
  }
  const outcome = await ran(step, chosen.tool, FORMAT_ARGS[chosen.tool]);
  if ("failed" in outcome) {
    return outcome.failed;
  }
  return { findings: capFindings(formatFindings(chosen.tool, outcome.result), "format") };
}

/** dependency-cruiser over `src` (or the project root when there is none), with its config in the repo root. */
function cruiseArgs(cwd: string): string[] {
  const root = existsSync(join(cwd, "src")) ? "src" : ".";
  return [root, "--config", ".dependency-cruiser.cjs", "--output-type", "json"];
}

/** No report on stdout: the tool failed, or said nothing. */
function silentCruise(result: ExecResult): Finding | undefined {
  if (result.stdout.trim() !== "") {
    return undefined;
  }
  const rule = result.code === 0 ? "output-empty" : "dependency-cruiser-failed";
  return refuse(
    rule,
    `depcruise exited ${String(result.code)} and printed no report: ${tail(result.stderr)}`,
  );
}

function violationsOf(value: unknown): readonly unknown[] | undefined {
  const summary = isRecord(value) ? value["summary"] : undefined;
  return isRecord(summary) && Array.isArray(summary["violations"])
    ? arrayOf(summary["violations"])
    : undefined;
}

function cruiseFinding(violation: Record<string, unknown>): Finding[] {
  const rule = violation["rule"];
  if (!isRecord(rule) || rule["severity"] !== "error") {
    return [];
  }
  const from = str(violation["from"], "?");
  return [
    refuse(str(rule["name"], "dependency-cruiser"), `${from} -> ${str(violation["to"], "?")}`, {
      file: from,
    }),
  ];
}

function readViolations(
  step: StepContext,
  path: string,
  stdout: string,
): { readonly violations: readonly unknown[] } | { readonly finding: Finding } {
  const parsed = readJsonOutput(step, path, stdout, "dependency-cruiser");
  if ("finding" in parsed) {
    return parsed;
  }
  const violations = violationsOf(parsed.value);
  return violations === undefined
    ? { finding: shapeFinding(step, path, "depcruise JSON has no summary.violations") }
    : { violations };
}

export async function dependencyCruiser(step: StepContext): Promise<StepResult> {
  const path = step.out("dependency-cruiser.json");
  const label = "dependency-cruiser";
  const outcome = await ran(step, "depcruise", cruiseArgs(step.ctx.cwd), label);
  if ("failed" in outcome) {
    return outcome.failed;
  }
  const { result } = outcome;
  const silent = silentCruise(result);
  if (silent !== undefined) {
    return { findings: [silent] };
  }
  writeFileSync(path, result.stdout);
  const read = readViolations(step, path, result.stdout);
  if ("finding" in read) {
    return { findings: [read.finding] };
  }
  const found = records(read.violations).flatMap(cruiseFinding);
  const findings = unexplained(
    found,
    result,
    "dependency-cruiser-failed",
    "depcruise",
    "no error violations",
  );
  return {
    findings: capFindings(findings, label),
    artifacts: { "dependency-cruiser-json": path },
  };
}
