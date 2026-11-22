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
      what: "secretlint configuration in any file but .secretlintrc.json",
      reason:
        "the W-39 reader reads no other (without that file it runs the kit's preset), so a .secretlintrc.yaml, a .secretlintrc.js or a package.json secretlint key changes nothing in the gate",
    },
    {
      what: "what .gitignore leaves out of a secretlint scan",
      reason: "secretlint skips a path .gitignore ignores; the patterns of .gitignore are not read",
    },
    {
      what: "knip plugin options beyond entry and project",
      reason: "listed for review when they change, not judged weaker or stronger",
    },
    {
      what: "who applied the protocol-change label",
      reason:
        "in CI only an account with maintain or admin permission counts (R111); a local run trusts the label's presence",
    },
  ];
}
