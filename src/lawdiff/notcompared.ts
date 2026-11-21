import type { NotCompared } from "./types.ts";

/**
 * What the diff does not compare, and why. It is part of every report, so a reader sees what a pass leaves unjudged:
 * a surface that is not compared is not held, and the diff says so rather than passing it in silence.
 */
export function notCompared(): readonly NotCompared[] {
  return [
    {
      what: "size budgets",
      reason:
        "only whether size_limit is on is compared; the byte budget of each entry arrives with M4",
    },
    { what: "package.json scripts", reason: "not read" },
    {
      what: "CI workflow files",
      reason: "not read, so a PR that removes a job or a step is not seen here",
    },
    {
      what: "tsconfig options that are not W-04 flags",
      reason: "target, module, paths, types and the like are not compared",
    },
    { what: "dependency-cruiser options beyond exclude and doNotFollow", reason: "not compared" },
    {
      what: "ESLint over files ESLint does not name by extension",
      reason: "only TypeScript, JavaScript and Astro files are asked about",
    },
    { what: "Stylelint over non-CSS files", reason: "only .css files are asked about" },
    {
      what: "who applied the protocol-change label",
      reason:
        "in CI only an account with maintain or admin permission counts (R111); a local run trusts the label's presence",
    },
  ];
}
