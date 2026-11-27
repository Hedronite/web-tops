import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExecResult, LayerContext } from "../../gate/types.ts";
import type { ExportEntry } from "./exports.ts";

export interface MeasuredEntry {
  readonly key: string;
  readonly file: string;
  readonly size: number;
}

export type MeasureResult =
  | { readonly ok: true; readonly entries: readonly MeasuredEntry[] }
  | { readonly ok: false; readonly reason: string };

const SIZE_LIMIT_TIMEOUT_MS = 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMainField(pkgJsonPath: string): string {
  const raw: unknown = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  return isRecord(raw) && typeof raw["main"] === "string" ? raw["main"] : "index.js";
}

function resolveMainUrl(pkgDir: string, pkgJsonPath: string): string | undefined {
  try {
    const entry = join(realpathSync(pkgDir), readMainField(pkgJsonPath));
    return existsSync(entry) ? pathToFileURL(entry).href : undefined;
  } catch {
    return undefined;
  }
}

function packageEntryUrl(cwd: string, pkgName: string): string | undefined {
  const pkgDir = join(cwd, "node_modules", pkgName);
  const pkgJsonPath = join(pkgDir, "package.json");
  return existsSync(pkgJsonPath) ? resolveMainUrl(pkgDir, pkgJsonPath) : undefined;
}

function runnerScript(
  sizeLimitUrl: string,
  filePluginUrl: string,
  entries: readonly ExportEntry[],
): string {
  const items = entries.map((entry) => ({
    key: entry.key,
    file: entry.file,
    absPath: entry.absPath,
  }));
  return [
    `import sizeLimit from ${JSON.stringify(sizeLimitUrl)};`,
    `import filePlugin from ${JSON.stringify(filePluginUrl)};`,
    `const entries = ${JSON.stringify(items)};`,
    "const results = [];",
    "for (const entry of entries) {",
    "  const [measured] = await sizeLimit(filePlugin, [entry.absPath]);",
    '  if (typeof measured?.size !== "number") {',
    "    throw new Error(`size-limit produced no size for ${entry.key}`);",
    "  }",
    "  results.push({ key: entry.key, file: entry.file, size: measured.size });",
    "}",
    "process.stdout.write(JSON.stringify({ results }));",
    "",
  ].join("\n");
}

function hasValidFields(key: unknown, file: unknown, size: unknown): boolean {
  return typeof key === "string" && typeof file === "string" && typeof size === "number";
}

function parseEntry(raw: unknown): MeasuredEntry | undefined {
  if (!isRecord(raw)) return undefined;
  const { key, file, size } = raw;
  if (!hasValidFields(key, file, size)) return undefined;
  return { key: String(key), file: String(file), size: Number(size) };
}

function collectEntries(
  items: readonly unknown[],
  expectedCount: number,
): MeasuredEntry[] | undefined {
  const out: MeasuredEntry[] = [];
  for (const item of items) {
    const entry = parseEntry(item);
    if (entry === undefined) return undefined;
    out.push(entry);
  }
  return out.length === expectedCount ? out : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parseResults(stdout: string, expectedCount: number): MeasuredEntry[] | undefined {
  const parsed = parseJson(stdout);
  if (!isRecord(parsed) || !Array.isArray(parsed["results"])) return undefined;
  return collectEntries(parsed["results"], expectedCount);
}

function exitTail(result: ExecResult): string {
  const text = result.stderr.trim() || result.stdout.trim();
  const suffix = text === "" ? "" : `: ${text}`;
  return `exit ${String(result.code ?? "null")}${suffix}`;
}

function failureReason(result: ExecResult): string | undefined {
  if (result.failure === undefined && result.code === 0) return undefined;
  const why = result.failure ?? exitTail(result);
  return `size-limit failed (${why})`;
}

function interpretOutput(result: ExecResult, expectedCount: number): MeasureResult {
  const failed = failureReason(result);
  if (failed !== undefined) return { ok: false, reason: failed };
  const entries = parseResults(result.stdout, expectedCount);
  return entries === undefined
    ? { ok: false, reason: "size-limit printed an unreadable JSON result" }
    : { ok: true, entries };
}

/** Runs pinned `size-limit` + `@size-limit/file` under Node across all resolved `exports` entries. */
export async function measureExports(
  context: LayerContext,
  entries: readonly ExportEntry[],
): Promise<MeasureResult> {
  const sizeLimitUrl = packageEntryUrl(context.cwd, "size-limit");
  const filePluginUrl = packageEntryUrl(context.cwd, "@size-limit/file");
  if (sizeLimitUrl === undefined || filePluginUrl === undefined) {
    return { ok: false, reason: "size-limit or @size-limit/file is not installed in node_modules" };
  }
  const scriptPath = join(context.outDir, "size-limit", "measure.mjs");
  mkdirSync(dirname(scriptPath), { recursive: true });
  writeFileSync(scriptPath, runnerScript(sizeLimitUrl, filePluginUrl, entries));
  const result = await context.exec("node", [scriptPath], {
    cwd: context.cwd,
    env: context.env,
    timeoutMs: SIZE_LIMIT_TIMEOUT_MS,
  });
  return interpretOutput(result, entries.length);
}
