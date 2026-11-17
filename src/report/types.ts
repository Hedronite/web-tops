/** The gate report (WEB_TOPS.md section 6.6): the types are the config module's, so the writer cannot drift from the schema. */
import type { GateReport, LayerReport, Verdict } from "../config/report.ts";

export { endsRun, FAILURE, REPORT_VERSION, VERDICTS } from "../config/report.ts";
export type { Finding, Metrics, RunBlock, Subject, Verdict } from "../config/report.ts";
export type { Enforce } from "../config/types.ts";
export type Report = GateReport;
export type ReportLayer = LayerReport;
export type Counts = GateReport["counts"];
export type GateRef = LayerReport["gate"];
export type Problem = NonNullable<GateReport["problems"]>[number];

/** Whether a layer with this verdict has run: only `skip` and `not-run` have not (WEB_TOPS.md section 3.3). */
export function hasRun(verdict: Verdict): boolean {
  return verdict !== "skip" && verdict !== "not-run";
}
