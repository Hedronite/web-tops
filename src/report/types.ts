/** The gate report (WEB_TOPS.md section 6.6): the types are the config module's, so the writer cannot drift from the schema. */
import type { GateReport, LayerReport, Verdict } from "../config/report.ts";

export { VERDICTS } from "../config/report.ts";
export type { Finding, Verdict } from "../config/report.ts";
export type { Enforce } from "../config/types.ts";
export type Report = GateReport;
export type ReportLayer = LayerReport;
export type Counts = GateReport["counts"];
export type GateRef = LayerReport["gate"];
export type Problem = NonNullable<GateReport["problems"]>[number];

const FAILING: ReadonlySet<Verdict> = new Set<Verdict>([
  "Refuse",
  "Ack",
  "not-run",
  "not-evaluated",
]);

/** Section 3.3: `Refuse`, `Ack`, `not-run` and `not-evaluated` never pass. */
export function isFailing(verdict: Verdict): boolean {
  return FAILING.has(verdict);
}
