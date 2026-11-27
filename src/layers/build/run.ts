import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExecResult, LayerContext } from "../../gate/types.ts";
import type { RawFinding } from "../../report/findings.ts";
import {
  checkTargetPath,
  resolveDistDir,
  scanDist,
  type DistInventory,
  type DistPage,
} from "./inventory.ts";
import { startStaticServer, type StaticServer, type StaticServerOptions } from "./server.ts";

export interface BuildArtifact {
  readonly version: 1;
  readonly distDir: string;
  readonly pages: readonly DistPage[];
  readonly files: readonly string[];
}

export type BuildRunResult =
  | { readonly ok: true; readonly inventory: DistInventory; readonly manifestPath: string }
  | { readonly ok: false; readonly reason: string; readonly findings: readonly RawFinding[] };

const buildPromises = new WeakMap<Map<string, unknown>, Promise<BuildRunResult>>();
const serverPromises = new WeakMap<Map<string, unknown>, Map<string, Promise<StaticServer>>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPageShape(file: unknown, route: unknown, bytes: unknown): boolean {
  return typeof file === "string" && typeof route === "string" && typeof bytes === "number";
}

function parsePage(entry: unknown): DistPage | undefined {
  if (!isRecord(entry)) return undefined;
  const file = Reflect.get(entry, "file");
  const route = Reflect.get(entry, "route");
  const bytes = Reflect.get(entry, "bytes");
  if (!isPageShape(file, route, bytes)) return undefined;
  return { file: String(file), route: String(route), bytes: Number(bytes) };
}

function parseString(item: unknown): string | undefined {
  return typeof item === "string" ? item : undefined;
}

function collectParsed<T>(
  items: readonly unknown[],
  itemParser: (item: unknown) => T | undefined,
): T[] | undefined {
  const out: T[] = [];
  for (const item of items) {
    const parsed = itemParser(item);
    if (parsed === undefined) return undefined;
    out.push(parsed);
  }
  return out;
}

function parseArray<T>(
  value: unknown,
  itemParser: (item: unknown) => T | undefined,
): T[] | undefined {
  return Array.isArray(value) ? collectParsed(value, itemParser) : undefined;
}

function parseVersioned(raw: unknown): Record<string, unknown> | undefined {
  return isRecord(raw) && Reflect.get(raw, "version") === 1 ? raw : undefined;
}

function assembleInventory(
  distDir: string,
  pages: DistPage[] | undefined,
  files: string[] | undefined,
): DistInventory | undefined {
  if (pages === undefined || files === undefined) return undefined;
  return { distDir, pages, files };
}

function parseArtifactPayload(raw: unknown): DistInventory | undefined {
  const doc = parseVersioned(raw);
  if (doc === undefined || typeof doc["distDir"] !== "string") return undefined;
  return assembleInventory(
    doc["distDir"],
    parseArray(doc["pages"], parsePage),
    parseArray(doc["files"], parseString),
  );
}

function readTextSafe(
  path: string,
): { readonly ok: true; readonly text: string } | { readonly ok: false } {
  try {
    return { ok: true, text: readFileSync(path, "utf8") };
  } catch {
    return { ok: false };
  }
}

function parseJsonSafe(
  text: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** Reads and validates a build inventory artifact JSON written by `buildLayer`. */
export function readInventoryArtifact(path: string): DistInventory | undefined {
  const file = readTextSafe(path);
  if (!file.ok) return undefined;
  const parsed = parseJsonSafe(file.text);
  return parsed.ok ? parseArtifactPayload(parsed.value) : undefined;
}

function failResult(rule: string, message: string): BuildRunResult {
  return {
    ok: false,
    reason: message,
    findings: [{ tool: "webtops", rule, verdict: "fail", message }],
  };
}

function tailDetail(result: ExecResult): string {
  const detail = (result.stderr.trim() || result.stdout.trim()).split("\n").slice(-3).join(" | ");
  const suffix = detail === "" ? "" : `: ${detail}`;
  return `exit ${String(result.code ?? "null")}${suffix}`;
}

function execErrorDetail(result: ExecResult): string {
  return result.failure ?? tailDetail(result);
}

/** Explicit timeout passed to `exec` so `realExec` spawns a process group (`detached: true`) and reaps grandchildren on timeout. */
export const BUILD_TIMEOUT_MS = 600_000;

export interface EnsureBuildOptions {
  readonly timeoutMs?: number;
}

async function execBuild(
  context: LayerContext,
  command: string,
  timeoutMs: number,
): Promise<BuildRunResult | undefined> {
  const result = await context.exec("sh", ["-c", command], {
    cwd: context.cwd,
    env: context.env,
    timeoutMs,
  });
  if (result.failure === undefined && result.code === 0) return undefined;
  return failResult(
    "build-command",
    `build command "${command}" failed (${execErrorDetail(result)})`,
  );
}

function runBuildCommand(
  context: LayerContext,
  timeoutMs: number,
): Promise<BuildRunResult | undefined> {
  const command = context.config.build?.command;
  return command === undefined
    ? Promise.resolve(undefined)
    : execBuild(context, command, timeoutMs);
}

function writeManifest(outDir: string, inventory: DistInventory): string {
  const manifestPath = join(outDir, "build", "inventory.json");
  mkdirSync(dirname(manifestPath), { recursive: true });
  const payload: BuildArtifact = {
    version: 1,
    distDir: inventory.distDir,
    pages: inventory.pages,
    files: inventory.files,
  };
  writeFileSync(manifestPath, `${JSON.stringify(payload, null, 2)}\n`);
  return manifestPath;
}

function scanAndRecord(cwd: string, outDir: string, dirName: string): BuildRunResult {
  const resolved = resolveDistDir(cwd, dirName);
  if (!resolved.ok) return failResult("build-missing-dist", resolved.reason);
  const inventory = scanDist(resolved.dir);
  return { ok: true, inventory, manifestPath: writeManifest(outDir, inventory) };
}

const configuredDir = (context: LayerContext): string => context.config.build?.dir ?? "dist";

async function performBuild(context: LayerContext, timeoutMs: number): Promise<BuildRunResult> {
  const dirName = configuredDir(context);
  const target = checkTargetPath(context.cwd, dirName);
  if (!target.ok) return failResult("build-path", target.reason);
  const failed = await runBuildCommand(context, timeoutMs);
  return failed ?? scanAndRecord(context.cwd, context.outDir, dirName);
}

function cachedBuild(context: LayerContext, timeoutMs: number): Promise<BuildRunResult> {
  const cache = context.runCache;
  if (cache === undefined) return performBuild(context, timeoutMs);
  const existing = buildPromises.get(cache);
  if (existing !== undefined) return existing;
  const created = performBuild(context, timeoutMs);
  buildPromises.set(cache, created);
  return created;
}

function readHandedBuild(handedPath: string): BuildRunResult {
  const loaded = readInventoryArtifact(handedPath);
  return loaded === undefined
    ? failResult("build-artifact", `handed-off build inventory "${handedPath}" is unreadable`)
    : { ok: true, inventory: loaded, manifestPath: handedPath };
}

function timeoutOf(options?: EnsureBuildOptions): number {
  return options?.timeoutMs ?? BUILD_TIMEOUT_MS;
}

/**
 * Ensures `dist/` is built (at most once per `runGate` run) and inventoried into `.web-tops/out/build/inventory.json`.
 * Consumes an existing N5 `inventory` artifact when handed off by `buildLayer`.
 */
export function ensureBuild(
  context: LayerContext,
  options?: EnsureBuildOptions,
): Promise<BuildRunResult> {
  const handedPath = context.artifacts.get("inventory");
  return handedPath === undefined
    ? cachedBuild(context, timeoutOf(options))
    : Promise.resolve(readHandedBuild(handedPath));
}

function startTrackedServer(
  context: LayerContext,
  distDir: string,
  options?: StaticServerOptions,
): Promise<StaticServer> {
  return startStaticServer(distDir, options).then((server) => {
    context.onCleanup?.(server.close);
    return server;
  });
}

function serversFor(cache: Map<string, unknown>): Map<string, Promise<StaticServer>> {
  const known = serverPromises.get(cache);
  if (known !== undefined) return known;
  const fresh = new Map<string, Promise<StaticServer>>();
  serverPromises.set(cache, fresh);
  return fresh;
}

/**
 * Starts (or reuses within the same `runGate` session) the shared static server for `dist/`, registering
 * deterministic teardown on `context.onCleanup`.
 */
const resolveServerOptions = (options?: StaticServerOptions): StaticServerOptions => ({
  spaFallback: Boolean(options?.spaFallback),
});

export function ensureServer(
  context: LayerContext,
  distDir: string,
  options?: StaticServerOptions,
): Promise<StaticServer> {
  const resolved = resolveServerOptions(options);
  const cache = context.runCache;
  if (cache === undefined) return startTrackedServer(context, distDir, resolved);
  const map = serversFor(cache);
  const key = `${distDir}#${String(Boolean(resolved.spaFallback))}`;
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const created = startTrackedServer(context, distDir, resolved);
  map.set(key, created);
  return created;
}
