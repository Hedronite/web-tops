import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Layer, LayerContext, LayerResult } from "../../gate/types.ts";
import { ensureBuild, type DistInventory } from "../build/index.ts";
import { failFinding, relativeTo } from "../hygiene/tooling.ts";
import { findingOf, validatePages, type HtmlError } from "./run.ts";

const stopped = (reason: string, findings: LayerResult["findings"]): LayerResult => ({
  verdict: "fail",
  reason,
  findings,
  artifacts: {},
});

function writeReport(context: LayerContext, pages: number, errors: readonly HtmlError[]): string {
  const path = join(context.outDir, "html", "report.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ version: 1, pages, findings: errors }, null, 2)}\n`);
  return path;
}

async function validated(context: LayerContext, inventory: DistInventory): Promise<LayerResult> {
  const result = await validatePages(context, inventory);
  if (!result.ok) return stopped(result.finding.message, [result.finding]);
  const report = writeReport(context, inventory.pages.length, result.errors);
  return {
    verdict: result.errors.length === 0 ? "pass" : "fail",
    findings: result.errors.map((error) => findingOf(context, inventory, error)),
    artifacts: { "html-report": report },
  };
}

/** A build with no page has nothing to judge: that is `not-evaluated`, never a pass. */
function judge(context: LayerContext, inventory: DistInventory): Promise<LayerResult> {
  if (!existsSync(inventory.distDir)) {
    const message = `the built directory "${relativeTo(context.cwd, inventory.distDir)}" is missing`;
    return Promise.resolve(
      stopped(message, [failFinding("webtops", "build-missing-dist", message)]),
    );
  }
  if (inventory.pages.length === 0) {
    return Promise.resolve({
      verdict: "not-evaluated",
      reason: `no HTML page in "${relativeTo(context.cwd, inventory.distDir)}"`,
      findings: [],
      artifacts: {},
    });
  }
  return validated(context, inventory);
}

/** Reads the inventory the build layer handed over; it builds nothing a build layer already built. */
async function runHtml(context: LayerContext): Promise<LayerResult> {
  const build = await ensureBuild(context);
  return build.ok ? judge(context, build.inventory) : stopped(build.reason, build.findings);
}

/** HTML validity (W-20) and built-page accessibility (W-22) over `dist/**\/*.html` (WEB_TOPS.md section 7). */
export const htmlLayer = (): Layer => ({
  id: "html",
  gate: 6,
  tier: 1,
  classes: ["ui-components", "astro-site", "web-app"],
  requires: ["build"],
  produces: ["html-report"],
  consumes: [{ artifact: "inventory", from: "build" }],
  run: runHtml,
});
