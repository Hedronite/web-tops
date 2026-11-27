import { astroCheckReader } from "../../laws/readers/astro-check.ts";
import { attwReader } from "../../laws/readers/attw.ts";
import { bytesReader, routeBytesReader } from "../../laws/readers/bytes.ts";
import { bunReader } from "../../laws/readers/bun.ts";
import { depcruiseReader } from "../../laws/readers/depcruise.ts";
import { eslintReader } from "../../laws/readers/eslint.ts";
import { knipReader } from "../../laws/readers/knip.ts";
import { lockReader } from "../../laws/readers/lock.ts";
import { publintReader } from "../../laws/readers/publint.ts";
import { secretsReader } from "../../laws/readers/secrets.ts";
import { stylelintReader } from "../../laws/readers/stylelint.ts";
import { tscReader } from "../../laws/readers/tsc.ts";
import type { LawReader } from "../../laws/readers/types.ts";

/**
 * The readers by the tool whose rules they read, one line each. A law that maps a tool with no reader here is
 * `not-evaluated` for that tool, never a pass: axe and html-validate have none yet.
 */
export function defaultReaders(): ReadonlyMap<string, LawReader> {
  return new Map([
    ["astro-check", astroCheckReader],
    ["attw", attwReader],
    ["bun", bunReader],
    ["bytes", bytesReader],
    ["dependency-cruiser", depcruiseReader],
    ["eslint", eslintReader],
    ["knip", knipReader],
    ["lock", lockReader],
    ["publint", publintReader],
    ["route-bytes", routeBytesReader],
    ["secretlint", secretsReader],
    ["stylelint", stylelintReader],
    ["tsc", tscReader],
  ]);
}

/**
 * The artifact of gate 1 or gate 6 each tool's reader reads. The laws layer consumes each as optional (R92): the step
 * or sub-layer that writes it can be off for a class, or not built yet. A law that maps one of these rules while its
 * artifact is missing is `not-evaluated`, so a required law whose input is missing ends the run instead of passing on
 * nothing. `bun` runs two checks, so its artifact follows the rule: the audit, or the frozen install.
 */
function gate1Artifacts(): ReadonlyMap<string, string> {
  return new Map([
    ["astro-check", "astro-check-json"],
    ["attw", "attw-json"],
    ["dependency-cruiser", "dependency-cruiser-json"],
    ["publint", "publint-json"],
    ["stylelint", "stylelint-json"],
  ]);
}

function gate6Artifacts(): ReadonlyMap<string, string> {
  return new Map([
    ["route-bytes", "route-bytes-json"],
    ["bytes", "bytes-json"],
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
  rule.tool === "bun"
    ? bunArtifacts().get(rule.name)
    : (gate1Artifacts().get(rule.tool) ?? gate6Artifacts().get(rule.tool));

/** Every optional artifact the laws layer may read from gate 1 or gate 6, paired with its producer layer. */
export function optionalInputs(): readonly { readonly artifact: string; readonly from: string }[] {
  const fromGate1 = [...new Set([...gate1Artifacts().values(), ...bunArtifacts().values()])]
    .sort()
    .map((artifact) => ({ artifact, from: "hygiene" }));
  const fromGate6 = [...new Set(gate6Artifacts().values())]
    .sort()
    .map((artifact) => ({ artifact, from: "build-output" }));
  return [...fromGate1, ...fromGate6];
}
