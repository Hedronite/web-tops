import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { brotliCompressSync } from "node:zlib";
import type { Layer, LayerContext, LayerResult } from "../../gate/types.ts";
import type { RawFinding } from "../../report/findings.ts";
import { BROTLI_OPTIONS, ensureBuild, type DistInventory } from "../build/index.ts";
import { budgetForPage } from "./budgets.ts";
import { resolvePageModuleClosure } from "./closure.ts";
import { extractPageScripts } from "./html.ts";

export interface PageBytesReport {
  readonly file: string;
  readonly route: string;
  readonly hasIsland: boolean;
  readonly inlineBytes: number;
  readonly moduleBytes: number;
  readonly totalBytes: number;
  readonly budgetBytes: number;
  readonly modules: readonly string[];
  readonly passed: boolean;
}

/** Brotli size at quality 11 and window 22 bits (identical on Node and Bun). */
export function brotliBytes(content: string | Buffer): number {
  return brotliCompressSync(content, BROTLI_OPTIONS).length;
}

/** Memoized file brotli sizer shared across pages in a single `bytes` layer run. */
export function createBrotliCache(
  compress: (content: Buffer) => number = brotliBytes,
  read: (path: string) => Buffer = readFileSync,
): (fullPath: string) => number {
  const cache = new Map<string, number>();
  return (fullPath) => {
    const hit = cache.get(fullPath);
    if (hit !== undefined) return hit;
    const size = compress(read(fullPath));
    cache.set(fullPath, size);
    return size;
  };
}

function failLayer(reason: string, findings: readonly RawFinding[]): LayerResult {
  return { verdict: "fail", reason, findings, artifacts: {} };
}

function sumInlineBytes(bodies: readonly string[]): number {
  return bodies.reduce((total, body) => total + brotliBytes(Buffer.from(body, "utf8")), 0);
}

function sumModuleBytes(
  distDir: string,
  modules: readonly string[],
  measureFile: (fullPath: string) => number,
): number {
  let total = 0;
  for (const mod of modules) total += measureFile(join(distDir, mod));
  return total;
}

function measurePage(
  context: LayerContext,
  inventory: DistInventory,
  files: ReadonlySet<string>,
  measureFile: (fullPath: string) => number,
  page: DistInventory["pages"][number],
): PageBytesReport | { readonly error: string; readonly file: string } {
  const html = readFileSync(join(inventory.distDir, page.file), "utf8");
  const scripts = extractPageScripts(html);
  const closure = resolvePageModuleClosure(
    inventory.distDir,
    files,
    page.file,
    scripts.inlineBodies,
    scripts.externalRefs,
  );
  if (!closure.ok) return { error: closure.reason, file: page.file };
  const inlineBytes = sumInlineBytes(scripts.inlineBodies);
  const moduleBytes = sumModuleBytes(inventory.distDir, closure.modules, measureFile);
  const totalBytes = inlineBytes + moduleBytes;
  const budgetBytes = budgetForPage(
    page.route,
    context.config.class,
    scripts.hasIsland,
    context.config.budgets,
  );
  return {
    file: page.file,
    route: page.route,
    hasIsland: scripts.hasIsland,
    inlineBytes,
    moduleBytes,
    totalBytes,
    budgetBytes,
    modules: closure.modules,
    passed: totalBytes <= budgetBytes,
  };
}

function pageFinding(page: PageBytesReport): RawFinding {
  const cmp = page.passed ? "<=" : "exceeds budget";
  return {
    tool: "webtops",
    rule: "W-29",
    law: "W-29",
    verdict: page.passed ? "pass" : "fail",
    file: page.file,
    message: `page ${page.route} (${page.file}) JS is ${String(page.totalBytes)} B brotli (${cmp} ${String(page.budgetBytes)} B)`,
  };
}

function writeReport(outDir: string, pages: readonly PageBytesReport[]): string {
  const reportPath = join(outDir, "bytes", "report.json");
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify({ pages }, null, 2)}\n`);
  return reportPath;
}

function emptyDistResult(outDir: string): LayerResult {
  const reason = "no HTML pages found in built dist/ directory";
  const artifact = writeReport(outDir, []);
  return {
    verdict: "not-evaluated",
    reason,
    findings: [
      { tool: "webtops", rule: "W-29", law: "W-29", verdict: "not-evaluated", message: reason },
    ],
    artifacts: { "bytes-json": artifact },
  };
}

function moduleErrorResult(file: string, message: string): LayerResult {
  return failLayer(message, [
    { tool: "webtops", rule: "W-29", law: "W-29", verdict: "fail", file, message },
  ]);
}

function saveBytesResult(outDir: string, reports: readonly PageBytesReport[]): LayerResult {
  const artifact = writeReport(outDir, reports);
  return {
    verdict: reports.some((entry) => !entry.passed) ? "fail" : "pass",
    findings: reports.map(pageFinding),
    artifacts: { "bytes-json": artifact },
  };
}

function collectPages(context: LayerContext, inventory: DistInventory): LayerResult {
  const files = new Set(inventory.files);
  const measureFile = createBrotliCache();
  const reports: PageBytesReport[] = [];
  for (const page of inventory.pages) {
    const res = measurePage(context, inventory, files, measureFile, page);
    if ("error" in res) return moduleErrorResult(res.file, res.error);
    reports.push(res);
  }
  return saveBytesResult(context.outDir, reports);
}

/** Page JavaScript byte budget layer (W-29, brotli q11/w22 over `dist/`, WEB_TOPS.md §7). */
export const bytesLayer: Layer = {
  id: "bytes",
  gate: 6,
  tier: 1,
  classes: ["astro-site", "web-app"],
  requires: ["build"],
  produces: ["bytes-json"],
  consumes: [{ artifact: "inventory", from: "build" }],
  run: async (context) => {
    const built = await ensureBuild(context);
    if (!built.ok) return failLayer(built.reason, built.findings);
    return built.inventory.pages.length === 0
      ? emptyDistResult(context.outDir)
      : collectPages(context, built.inventory);
  },
};
