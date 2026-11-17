import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { profileFor, STEP_KEYS } from "./profiles.ts";
import { LAYER_IDS } from "./report.ts";
import type { Problem, WebTopsConfig } from "./types.ts";

export interface SemanticContext {
  /** Directory that the config's relative paths (the baseline) resolve against. */
  readonly cwd: string;
  /** Today as YYYY-MM-DD, for exemption expiry; defaults to the current UTC date. */
  readonly today?: string;
}

function checkClass(config: WebTopsConfig): readonly Problem[] {
  if (profileFor(config.class) !== undefined) return [];
  return [
    { pointer: "/class", message: `class "${config.class}" has no launch profile in this kit` },
  ];
}

function checkSurvivors(config: WebTopsConfig): readonly Problem[] {
  const mutation = config.gates?.mutation;
  const max = mutation?.unexplained_survivors_max;
  if (config.class !== "ts-library" || mutation?.enabled === false) return [];
  if (max === undefined || max === 0) return [];
  return [
    {
      pointer: "/gates/mutation/unexplained_survivors_max",
      message: "ts-library keeps unexplained_survivors_max = 0",
    },
  ];
}

function isCalendarDate(text: string): boolean {
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text);
}

function checkAdvisory(config: WebTopsConfig, today: string): readonly Problem[] {
  if (config.enforce !== "advisory") return [];
  const { exemption } = config;
  if (exemption === undefined) {
    return [{ pointer: "/exemption", message: "advisory needs an exemption (until and reason)" }];
  }
  if (!isCalendarDate(exemption.until)) {
    return [{ pointer: "/exemption/until", message: `${exemption.until} is not a calendar date` }];
  }
  if (exemption.until < today) {
    return [{ pointer: "/exemption/until", message: `the exemption ended on ${exemption.until}` }];
  }
  return [];
}

/**
 * Under `hard`, a gate or step the class maps at tier 1 or below cannot be switched off, except
 * crap, mutation, build output and laws (section 9). Gates 1 to 3 are always mapped; the steps
 * and the package exports check (a gate 1 step) are mapped per class.
 */
function checkHard(config: WebTopsConfig): readonly Problem[] {
  if (config.enforce !== "hard") return [];
  const profile = profileFor(config.class);
  const hygiene = config.gates?.hygiene;
  const exports = config.layers?.package_exports;
  const switchedOff: string[] = [
    ...(["hygiene", "tests", "coverage"] as const)
      .filter((gate) => config.gates?.[gate]?.enabled === false)
      .map((gate) => `/gates/${gate}`),
    ...STEP_KEYS.filter(
      (step) => profile?.steps.includes(step) === true && hygiene?.[step]?.enabled === false,
    ).map((step) => `/gates/hygiene/${step}`),
    ...(profile?.layers.includes("package_exports") === true &&
    exports?.enabled === false &&
    (exports.tier ?? 1) <= 1
      ? ["/layers/package_exports"]
      : []),
  ];
  return switchedOff.map((pointer) => ({
    pointer: `${pointer}/enabled`,
    message: `under hard, ${pointer.slice(1).replaceAll("/", ".")} is mapped by class ${config.class} and cannot be switched off`,
  }));
}

/** A custom layer id is unique and is not a built-in layer id, so the report keeps one entry per layer. */
function checkCustomIds(config: WebTopsConfig): readonly Problem[] {
  const seen = new Set<string>(LAYER_IDS);
  return (config.layers?.custom ?? []).flatMap((layer, index) => {
    const taken = seen.has(layer.id);
    seen.add(layer.id);
    return taken
      ? [{ pointer: `/layers/custom/${String(index)}/id`, message: `layer id "${layer.id}" is already taken` }]
      : [];
  });
}

function git(cwd: string, args: readonly string[]): { ok: boolean; out: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: result.status === 0, out: result.stdout };
}

function checkBaseline(config: WebTopsConfig, cwd: string): readonly Problem[] {
  if (config.enforce !== "ratchet") return [];
  const problem = (message: string): readonly Problem[] => [{ pointer: "/baseline", message }];
  if (!existsSync(resolve(cwd, config.baseline))) {
    return problem(`ratchet needs the baseline ${config.baseline}, and it does not exist`);
  }
  if (!git(cwd, ["ls-files", "--error-unmatch", "--", config.baseline]).ok) {
    return problem(`the baseline ${config.baseline} is not tracked by git`);
  }
  const status = git(cwd, ["status", "--porcelain", "--", config.baseline]);
  if (!status.ok) return problem(`cannot check the baseline ${config.baseline} against HEAD`);
  return status.out.trim() === "" ? [] : problem(`the baseline ${config.baseline} has uncommitted changes`);
}

/**
 * The semantic checks of WEB_TOPS.md section 12 that a schema cannot express: the class has a
 * profile, `ts-library` keeps no unexplained survivors (while mutation is on), `advisory` has an
 * exemption that runs past today, under `ratchet` the baseline exists and is clean, and under
 * `hard` no mapped tier-1 gate is off. The protocol id and `crap.cap >= 1` are schema rules, so
 * `validateConfig` already refuses them.
 */
export function runSemanticChecks(
  config: WebTopsConfig,
  context: SemanticContext = { cwd: process.cwd() },
): readonly Problem[] {
  const today = context.today ?? new Date().toISOString().slice(0, 10);
  return [
    ...checkClass(config),
    ...checkSurvivors(config),
    ...checkAdvisory(config, today),
    ...checkHard(config),
    ...checkCustomIds(config),
    ...checkBaseline(config, context.cwd),
  ];
}
