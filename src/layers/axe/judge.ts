import { join } from "node:path";
import type { LayerContext, LayerResult } from "../../gate/types.ts";
import type { RawFinding } from "../../report/findings.ts";
import type { Verdict } from "../../report/types.ts";
import { relativeTo } from "../hygiene/tooling.ts";
import type { AxeEntry } from "./run.ts";

/** Moderate and minor violations are listed and fail nothing; serious, critical and an impact axe did not give do. */
const failing = (entry: AxeEntry): boolean => !["moderate", "minor"].includes(entry.impact);

/**
 * The finding of one entry. It has no line, so its fingerprint is taken from the message, which holds the rule and the
 * selector and nothing that moves between runs. The tool is `webtops`: the report's closed tool list does not name axe.
 */
export function findingOf(
  context: LayerContext,
  distDir: string,
  entry: AxeEntry,
  verdict: Verdict,
): RawFinding {
  return {
    tool: "webtops",
    rule: `axe:${entry.rule}`,
    law: entry.law,
    verdict,
    message: `axe ${entry.rule} at ${entry.selector}`,
    ...(entry.file === undefined
      ? {}
      : { file: relativeTo(context.cwd, join(distDir, entry.file)) }),
  };
}

function verdictOf(
  violations: readonly AxeEntry[],
  incomplete: readonly AxeEntry[],
): Pick<LayerResult, "verdict" | "reason"> {
  if (violations.some(failing)) return { verdict: "fail" };
  return incomplete.length === 0
    ? { verdict: "pass" }
    : {
        verdict: "not-evaluated",
        reason: `axe could not decide ${String(incomplete.length)} result(s)`,
      };
}

/** A failing violation fails; else a result axe left incomplete is `not-evaluated`, never a pass. */
export function judged(
  context: LayerContext,
  distDir: string,
  violations: readonly AxeEntry[],
  incomplete: readonly AxeEntry[],
): Omit<LayerResult, "artifacts"> {
  return {
    ...verdictOf(violations, incomplete),
    findings: [
      ...violations.map((entry) =>
        findingOf(context, distDir, entry, failing(entry) ? "fail" : "pass"),
      ),
      ...incomplete.map((entry) => findingOf(context, distDir, entry, "not-evaluated")),
    ],
  };
}
