import { join } from "node:path";
import type { PageMetric } from "../config/report.ts";
import { axeLayer } from "../layers/axe/index.ts";
import { buildLayer } from "../layers/build/index.ts";
import { bytesLayer } from "../layers/bytes/index.ts";
import { htmlLayer } from "../layers/html/index.ts";
import { isRecord, parseJson, readOutput, records } from "../layers/hygiene/tooling.ts";
import { linksLayer } from "../layers/links/index.ts";
import { routeBytesLayer } from "../layers/route-bytes/index.ts";
import { sizeLimitLayer } from "../layers/size-limit/index.ts";
import type { Metrics, Verdict } from "../report/types.ts";
import type { Layer, LayerContext, LayerResult } from "./types.ts";

/** Injectable Gate 6 sub-layers for deterministic testing and real execution. */
export interface BuildOutputSubLayers {
  readonly build: Layer;
  readonly html: Layer;
  readonly links: Layer;
  readonly bytes: Layer;
  readonly routeBytes: Layer;
  readonly axe: Layer;
  readonly sizeLimit: Layer;
}

const DEFAULT_SUBS = (): BuildOutputSubLayers => ({
  build: buildLayer,
  html: htmlLayer(),
  links: linksLayer,
  bytes: bytesLayer,
  routeBytes: routeBytesLayer(),
  axe: axeLayer(),
  sizeLimit: sizeLimitLayer,
});

const WORST_FIRST: readonly Verdict[] = [
  "refuse",
  "ack-missing",
  "fail",
  "not-run",
  "not-evaluated",
  "vacuous",
  "skip",
  "pass",
];

const worse = (left: Verdict, right: Verdict): Verdict =>
  WORST_FIRST.find((verdict) => verdict === left || verdict === right) ?? left;

const subEnabled = (context: LayerContext, id: string): boolean =>
  context.config.subLayers?.[id]?.enabled !== false;

function siteLayers(context: LayerContext, subs: BuildOutputSubLayers, isApp: boolean): Layer[] {
  return [
    ...(subEnabled(context, "html") ? [subs.html] : []),
    subs.links,
    isApp ? subs.routeBytes : subs.bytes,
    ...(subEnabled(context, "axe") ? [subs.axe] : []),
  ];
}

function subContext(context: LayerContext, artifacts: ReadonlyMap<string, string>): LayerContext {
  return {
    ...context,
    outDir: join(context.outDir, "build-output"),
    spaFallback: context.config.class === "web-app",
    artifacts: new Map(artifacts),
  };
}

function addArtifacts(store: Map<string, string>, found: Readonly<Record<string, string>>): void {
  for (const [name, path] of Object.entries(found)) store.set(name, path);
}

async function runSite(
  context: LayerContext,
  subs: BuildOutputSubLayers,
  isApp: boolean,
): Promise<readonly LayerResult[]> {
  const store = new Map<string, string>();
  const built = await subs.build.run(subContext(context, store));
  addArtifacts(store, built.artifacts);
  if (built.verdict !== "pass") return [built];
  const results: LayerResult[] = [built];
  for (const layer of siteLayers(context, subs, isApp)) {
    const res = await layer.run(subContext(context, store));
    addArtifacts(store, res.artifacts);
    results.push(res);
  }
  return results;
}

async function runPackage(
  context: LayerContext,
  subs: BuildOutputSubLayers,
): Promise<readonly LayerResult[]> {
  if (!subEnabled(context, "size-limit")) return [];
  return [await subs.sizeLimit.run(subContext(context, new Map()))];
}

const PACKAGE_CLASSES = new Set(["ts-library", "ui-components"]);

function runByClass(
  context: LayerContext,
  subs: BuildOutputSubLayers,
): Promise<readonly LayerResult[]> {
  const cls = context.config.class;
  if (cls === "astro-site" || cls === "web-app") return runSite(context, subs, cls === "web-app");
  return PACKAGE_CLASSES.has(cls) ? runPackage(context, subs) : Promise.resolve([]);
}

function toPageMetric(row: Record<string, unknown>): PageMetric | undefined {
  const route = row["route"];
  const bytes = row["totalBytes"];
  return typeof route === "string" && typeof bytes === "number" ? { route, bytes } : undefined;
}

const mapPageMetric = (row: Record<string, unknown>): PageMetric[] => {
  const metric = toPageMetric(row);
  return metric === undefined ? [] : [metric];
};

function parsePages(path: string, key: "routes" | "pages"): PageMetric[] {
  const parsed = parseJson(readOutput(path));
  return isRecord(parsed) ? records(parsed[key]).flatMap(mapPageMetric) : [];
}

function readPagesMetric(path: string | undefined, key: "routes" | "pages"): Metrics | undefined {
  if (path === undefined) return undefined;
  const pages = parsePages(path, key);
  return pages.length > 0 ? { pages } : undefined;
}

function pagesMetrics(artifacts: Record<string, string>): Metrics | undefined {
  return (
    readPagesMetric(artifacts["route-bytes-json"], "routes") ??
    readPagesMetric(artifacts["bytes-json"], "pages")
  );
}

function collectArtifacts(results: readonly LayerResult[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const result of results) {
    for (const [name, path] of Object.entries(result.artifacts)) out[name] = path;
  }
  return out;
}

function joinReasons(results: readonly LayerResult[]): string | undefined {
  const items = results.flatMap((res) => (res.reason === undefined ? [] : [res.reason]));
  return items.length > 0 ? [...new Set(items)].join("; ") : undefined;
}

function collectReason(results: readonly LayerResult[], verdict: Verdict): string | undefined {
  return joinReasons(results.filter((res) => res.verdict === verdict)) ?? joinReasons(results);
}

function needsReason(verdict: Verdict): boolean {
  return verdict === "skip" || verdict === "not-run" || verdict === "not-evaluated";
}

const reasonFor = (results: readonly LayerResult[], verdict: Verdict): string | undefined =>
  collectReason(results, verdict) ?? (needsReason(verdict) ? `sub-layer ${verdict}` : undefined);

const withOptional = (
  reason: string | undefined,
  metrics: Metrics | undefined,
): Pick<LayerResult, "reason" | "metrics"> => ({
  ...(reason === undefined ? {} : { reason }),
  ...(metrics === undefined ? {} : { metrics }),
});

function combineResults(results: readonly LayerResult[]): LayerResult {
  const verdict = results.map((res) => res.verdict).reduce(worse, "pass");
  const artifacts = collectArtifacts(results);
  return {
    verdict,
    findings: results.flatMap((res) => [...res.findings]),
    artifacts,
    ...withOptional(reasonFor(results, verdict), pagesMetrics(artifacts)),
  };
}

function aggregate(results: readonly LayerResult[]): LayerResult {
  return results.length === 0
    ? {
        verdict: "not-evaluated",
        reason: "no build-output sub-layer ran",
        findings: [],
        artifacts: {},
      }
    : combineResults(results);
}

/** Composite Gate 6 orchestrator (`build-output`), running the class profile's built-output layers fail-closed. */
export const buildOutputLayer = (subs: BuildOutputSubLayers = DEFAULT_SUBS()): Layer => ({
  id: "build-output",
  gate: 6,
  tier: 1,
  classes: ["ts-library", "ui-components", "astro-site", "web-app"],
  requires: [],
  produces: [
    "inventory",
    "html-report",
    "links-json",
    "bytes-json",
    "route-bytes-json",
    "axe-report",
    "size-limit-json",
  ],
  consumes: [],
  run: async (context) => aggregate(await runByClass(context, subs)),
});
