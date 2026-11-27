import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Layer, LayerContext, LayerResult } from "../../gate/types.ts";
import type { RawFinding } from "../../report/findings.ts";
import { ensureBuild, ensureServer, type DistInventory } from "../build/index.ts";
import { failFinding } from "../hygiene/tooling.ts";
import { measureRoutes, type RouteBytes } from "./measure.ts";
import { PLAYWRIGHT, visitRoutes } from "./run.ts";

const stopped = (reason: string, findings: LayerResult["findings"]): LayerResult => ({
  verdict: "fail",
  reason,
  findings,
  artifacts: {},
});

const refusal = (rule: string, message: string): LayerResult =>
  stopped(message, [failFinding("webtops", rule, message)]);

const unjudged = (verdict: "not-run" | "not-evaluated", reason: string): LayerResult => ({
  verdict,
  reason,
  findings: [],
  artifacts: {},
});

function routeFinding(entry: RouteBytes): RawFinding {
  const compared = entry.passed ? "<=" : "exceeds budget";
  return {
    tool: "webtops",
    rule: "W-29",
    law: "W-29",
    verdict: entry.passed ? "pass" : "fail",
    message: `route ${entry.route} JS is ${String(entry.totalBytes)} B brotli (${compared} ${String(entry.budgetBytes)} B)`,
  };
}

function judged(context: LayerContext, routes: readonly RouteBytes[]): LayerResult {
  const path = join(context.outDir, "route-bytes", "report.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ routes }, null, 2)}\n`);
  return {
    verdict: routes.every((entry) => entry.passed) ? "pass" : "fail",
    findings: routes.map(routeFinding),
    artifacts: { "route-bytes-json": path },
  };
}

async function measure(
  context: LayerContext,
  inventory: DistInventory,
  routes: readonly string[],
): Promise<LayerResult> {
  const server = await ensureServer(context, inventory.distDir);
  const visited = await visitRoutes(context, server.origin, routes);
  if (!visited.ok) return stopped(visited.finding.message, [visited.finding]);
  const measured = measureRoutes(visited.visits, server.origin, inventory, context.config.budgets);
  return measured.ok
    ? judged(context, measured.routes)
    : refusal("route-script-unknown", measured.reason);
}

function withBrowser(
  context: LayerContext,
  inventory: DistInventory,
  routes: readonly string[],
): Promise<LayerResult> {
  const installed = existsSync(join(context.cwd, "node_modules", PLAYWRIGHT(), "package.json"));
  return installed
    ? measure(context, inventory, routes)
    : Promise.resolve(refusal("tool-missing", `${PLAYWRIGHT()} is not installed in node_modules`));
}

/** Nothing to measure is never a pass: no built page is `not-evaluated`, no declared route is `not-run`. */
function absent(inventory: DistInventory, routes: readonly string[]): LayerResult | undefined {
  if (!existsSync(inventory.distDir)) {
    return refusal("build-missing-dist", "the built directory is missing");
  }
  if (inventory.pages.length === 0) {
    return unjudged("not-evaluated", "the build holds no HTML page");
  }
  return routes.length === 0
    ? unjudged("not-run", "web-tops.yaml declares no routes for this web-app")
    : undefined;
}

async function runRouteBytes(context: LayerContext): Promise<LayerResult> {
  const build = await ensureBuild(context);
  if (!build.ok) return stopped(build.reason, build.findings);
  const routes = context.config.routes ?? [];
  return absent(build.inventory, routes) ?? (await withBrowser(context, build.inventory, routes));
}

/** Route JavaScript byte budgets (W-29) for `web-app`, from what headless Chromium loads (WEB_TOPS.md section 7). */
export const routeBytesLayer = (): Layer => ({
  id: "route-bytes",
  gate: 6,
  tier: 1,
  classes: ["web-app"],
  requires: ["build"],
  produces: ["route-bytes-json"],
  consumes: [{ artifact: "inventory", from: "build" }],
  run: runRouteBytes,
});
