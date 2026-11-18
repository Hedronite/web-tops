import type { Finding } from "../config/report.ts";

const PREFIX = "coverage-hint/";

/**
 * The census kind a finding stands for, or undefined when it is not a census entry. The coverage layer reports
 * each coverage hint as a `coverage-hint/<kind>` finding, `<kind>` being `v8`, `istanbul` or `c8`; the census kind
 * is `<kind>-ignore` (WEB_TOPS.md section 6.7).
 */
export function censusKindOf(finding: Finding): string | undefined {
  return finding.rule.startsWith(PREFIX)
    ? `${finding.rule.slice(PREFIX.length)}-ignore`
    : undefined;
}
