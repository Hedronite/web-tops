import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
import { startStaticServer, type StaticServer } from "./server.ts";

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
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPageShape(file: unknown, route: unknown, bytes: unknown): boolean {
  return typeof file === "string" && typeof route === "string" && typeof bytes === "number";
}

function parsePage(entry: unknown): DistPage | undefined {
  if (!isRecord(entry)) return undefined;
  const { file, route, bytes } = entry;
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
  return isRecord(raw) && raw["version"] === 1 ? raw : undefined;
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

/** Reads and validates a build inventory artifact JSON written by `buildLayer`. */
export function readInventoryArtifact(path: string): DistInventory | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return parseArtifactPayload(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return undefined;
  }
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

async function execBuild(
  context: LayerContext,
  command: string,
): Promise<BuildRunResult | undefined> {
  const result = await context.exec("sh", ["-c", command], {
    cwd: context.cwd,
    env: context.env,
  });
  if (result.failure === undefined && result.code === 0) return undefined;
  return failResult(
    "build-command",
    `build command "${command}" failed (${execErrorDetail(result)})`,
  );
}

function runBuildCommand(context: LayerContext): Promise<BuildRunResult | undefined> {
  const command = context.config.build?.command;
  return command === undefined ? Promise.resolve(undefined) : execBuild(context, command);
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

async function performBuild(context: LayerContext): Promise<BuildRunResult> {
  const dirName = configuredDir(context);
  const target = checkTargetPath(context.cwd, dirName);
  if (!target.ok) return failResult("build-path", target.reason);
  const failed = await runBuildCommand(context);
  return failed ?? scanAndRecord(context.cwd, context.outDir, dirName);
}

function cachedBuild(context: LayerContext): Promise<BuildRunResult> {
  const cache = context.runCache;
  if (cache === undefined) return performBuild(context);
  const existing = buildPromises.get(cache);
  if (existing !== undefined) return existing;
  const created = performBuild(context);
  buildPromises.set(cache, created);
  return created;
}

/**
 * Ensures `dist/` is built (at most once per `runGate` run) and inventoried into `.web-tops/out/build/inventory.json`.
 * Consumes an existing N5 `inventory` artifact when handed off by `buildLayer`.
 */
export function ensureBuild(context: LayerContext): Promise<BuildRunResult> {
  const handedPath = context.artifacts.get("inventory");
  if (handedPath === undefined) return cachedBuild(context);
  const loaded = readInventoryArtifact(handedPath);
  if (loaded !== undefined) {
    return Promise.resolve({ ok: true, inventory: loaded, manifestPath: handedPath });
  }
  return Promise.resolve(
    failResult("build-artifact", `handed-off build inventory "${handedPath}" is unreadable`),
  );
}

function startTrackedServer(context: LayerContext, distDir: string): Promise<StaticServer> {
  return startStaticServer(distDir).then((server) => {
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
export function ensureServer(context: LayerContext, distDir: string): Promise<StaticServer> {
  const cache = context.runCache;
  if (cache === undefined) return startTrackedServer(context, distDir);
  const map = serversFor(cache);
  const existing = map.get(distDir);
  if (existing !== undefined) return existing;
  const created = startTrackedServer(context, distDir);
  map.set(distDir, created);
  return created;
}
