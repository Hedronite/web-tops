import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Layer, LayerContext, LayerResult, SizeLimitSettings } from "../../gate/types.ts";
import type { RawFinding } from "../../report/findings.ts";
import { budgetForEntry } from "./budgets.ts";
import { readManifestInfo, resolveExportEntries } from "./exports.ts";
import { measureExports, type MeasuredEntry } from "./measure.ts";

interface CheckedEntry {
  readonly key: string;
  readonly file: string;
  readonly size: number;
  readonly budget: number;
  readonly passed: boolean;
}

function failLayer(reason: string, file?: string): LayerResult {
  return {
    verdict: "fail",
    reason,
    findings: [
      {
        tool: "webtops",
        rule: "size-limit",
        verdict: "fail",
        message: reason,
        ...(file === undefined ? {} : { file }),
      },
    ],
    artifacts: {},
  };
}

function writeReport(outDir: string, data: unknown): string {
  const reportPath = join(outDir, "size-limit", "report.json");
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(data, null, 2)}\n`);
  return reportPath;
}

function skipPrivateOutcome(
  context: LayerContext,
  isPrivate: boolean,
  skipPrivate: string | undefined,
): LayerResult | undefined {
  if (skipPrivate === undefined) return undefined;
  if (skipPrivate.trim() === "") return failLayer("skip_private requires a non-empty reason");
  if (!isPrivate) return failLayer('skip_private needs "private": true in package.json');
  const artifact = writeReport(context.outDir, { skipped: true, reason: skipPrivate, entries: [] });
  return {
    verdict: "pass",
    findings: [{ tool: "webtops", rule: "size-limit", verdict: "skip", message: skipPrivate }],
    artifacts: { "size-limit-json": artifact },
  };
}

function judgeEntry(entry: MeasuredEntry, settings: SizeLimitSettings | undefined): CheckedEntry {
  const budget = budgetForEntry(entry.key, settings);
  return {
    key: entry.key,
    file: entry.file,
    size: entry.size,
    budget,
    passed: entry.size <= budget,
  };
}

function entryFinding(entry: CheckedEntry): RawFinding {
  const cmp = entry.passed ? "<=" : "exceeds budget";
  return {
    tool: "webtops",
    rule: "size-limit",
    verdict: entry.passed ? "pass" : "fail",
    file: entry.file,
    message: `export "${entry.key}" (${entry.file}) is ${String(entry.size)} B (${cmp} ${String(entry.budget)} B)`,
  };
}

function evaluateEntries(context: LayerContext, entries: readonly MeasuredEntry[]): LayerResult {
  const checked = entries.map((entry) => judgeEntry(entry, context.config.sizeLimit));
  const anyFailed = checked.some((entry) => !entry.passed);
  const artifact = writeReport(context.outDir, { skipped: false, entries: checked });
  return {
    verdict: anyFailed ? "fail" : "pass",
    findings: checked.map(entryFinding),
    artifacts: { "size-limit-json": artifact },
  };
}

async function runMeasured(context: LayerContext, exportsRaw: unknown): Promise<LayerResult> {
  const resolved = resolveExportEntries(context.cwd, exportsRaw);
  if (!resolved.ok) return failLayer(resolved.reason, resolved.file);
  const measured = await measureExports(context, resolved.entries);
  return measured.ok ? evaluateEntries(context, measured.entries) : failLayer(measured.reason);
}

/** Package entry size layer (`size-limit` per `exports` entry, WEB_TOPS.md §7). */
export const sizeLimitLayer: Layer = {
  id: "size-limit",
  gate: 6,
  tier: 1,
  classes: ["ts-library", "ui-components"],
  requires: [],
  produces: ["size-limit-json"],
  consumes: [],
  run: async (context) => {
    const manifest = readManifestInfo(context.cwd);
    if (!manifest.ok) return failLayer(manifest.reason);
    const skipped = skipPrivateOutcome(
      context,
      manifest.isPrivate,
      context.config.sizeLimit?.skipPrivate,
    );
    return skipped ?? runMeasured(context, manifest.exportsRaw);
  },
};
