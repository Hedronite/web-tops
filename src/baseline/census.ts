import { CENSUS_RULE_PREFIX } from "../census/kinds.ts";
import type { Finding } from "../config/report.ts";

const PREFIX = "coverage-hint/";

/**
 * The census kind a finding stands for, or undefined when it is not a census entry. The coverage layer reports
 * each coverage hint as a `coverage-hint/<kind>` finding, `<kind>` being `v8`, `istanbul` or `c8`; the census kind
 * is `<kind>-ignore` (WEB_TOPS.md section 6.7). The readers of `src/census` report every other kind as a
 * `census/<kind>` finding, whose kind is the rest of its rule.
 */
export function censusKindOf(finding: Finding): string | undefined {
  if (finding.rule.startsWith(CENSUS_RULE_PREFIX))
    return finding.rule.slice(CENSUS_RULE_PREFIX.length);
  return finding.rule.startsWith(PREFIX)
    ? `${finding.rule.slice(PREFIX.length)}-ignore`
    : undefined;
}
