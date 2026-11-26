import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Layer, LayerContext, LayerResult } from "../../gate/types.ts";
import type { RawFinding } from "../../report/findings.ts";
import { ensureBuild, type DistInventory } from "../build/index.ts";
import { parseHtmlPage, type ParsedHtml } from "./parse.ts";
import { checkAllPages, type BrokenReference } from "./resolve.ts";

function failLayer(reason: string, findings: readonly RawFinding[]): LayerResult {
  return { verdict: "fail", reason, findings, artifacts: {} };
}

function parseInventoryPages(inventory: DistInventory): Map<string, ParsedHtml> {
  const parsed = new Map<string, ParsedHtml>();
  for (const page of inventory.pages) {
    const html = readFileSync(join(inventory.distDir, page.file), "utf8");
    parsed.set(page.file, parseHtmlPage(html));
  }
  return parsed;
}

function brokenFinding(item: BrokenReference): RawFinding {
  return {
    tool: "webtops",
    rule: "links",
    verdict: "fail",
    file: item.file,
    line: item.line,
    message: `${item.file}:${String(item.line)} (${item.attr}): ${item.reason}`,
  };
}

function writeReport(outDir: string, payload: unknown): string {
  const reportPath = join(outDir, "links", "report.json");
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`);
  return reportPath;
}

function judgeSummary(context: LayerContext, inventory: DistInventory): LayerResult {
  if (inventory.pages.length === 0) {
    const reason = "no HTML pages found in built dist/ directory";
    const reportPath = writeReport(context.outDir, { pages: 0, checked: 0, broken: [] });
    return {
      verdict: "not-evaluated",
      reason,
      findings: [{ tool: "webtops", rule: "links", verdict: "not-evaluated", message: reason }],
      artifacts: { "links-json": reportPath },
    };
  }
  const parsed = parseInventoryPages(inventory);
  const summary = checkAllPages(inventory, parsed);
  const reportPath = writeReport(context.outDir, {
    pages: inventory.pages.length,
    checked: summary.checkedRefs,
    broken: summary.broken,
  });
  if (summary.broken.length > 0) {
    return {
      verdict: "fail",
      findings: summary.broken.map(brokenFinding),
      artifacts: { "links-json": reportPath },
    };
  }
  return {
    verdict: "pass",
    findings: [
      {
        tool: "webtops",
        rule: "links",
        verdict: "pass",
        message: `checked ${String(summary.checkedRefs)} reference(s) across ${String(inventory.pages.length)} page(s)`,
      },
    ],
    artifacts: { "links-json": reportPath },
  };
}

/** Native built `dist/` internal links, `#anchor`, and local asset layer (WEB_TOPS.md §7). */
export const linksLayer: Layer = {
  id: "links",
  gate: 6,
  tier: 1,
  classes: ["ui-components", "astro-site", "web-app"],
  requires: ["build"],
  produces: ["links-json"],
  consumes: [{ artifact: "inventory", from: "build" }],
  run: async (context) => {
    const built = await ensureBuild(context);
    return built.ok
      ? judgeSummary(context, built.inventory)
      : failLayer(built.reason, built.findings);
  },
};
