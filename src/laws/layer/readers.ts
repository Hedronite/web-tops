import { attwReader } from "../../laws/readers/attw.ts";
import { bunReader } from "../../laws/readers/bun.ts";
import { depcruiseReader } from "../../laws/readers/depcruise.ts";
import { eslintReader } from "../../laws/readers/eslint.ts";
import { knipReader } from "../../laws/readers/knip.ts";
import { lockReader } from "../../laws/readers/lock.ts";
import { publintReader } from "../../laws/readers/publint.ts";
import { secretsReader } from "../../laws/readers/secrets.ts";
import { tscReader } from "../../laws/readers/tsc.ts";
import type { LawReader } from "../../laws/readers/types.ts";

/**
 * The readers by the tool whose rules they read, one line each. A law that maps a tool with no reader here is
 * `not-evaluated` for that tool, never a pass: axe, html-validate, stylelint and `astro check` have none yet.
 */
export function defaultReaders(): ReadonlyMap<string, LawReader> {
  return new Map([
    ["attw", attwReader],
    ["bun", bunReader],
    ["dependency-cruiser", depcruiseReader],
    ["eslint", eslintReader],
    ["knip", knipReader],
    ["lock", lockReader],
    ["publint", publintReader],
    ["secretlint", secretsReader],
    ["tsc", tscReader],
  ]);
}

/**
 * The artifact of gate 1 each tool's reader reads. The laws layer consumes each as optional (R92): the hygiene step
 * that writes it can be off for a class, or not built yet. A law that maps one of these rules while its artifact is
 * missing is `not-evaluated`, so a required law whose input is missing ends the run instead of passing on nothing.
 * `bun` runs two checks, so its artifact follows the rule: the audit, or the frozen install.
 */
function toolArtifacts(): ReadonlyMap<string, string> {
  return new Map([
    ["attw", "attw-json"],
    ["dependency-cruiser", "dependency-cruiser-json"],
    ["publint", "publint-json"],
  ]);
}

function bunArtifacts(): ReadonlyMap<string, string> {
  return new Map([
    ["audit", "audit-json"],
    ["install --frozen-lockfile", "install-json"],
  ]);
}

/** The artifact a rule of a tool is read from, or undefined for a rule judged from gate 1's ESLint or compiler output. */
export const artifactOf = (rule: {
  readonly tool: string;
  readonly name: string;
}): string | undefined =>
  rule.tool === "bun" ? bunArtifacts().get(rule.name) : toolArtifacts().get(rule.tool);

/** Every artifact the laws layer may read, once each, in name order. */
export function optionalArtifacts(): readonly string[] {
  return [...new Set([...toolArtifacts().values(), ...bunArtifacts().values()])].sort();
}
