import type { Finding } from "../config/report.ts";

const HINT = /^an? (.+) hint takes lines/u;

function kindOfHint(message: string): string {
  const named = HINT.exec(message)?.[1];
  return named === undefined ? "coverage-hint" : named.replaceAll(" ", "-");
}

/**
 * The census kind a finding stands for, or undefined when it is not a census entry. G2 reports each coverage
 * hint as a `coverage-hint` finding whose message names the kind ("a v8 ignore hint takes lines out of the
 * coverage profile"); the kind is read from there until the finding carries it as a field.
 */
export function censusKindOf(finding: Finding): string | undefined {
  return finding.rule === "coverage-hint" ? kindOfHint(finding.message) : undefined;
}
