import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Layer, LayerContext, LayerResult } from "../../gate/types.ts";
import { ensureBuild, ensureServer, type DistInventory } from "../build/index.ts";
import { failFinding } from "../hygiene/tooling.ts";
import { judged } from "./judge.ts";
import { missingTool, visitPages, type Visited } from "./run.ts";
import { configuredRoutes, targetsOf, type RoutesOf, type Target } from "./targets.ts";

const stopped = (reason: string, findings: LayerResult["findings"]): LayerResult => ({
  verdict: "fail",
  reason,
  findings,
  artifacts: {},
});

const unjudged = (verdict: "not-run" | "not-evaluated", reason: string): LayerResult => ({
  verdict,
  reason,
  findings: [],
  artifacts: {},
});

const refusal = (rule: string, message: string): LayerResult =>
  stopped(message, [failFinding("webtops", rule, message)]);

type Answer = Extract<Visited, { ok: true }>;

function writeReport(context: LayerContext, targets: readonly Target[], answer: Answer): string {
  const path = join(context.outDir, "axe", "report.json");
  mkdirSync(dirname(path), { recursive: true });
  const report = {
    version: 1,
    routes: targets.map((target) => target.route),
    violations: answer.violations,
    incomplete: answer.incomplete,
  };
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

async function visit(
  context: LayerContext,
  inventory: DistInventory,
  targets: readonly Target[],
): Promise<LayerResult> {
  const server = await ensureServer(context, inventory.distDir);
  const visited = await visitPages(context, server.origin, targets);
  if (!visited.ok) return stopped(visited.finding.message, [visited.finding]);
  const report = writeReport(context, targets, visited);
  return {
    ...judged(context, inventory.distDir, visited.violations, visited.incomplete),
    artifacts: { "axe-report": report },
  };
}

function withTools(
  context: LayerContext,
  inventory: DistInventory,
  targets: readonly Target[],
): Promise<LayerResult> {
  const missing = missingTool(context.cwd);
  return missing === undefined
    ? visit(context, inventory, targets)
    : Promise.resolve(refusal("tool-missing", `${missing} is not installed in node_modules`));
}

/** Nothing to judge is never a pass: no built page is `not-evaluated`, no declared route is `not-run`. */
function absent(inventory: DistInventory, targets: readonly Target[]): LayerResult | undefined {
  if (!existsSync(inventory.distDir)) {
    return refusal("build-missing-dist", "the built directory is missing");
  }
  if (inventory.pages.length === 0) {
    return unjudged("not-evaluated", "the build holds no HTML page");
  }
  return targets.length === 0
    ? unjudged("not-run", "web-tops.yaml declares no routes for this web-app")
    : undefined;
}

async function runAxe(context: LayerContext, routesOf: RoutesOf): Promise<LayerResult> {
  const build = await ensureBuild(context);
  if (!build.ok) return stopped(build.reason, build.findings);
  const targets = targetsOf(context, build.inventory, routesOf);
  return absent(build.inventory, targets) ?? (await withTools(context, build.inventory, targets));
}

/** axe on the built pages, in headless Chromium: W-21, and W-44 through `target-size` (WEB_TOPS.md section 7). */
export const axeLayer = (routesOf: RoutesOf = configuredRoutes): Layer => ({
  id: "axe",
  gate: 6,
  tier: 1,
  classes: ["ui-components", "astro-site", "web-app"],
  requires: ["build"],
  produces: ["axe-report"],
  consumes: [{ artifact: "inventory", from: "build" }],
  run: (context) => runAxe(context, routesOf),
});
