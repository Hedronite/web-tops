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
import type { RawFinding } from "../report/findings.ts";
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
  "pass",
];

const worse = (left: Verdict, right: Verdict): Verdict =>
  WORST_FIRST.find((verdict) => verdict === left || verdict === right) ?? left;

const UI_DEFERRED_SUBS = ["html", "links", "axe"] as const;
const UI_DEFERRED_REASON = "ui-components fixture pages deferred";
const DISABLED_REASON = "disabled in web-tops.yaml";

const subEnabled = (context: LayerContext, id: string): boolean =>
  context.config.subLayers?.[id]?.enabled !== false;

const subOffReason = (context: LayerContext, id: string, fallback: string): string =>
  context.config.subLayers?.[id]?.reason ?? fallback;

const skipFinding = (id: string, message: string): RawFinding => ({
  tool: "webtops",
  rule: `sub-layer:${id}`,
  verdict: "skip",
  message,
});

interface RunOutcome {
  readonly active: readonly LayerResult[];
  readonly skips: readonly RawFinding[];
  readonly artifacts: Record<string, string>;
}

interface SiteSlot {
  readonly id: string;
  readonly layer: Layer;
}

const siteSlots = (subs: BuildOutputSubLayers, isApp: boolean): readonly SiteSlot[] => [
  { id: "html", layer: subs.html },
  { id: "links", layer: subs.links },
  { id: isApp ? "route-bytes" : "bytes", layer: isApp ? subs.routeBytes : subs.bytes },
  { id: "axe", layer: subs.axe },
];

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

function collectArtifacts(results: readonly LayerResult[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const result of results) {
    for (const [name, path] of Object.entries(result.artifacts)) out[name] = path;
  }
  return out;
}

function foldSkippedOutcome(id: string, result: LayerResult): RawFinding[] {
  const hasSkip = result.findings.some((finding) => finding.verdict === "skip");
  if (hasSkip) return [...result.findings];
  const message = result.reason ?? `sub-layer ${id} skipped`;
  return [skipFinding(id, message), ...result.findings];
}

function recordOutcome(
  id: string,
  result: LayerResult,
  active: LayerResult[],
  skips: RawFinding[],
): void {
  if (result.verdict === "skip") skips.push(...foldSkippedOutcome(id, result));
  else active.push(result);
}

async function stepSiteSlot(
  context: LayerContext,
  store: Map<string, string>,
  slot: SiteSlot,
  active: LayerResult[],
  skips: RawFinding[],
): Promise<readonly LayerResult[]> {
  if (!subEnabled(context, slot.id)) {
    skips.push(skipFinding(slot.id, subOffReason(context, slot.id, DISABLED_REASON)));
    return [];
  }
  const res = await slot.layer.run(subContext(context, store));
  addArtifacts(store, res.artifacts);
  recordOutcome(slot.id, res, active, skips);
  return [res];
}

async function runSite(
  context: LayerContext,
  subs: BuildOutputSubLayers,
  isApp: boolean,
): Promise<RunOutcome> {
  const store = new Map<string, string>();
  const active: LayerResult[] = [];
  const skips: RawFinding[] = [];
  const built = await subs.build.run(subContext(context, store));
  addArtifacts(store, built.artifacts);
  if (built.verdict !== "pass") {
    recordOutcome("build", built, active, skips);
    return { active, skips, artifacts: collectArtifacts([built]) };
  }
  active.push(built);
  const ran: LayerResult[] = [built];
  for (const slot of siteSlots(subs, isApp)) {
    ran.push(...(await stepSiteSlot(context, store, slot, active, skips)));
  }
  return { active, skips, artifacts: collectArtifacts(ran) };
}

const deferredUiSkips = (context: LayerContext): RawFinding[] =>
  context.config.class === "ui-components"
    ? UI_DEFERRED_SUBS.map((id) => skipFinding(id, subOffReason(context, id, UI_DEFERRED_REASON)))
    : [];

async function runPackage(context: LayerContext, subs: BuildOutputSubLayers): Promise<RunOutcome> {
  const active: LayerResult[] = [];
  const skips = deferredUiSkips(context);
  if (!subEnabled(context, "size-limit")) {
    skips.unshift(skipFinding("size-limit", subOffReason(context, "size-limit", DISABLED_REASON)));
    return { active, skips, artifacts: {} };
  }
  const res = await subs.sizeLimit.run(subContext(context, new Map()));
  recordOutcome("size-limit", res, active, skips);
  return { active, skips, artifacts: collectArtifacts([res]) };
}

const PACKAGE_CLASSES = new Set(["ts-library", "ui-components"]);

function runByClass(context: LayerContext, subs: BuildOutputSubLayers): Promise<RunOutcome> {
  const cls = context.config.class;
  if (cls === "astro-site" || cls === "web-app") return runSite(context, subs, cls === "web-app");
  if (PACKAGE_CLASSES.has(cls)) return runPackage(context, subs);
  return Promise.resolve({ active: [], skips: [], artifacts: {} });
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

function joinReasons(results: readonly LayerResult[]): string | undefined {
  const items = results.flatMap((res) => (res.reason === undefined ? [] : [res.reason]));
  return items.length > 0 ? [...new Set(items)].join("; ") : undefined;
}

function collectReason(results: readonly LayerResult[], verdict: Verdict): string | undefined {
  return joinReasons(results.filter((res) => res.verdict === verdict)) ?? joinReasons(results);
}

const needsReason = (verdict: Verdict): boolean =>
  verdict === "not-run" || verdict === "not-evaluated";

const reasonFor = (results: readonly LayerResult[], verdict: Verdict): string | undefined =>
  collectReason(results, verdict) ?? (needsReason(verdict) ? `sub-layer ${verdict}` : undefined);

const withOptional = (
  reason: string | undefined,
  metrics: Metrics | undefined,
): Pick<LayerResult, "reason" | "metrics"> => ({
  ...(reason === undefined ? {} : { reason }),
  ...(metrics === undefined ? {} : { metrics }),
});

function aggregate(run: RunOutcome): LayerResult {
  if (run.active.length === 0 && run.skips.length === 0) {
    return {
      verdict: "not-evaluated",
      reason: "no build-output sub-layer ran",
      findings: [],
      artifacts: {},
    };
  }
  const verdict = run.active.map((res) => res.verdict).reduce(worse, "pass");
  const findings = [...run.active.flatMap((res) => [...res.findings]), ...run.skips];
  return {
    verdict,
    findings,
    artifacts: run.artifacts,
    ...withOptional(reasonFor(run.active, verdict), pagesMetrics(run.artifacts)),
  };
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
