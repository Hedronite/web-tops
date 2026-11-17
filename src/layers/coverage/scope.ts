import type { GateConfig } from "../../gate/types.ts";
import { matchesGlob } from "./glob.ts";

/** What coverage measures: the class source globs, `src/**` for the launch classes (WEB_TOPS.md section 6.1). */
export const COVERAGE_INCLUDE = "src/**/*.{ts,tsx}";

/** Section 6.1: what coverage leaves out unless `web-tops.yaml` adds a reasoned entry to it. */
export const DEFAULT_COVERAGE_EXCLUDES: readonly string[] = [
  "**/node_modules/**",
  "**/dist/**",
  "**/coverage/**",
  "**/.web-tops/**",
  "**/*.d.ts",
  "**/*.{test,spec}.?(c|m)[jt]s?(x)",
  "**/__tests__/**",
  "**/__generated__/**",
  "**/*.generated.*",
  "**/.astro/**",
  "**/*.config.*",
  "**/.*rc.*",
];

/** The default exclusions and the reasoned ones from `gates.coverage.exclude`. */
export function excludesOf(config: GateConfig): string[] {
  return [...DEFAULT_COVERAGE_EXCLUDES, ...config.coverage.exclude.map((entry) => entry.glob)];
}

/** A tracked file is in scope when the include selects it and no exclusion does. */
export function inScope(file: string, excludes: readonly string[]): boolean {
  return matchesGlob(file, COVERAGE_INCLUDE) && !excludes.some((glob) => matchesGlob(file, glob));
}
