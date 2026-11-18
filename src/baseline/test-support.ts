import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "./canonical.ts";
import type { Baseline } from "./types.ts";

/** A baseline that holds nothing: a run held to it has nothing above it unless it adds something. */
export const EMPTY_BASELINE: Baseline = {
  report_version: "2.0.0",
  subject: { package: "fixture", root: "." },
  crap: {},
  coverage: {},
  findings: {},
  fingerprints: [],
  census: {},
  pages: {},
};

/** Writes a baseline into `dir`, so that a ratchet run there has one to be held to. */
export function writeBaselineFile(
  dir: string,
  name = "baseline.json",
  baseline: Baseline = EMPTY_BASELINE,
): void {
  writeFileSync(join(dir, name), canonicalJson(baseline));
}
