import type { Subject } from "../config/report.ts";

/** One function's CRAP at the time the baseline was written. */
export interface BaselineCrap {
  readonly complexity: number;
  readonly coverage: number;
  readonly crap: number;
}

export interface BaselineCoverage {
  readonly lines_found: number;
  readonly lines_hit: number;
}

/** One suppression kind: how many directives, and the `fp1` of each, so a directive that only moves keeps its entry. */
export interface CensusEntry {
  readonly count: number;
  readonly fingerprints: readonly string[];
}

/**
 * `.web-tops/baseline.json` (WEB_TOPS.md sections 6.6 and 6.7): the metrics of a passing run, projected from its
 * report and from nothing else. Legacy findings stay in it; a run may not go above it.
 */
export interface Baseline {
  readonly report_version: string;
  readonly subject: Subject;
  /** CRAP per function, keyed `file::name` (the section 6.7 function key). */
  readonly crap: Readonly<Record<string, BaselineCrap>>;
  /** Line coverage per package. */
  readonly coverage: Readonly<Record<string, BaselineCoverage>>;
  /** Finding counts per rule per file. */
  readonly findings: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** The `fp1` of each counted finding, sorted: the keys that tell a new finding from a legacy one. */
  readonly fingerprints: readonly string[];
  /** Suppression counts by census kind (section 6.7). */
  readonly census: Readonly<Record<string, CensusEntry>>;
  /** Bytes per page or route. */
  readonly pages: Readonly<Record<string, number>>;
}

/** A tracked value that is above its baseline: what the ratchet reports as a `refuse` finding on `layer`. */
export interface Breach {
  readonly layer: "hygiene" | "coverage" | "crap" | "build-output";
  readonly rule: string;
  readonly message: string;
  readonly file?: string;
}
