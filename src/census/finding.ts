import type { RawFinding } from "../report/findings.ts";
import { CENSUS_RULE_PREFIX } from "./kinds.ts";
import type { CensusKind } from "./kinds.ts";

/** One census item as a pass finding: rule `census/<kind>`, with its file and, when it has one, its line. */
export const passFinding = (
  kind: CensusKind,
  file: string,
  message: string,
  line?: number,
): RawFinding => ({
  tool: "webtops",
  rule: `${CENSUS_RULE_PREFIX}${kind}`,
  verdict: "pass",
  message,
  file,
  ...(line === undefined ? {} : { line }),
});

/** A census that could not be read, as a failing finding (never a zero), with its place when it has one. */
export const failed = (
  rule: string,
  message: string,
  place: { readonly file?: string; readonly line?: number } = {},
): RawFinding => ({ tool: "webtops", rule, verdict: "fail", message, ...place });
