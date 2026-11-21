import { ackedFiles, type AckedFiles } from "../../acks/files.ts";
import { catalogSeverity } from "../../acks/severity.ts";
import { utcDate } from "../../survivors/dates.ts";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import type { RawFinding } from "../../report/findings.ts";
import type { Tool } from "../../report/types.ts";
import type { ExecResult, HygieneSettings, LayerContext } from "../../gate/types.ts";

/** What a step needs from the layer: the context, the settings and a way to run one tool. */
export interface StepContext {
  readonly ctx: LayerContext;
  readonly settings: HygieneSettings;
  readonly run: (tool: string, args: readonly string[]) => Promise<ExecResult>;
  /** The layer's own directory under `.web-tops/out`. */
  readonly dir: string;
  /** A path inside `dir`. */
  readonly out: (name: string) => string;
  readonly pkg: PackageInfo;
}

export interface StepResult {
  readonly findings: readonly RawFinding[];
  readonly artifacts?: Readonly<Record<string, string>>;
}

/** An installed package and the name its `bin` field gives the tool. */
interface ToolSpec {
  readonly package: string;
  readonly bin: string;
}

/**
 * The tools the gate runs. Each resolves from the project's `node_modules` through the installed package's
 * `bin` field and runs under `node`; none is looked up on `PATH` (WEB_TOPS.md section 3.1). `bun` and `node`
 * are runtimes, not tools, and come from `PATH`; the lock checks their versions.
 */
export function tools(): ReadonlyMap<string, ToolSpec> {
  return new Map([
    ["tsc", { package: "typescript", bin: "tsc" }],
    ["astro", { package: "astro", bin: "astro" }],
    ["eslint", { package: "eslint", bin: "eslint" }],
    ["stylelint", { package: "stylelint", bin: "stylelint" }],
    ["prettier", { package: "prettier", bin: "prettier" }],
    ["biome", { package: "@biomejs/biome", bin: "biome" }],
    ["depcruise", { package: "dependency-cruiser", bin: "depcruise" }],
    ["publint", { package: "publint", bin: "publint" }],
    ["attw", { package: "@arethetypeswrong/cli", bin: "attw" }],
    ["vitest", { package: "vitest", bin: "vitest" }],
    ["stryker", { package: "@stryker-mutator/core", bin: "stryker" }],
    ["secretlint", { package: "secretlint", bin: "secretlint" }],
    ["knip", { package: "knip", bin: "knip" }],
  ]);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a tool's output file: undefined when it is missing, "" when it is empty. */
export function readOutput(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/** The parsed JSON, or undefined when the text is missing or is not JSON. */
export function parseJson(text: string | undefined): unknown {
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function binField(manifest: unknown): unknown {
  return isRecord(manifest) ? manifest["bin"] : undefined;
}

/** A string `bin` names the one executable; an object names one per command. */
function pickBin(bin: unknown, name: string): string | undefined {
  if (typeof bin === "string") {
    return bin;
  }
  const entry = isRecord(bin) ? bin[name] : undefined;
  return typeof entry === "string" ? entry : undefined;
}

/** The executable file of an installed tool, or undefined when its package is not in `node_modules`. */
export function resolveTool(cwd: string, spec: ToolSpec): string | undefined {
  const directory = join(cwd, "node_modules", spec.package);
  const manifest = parseJson(readOutput(join(directory, "package.json")));
  const relativeBin = pickBin(binField(manifest), spec.bin);
  if (relativeBin === undefined) {
    return undefined;
  }
  const entry = join(directory, relativeBin);
  return existsSync(entry) ? entry : undefined;
}

/** The files the ack ledger covers for W-28 today: the ledger's entries for it that have not expired. */
export const readLedger = (cwd: string): AckedFiles =>
  ackedFiles(cwd, "W-28", utcDate(new Date()), catalogSeverity());

/**
 * The environment that tells the ESLint preset which files the ledger covers for W-28 (`WEBTOPS_ACKED_FILES`, JSON by
 * law), so the rule does not flag them. A ledger that lists none, or cannot be read, adds nothing: the finding stays,
 * and the laws layer and `webtops acks` report the ledger.
 */
export const ackedEnv = (acked: AckedFiles): Record<string, string> =>
  acked.ok && acked.files.length > 0
    ? { WEBTOPS_ACKED_FILES: JSON.stringify({ "W-28": acked.files }) }
    : {};

/** The environment a tool runs in: the layer's own, and for ESLint the ledger's files as well. */
export const toolEnv = (
  ctx: LayerContext,
  name: string,
  ledger: (cwd: string) => AckedFiles = readLedger,
): LayerContext["env"] =>
  name === "eslint" ? { ...ctx.env, ...ackedEnv(ledger(ctx.cwd)) } : ctx.env;

/** Runs a tool's executable under `node`; a missing `node` is worded so it is not blamed on the tool. */
async function underNode(
  ctx: LayerContext,
  name: string,
  entry: string,
  args: readonly string[],
  timeoutMs?: number,
): Promise<ExecResult> {
  const limit = timeoutMs === undefined ? {} : { timeoutMs };
  const result = await ctx.exec("node", [entry, ...args], {
    cwd: ctx.cwd,
    env: toolEnv(ctx, name),
    ...limit,
  });
  return result.failure === "tool-missing"
    ? { ...result, stderr: `node is not on PATH, so ${name} cannot run` }
    : result;
}

/**
 * Runs one command. A tool in `tools()` resolves from `node_modules`; one that is not installed there is
 * `tool-missing` and nothing is started. Any other command is a runtime and comes from `PATH`.
 */
export async function runTool(
  ctx: LayerContext,
  name: string,
  args: readonly string[],
  timeoutMs?: number,
): Promise<ExecResult> {
  const spec = tools().get(name);
  if (spec === undefined) {
    return ctx.exec(name, args, { cwd: ctx.cwd, env: ctx.env });
  }
  const entry = resolveTool(ctx.cwd, spec);
  if (entry === undefined) {
    const stderr = `${name} is not installed in node_modules (package ${spec.package})`;
    return { code: null, stdout: "", stderr, failure: "tool-missing" };
  }
  return underNode(ctx, name, entry, args, timeoutMs);
}

/** The finding's tool for a name the steps run or print: the runtime key, or a label such as `bun audit`. */
const toolNames = (): Readonly<Record<string, Tool>> => ({
  astro: "astro",
  attw: "attw",
  biome: "biome",
  bun: "bun",
  "bun audit": "audit",
  "bun pm pack": "bun",
  "dependency-cruiser": "dependency-cruiser",
  depcruise: "dependency-cruiser",
  eslint: "eslint",
  prettier: "prettier",
  publint: "publint",
  stryker: "stryker",
  stylelint: "stylelint",
  tsc: "tsc",
  vitest: "vitest",
});

/** `webtops` for anything that is not one of the named tools: the gate's own checks. */
export function toolOf(name: string): Tool {
  return toolNames()[name] ?? "webtops";
}

export function failFinding(
  tool: Tool,
  rule: string,
  message: string,
  place: { file?: string; line?: number } = {},
): RawFinding {
  return { tool, rule, verdict: "fail", message, ...place };
}

/** A tool that could not run or was killed, as the tool-failure rule R5 names. */
export function launchFailure(
  tool: Tool,
  label: string,
  result: ExecResult,
): RawFinding | undefined {
  if (result.failure === "tool-missing") {
    const said = result.stderr.trim();
    return failFinding(
      tool,
      "tool-missing",
      said === "" ? `${label} is not installed or not on PATH` : said,
    );
  }
  if (result.failure === "tool-timeout") {
    return failFinding(tool, "tool-timeout", `${label} did not finish in time and was killed`);
  }
  return undefined;
}

export type Ran = { readonly result: ExecResult } | { readonly failed: StepResult };

/** Runs a tool for a step: its result, or the step result that says it could not run. */
export async function ran(
  step: StepContext,
  tool: string,
  args: readonly string[],
  label: string = tool,
): Promise<Ran> {
  const result = await step.run(tool, args);
  const launch = launchFailure(toolOf(tool), label, result);
  return launch === undefined ? { result } : { failed: { findings: [launch] } };
}

/** The last lines of a tool's output, for a finding that has nothing better to quote. */
export function tail(text: string, lines = 8): string {
  return text.trim().split("\n").slice(-lines).join("\n");
}

/** What a tool printed, for a finding: stderr first (or stdout first), whichever is not empty. */
export function printed(result: ExecResult, first: "stdout" | "stderr"): string {
  return first === "stdout" ? result.stdout || result.stderr : result.stderr || result.stdout;
}

/** `<label> exited N: <what it printed>`. */
export function exitFinding(
  tool: Tool,
  rule: string,
  label: string,
  result: ExecResult,
  first: "stdout" | "stderr",
): RawFinding {
  return failFinding(
    tool,
    rule,
    `${label} exited ${String(result.code)}: ${tail(printed(result, first))}`,
  );
}

/** A tool that exited non-zero without a finding to show for it still fails the step. */
export function unexplained(
  tool: Tool,
  findings: readonly RawFinding[],
  result: ExecResult,
  rule: string,
  label: string,
  detail = "no findings",
): RawFinding[] {
  if (findings.length > 0 || result.code === 0) {
    return [...findings];
  }
  return [
    failFinding(
      tool,
      rule,
      `${label} exited ${String(result.code)} with ${detail}: ${tail(result.stderr)}`,
    ),
  ];
}

/** A path relative to the project, for reports that should not carry absolute paths. */
export function relativeTo(cwd: string, path: string): string {
  if (!isAbsolute(path)) {
    return path;
  }
  // A tool may print the resolved form of a symlinked directory (macOS temp dirs), so try both.
  const direct = relative(cwd, path);
  if (!direct.startsWith("..")) {
    return direct;
  }
  const resolved = relative(realpathSync(cwd), path);
  return resolved.startsWith("..") ? path : resolved;
}

/** The text when the value is one, else the fallback. */
export function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** The elements of a JSON array, or none when the value is not one. */
export function arrayOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The objects among the elements of a JSON array. */
export function records(value: unknown): Record<string, unknown>[] {
  return arrayOf(value).filter(isRecord);
}

/** `file` and `line` from a tool's JSON, for the finding's place. */
export function place(cwd: string, file: unknown, line: unknown): { file?: string; line?: number } {
  return {
    ...(typeof file === "string" ? { file: relativeTo(cwd, file) } : {}),
    ...(typeof line === "number" ? { line } : {}),
  };
}

/** A tool's JSON came back in a shape the step does not know. */
export function shapeFinding(
  tool: Tool,
  step: StepContext,
  path: string,
  message: string,
): RawFinding {
  return failFinding(tool, "output-unparseable", message, { file: relativeTo(step.ctx.cwd, path) });
}

export interface PackageInfo {
  readonly name: string;
  readonly version: string;
  readonly type?: string;
  /** The `exports` field as JSON text, to test for a `require` condition. */
  readonly exportsText: string;
}

/** The fields of `package.json` the steps decide on; a missing or broken file gives empty values. */
export function readPackage(cwd: string): PackageInfo {
  const value = parseJson(readOutput(join(cwd, "package.json")));
  if (!isRecord(value)) {
    return { name: "", version: "", exportsText: "" };
  }
  const type = value["type"];
  return {
    name: str(value["name"], ""),
    version: str(value["version"], ""),
    ...(typeof type === "string" ? { type } : {}),
    exportsText: value["exports"] === undefined ? "" : JSON.stringify(value["exports"]),
  };
}

function isBlank(text: string | undefined): boolean {
  return text === undefined || text.trim() === "";
}

/** Shared by steps whose tool writes JSON: missing, empty and unparseable all fail (WEB_TOPS.md section 3.4, rule 5). */
export function readJsonOutput(
  step: StepContext,
  path: string,
  text: string | undefined,
  tool: string,
): { readonly value: unknown } | { readonly finding: RawFinding } {
  const shown = relativeTo(step.ctx.cwd, path);
  if (isBlank(text)) {
    return {
      finding: failFinding(toolOf(tool), "output-empty", `${tool} wrote no output to ${shown}`, {
        file: shown,
      }),
    };
  }
  const value = parseJson(text);
  return value === undefined
    ? {
        finding: failFinding(
          toolOf(tool),
          "output-unparseable",
          `${tool} output in ${shown} is not JSON`,
          {
            file: shown,
          },
        ),
      }
    : { value };
}

/** A tool that writes its JSON to a file: a non-zero exit with no file is the tool failing, not the file being empty. */
export function readResultsFile(
  step: StepContext,
  tool: string,
  path: string,
  result: ExecResult,
): { readonly value: unknown } | { readonly finding: RawFinding } {
  const text = readOutput(path);
  if (isBlank(text) && result.code !== 0) {
    return { finding: exitFinding(toolOf(tool), `${tool}-failed`, tool, result, "stderr") };
  }
  return readJsonOutput(step, path, text, tool);
}
