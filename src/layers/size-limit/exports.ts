import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** One resolved `package.json` `exports` entry ready for byte-size measurement. */
export interface ExportEntry {
  readonly key: string;
  readonly file: string;
  readonly absPath: string;
}

export type ManifestRead =
  | { readonly ok: true; readonly isPrivate: boolean; readonly exportsRaw: unknown }
  | { readonly ok: false; readonly reason: string };

export type ExportsResolve =
  | { readonly ok: true; readonly entries: readonly ExportEntry[] }
  | { readonly ok: false; readonly reason: string; readonly file?: string };

const RUNTIME_CONDITIONS = ["import", "module", "browser", "default", "node", "require"] as const;
const DECLARATION_RE = /\.d\.[cm]?ts$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWithinRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Reads `package.json` beside `cwd` for `private` and `exports`. */
export function readManifestInfo(cwd: string): ManifestRead {
  const manifestPath = join(cwd, "package.json");
  if (!existsSync(manifestPath)) {
    return { ok: false, reason: "package.json is missing" };
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!isRecord(parsed)) return { ok: false, reason: "package.json must be a JSON object" };
    return { ok: true, isPrivate: parsed["private"] === true, exportsRaw: parsed["exports"] };
  } catch (error) {
    return { ok: false, reason: `package.json is unreadable: ${String(error)}` };
  }
}

function firstArrayTarget(items: readonly unknown[]): string | undefined {
  for (const item of items) {
    const picked = pickRuntimeTarget(item);
    if (picked !== undefined) return picked;
  }
  return undefined;
}

function pickCondition(record: Record<string, unknown>): string | undefined {
  for (const condition of RUNTIME_CONDITIONS) {
    const picked = pickRuntimeTarget(record[condition]);
    if (picked !== undefined) return picked;
  }
  return undefined;
}

function runtimeString(value: string): string | undefined {
  return DECLARATION_RE.test(value) ? undefined : value;
}

function pickRuntimeTarget(value: unknown): string | undefined {
  if (typeof value === "string") return runtimeString(value);
  if (Array.isArray(value)) return firstArrayTarget(value);
  return isRecord(value) ? pickCondition(value) : undefined;
}

function collectMapTargets(exportsRaw: Record<string, unknown>): readonly [string, unknown][] {
  const keys = Object.keys(exportsRaw).sort();
  if (!keys.some((key) => key.startsWith("."))) return [[".", exportsRaw]];
  return keys
    .filter((key) => key !== "./package.json" && !key.includes("*"))
    .map((key) => [key, exportsRaw[key]]);
}

function rawTargetPairs(exportsRaw: unknown): readonly [string, unknown][] {
  if (typeof exportsRaw === "string" || Array.isArray(exportsRaw)) return [[".", exportsRaw]];
  return isRecord(exportsRaw) ? collectMapTargets(exportsRaw) : [];
}

function verifyRealFile(
  realRoot: string,
  abs: string,
  key: string,
  rawTarget: string,
):
  | { readonly ok: true; readonly entry: ExportEntry }
  | { readonly ok: false; readonly reason: string } {
  const realTarget = realpathSync(abs);
  if (!isWithinRoot(realRoot, realTarget) || !statSync(realTarget).isFile()) {
    return { ok: false, reason: `export "${key}" target "${rawTarget}" is not a readable file` };
  }
  const file = relative(realRoot, realTarget).split(sep).join("/");
  return { ok: true, entry: { key, file, absPath: realTarget } };
}

function verifyTargetFile(
  cwd: string,
  key: string,
  rawTarget: string,
):
  | { readonly ok: true; readonly entry: ExportEntry }
  | { readonly ok: false; readonly reason: string } {
  const abs = resolve(cwd, rawTarget);
  if (!isWithinRoot(resolve(cwd), abs)) {
    return { ok: false, reason: `export "${key}" target "${rawTarget}" escapes project root` };
  }
  if (!existsSync(abs)) {
    return { ok: false, reason: `export "${key}" target "${rawTarget}" does not exist` };
  }
  return verifyRealFile(realpathSync(cwd), abs, key, rawTarget);
}

function resolvePair(
  cwd: string,
  key: string,
  value: unknown,
):
  | { readonly ok: true; readonly entry?: ExportEntry }
  | { readonly ok: false; readonly reason: string; readonly file: string } {
  const target = pickRuntimeTarget(value);
  if (target === undefined) return { ok: true };
  const verified = verifyTargetFile(cwd, key, target);
  return verified.ok
    ? { ok: true, entry: verified.entry }
    : { ok: false, reason: verified.reason, file: target };
}

function finishResolved(entries: readonly ExportEntry[]): ExportsResolve {
  return entries.length > 0
    ? { ok: true, entries }
    : { ok: false, reason: "package.json exports has no measurable runtime entries" };
}

function resolveAllPairs(cwd: string, pairs: readonly [string, unknown][]): ExportsResolve {
  const entries: ExportEntry[] = [];
  for (const [key, value] of pairs) {
    const resolved = resolvePair(cwd, key, value);
    if (!resolved.ok) return resolved;
    if (resolved.entry !== undefined) entries.push(resolved.entry);
  }
  return finishResolved(entries);
}

/** Resolves measurable runtime `exports` entries from `package.json`, failing closed on missing targets. */
export function resolveExportEntries(cwd: string, exportsRaw: unknown): ExportsResolve {
  if (exportsRaw === undefined) {
    return { ok: false, reason: "package.json declares no exports field" };
  }
  return resolveAllPairs(cwd, rawTargetPairs(exportsRaw));
}
