import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { mapsStep, profileFor, STEP_KEYS, type Project, type StepKey } from "./profiles.ts";
import { readProject } from "./project.ts";
import { LAYER_IDS } from "./report.ts";
import type { Exemption, LayerConfig, Problem, WebTopsConfig } from "./types.ts";

export interface SemanticContext {
  /** Directory that the config's relative paths (the baseline) resolve against. */
  readonly cwd: string;
  /** Today as YYYY-MM-DD, for exemption expiry; defaults to the current UTC date. */
  readonly today?: string;
  /** What package.json says about the project; read from `cwd` when absent. */
  readonly project?: Project;
}

function checkClass(config: WebTopsConfig): readonly Problem[] {
  if (profileFor(config.class) !== undefined) return [];
  return [
    { pointer: "/class", message: `class "${config.class}" has no launch profile in this kit` },
  ];
}

function survivorsMax(config: WebTopsConfig): number | undefined {
  return config.gates?.mutation?.unexplained_survivors_max;
}

function mutationOn(config: WebTopsConfig): boolean {
  return config.gates?.mutation?.enabled !== false;
}

function allowsSurvivors(config: WebTopsConfig): boolean {
  return (survivorsMax(config) ?? 0) !== 0;
}

function checkSurvivors(config: WebTopsConfig): readonly Problem[] {
  if (config.class !== "ts-library" || !mutationOn(config) || !allowsSurvivors(config)) return [];
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

function checkExemption(exemption: Exemption, today: string): readonly Problem[] {
  if (!isCalendarDate(exemption.until)) {
    return [{ pointer: "/exemption/until", message: `${exemption.until} is not a calendar date` }];
  }
  if (exemption.until < today) {
    return [{ pointer: "/exemption/until", message: `the exemption ended on ${exemption.until}` }];
  }
  return [];
}

function checkAdvisory(config: WebTopsConfig, today: string): readonly Problem[] {
  if (config.enforce !== "advisory") return [];
  return config.exemption === undefined
    ? [{ pointer: "/exemption", message: "advisory needs an exemption (until and reason)" }]
    : checkExemption(config.exemption, today);
}

/**
 * Under `hard`, a gate or step the class maps at tier 1 or below cannot be switched off, except
 * crap, mutation, build output and laws (section 9). Gates 1 to 3 are always mapped; the steps
 * and the package exports check (a gate 1 step) are mapped per class, and `astro_check` also
 * follows the project: package.json beside the config decides it for web-app and ui-components.
 */
const HARD_GATES = ["hygiene", "tests", "coverage"] as const;

function offGates(config: WebTopsConfig): string[] {
  return HARD_GATES.filter((gate) => config.gates?.[gate]?.enabled === false).map(
    (gate) => `/gates/${gate}`,
  );
}

function stepOff(config: WebTopsConfig, step: StepKey): boolean {
  return config.gates?.hygiene?.[step]?.enabled === false;
}

function offSteps(config: WebTopsConfig, project: Project): string[] {
  const profile = profileFor(config.class);
  if (profile === undefined) return [];
  return STEP_KEYS.filter((step) => mapsStep(profile, step, project) && stepOff(config, step)).map(
    (step) => `/gates/hygiene/${step}`,
  );
}

function mapsExports(config: WebTopsConfig): boolean {
  return profileFor(config.class)?.layers.includes("package_exports") === true;
}

function exportsSwitchedOff(exports: LayerConfig | undefined): boolean {
  return exports?.enabled === false && (exports.tier ?? 1) <= 1;
}

function offExports(config: WebTopsConfig): string[] {
  if (!mapsExports(config) || !exportsSwitchedOff(config.layers?.package_exports)) return [];
  return ["/layers/package_exports"];
}

function checkHard(config: WebTopsConfig, project: Project): readonly Problem[] {
  if (config.enforce !== "hard") return [];
  const switchedOff = [...offGates(config), ...offSteps(config, project), ...offExports(config)];
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
      ? [
          {
            pointer: `/layers/custom/${String(index)}/id`,
            message: `layer id "${layer.id}" is already taken`,
          },
        ]
      : [];
  });
}

function git(cwd: string, args: readonly string[]): { ok: boolean; out: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: result.status === 0, out: result.stdout };
}

function dirtiness(baseline: string, cwd: string): string | undefined {
  const status = git(cwd, ["status", "--porcelain", "--", baseline]);
  if (!status.ok) return `cannot check the baseline ${baseline} against HEAD`;
  return status.out.trim() === "" ? undefined : `the baseline ${baseline} has uncommitted changes`;
}

/** What is wrong with the ratchet baseline, or undefined when it exists, is tracked and is clean. */
function baselineFault(baseline: string, cwd: string): string | undefined {
  if (!existsSync(resolve(cwd, baseline))) {
    return `ratchet needs the baseline ${baseline}, and it does not exist`;
  }
  if (!git(cwd, ["ls-files", "--error-unmatch", "--", baseline]).ok) {
    return `the baseline ${baseline} is not tracked by git`;
  }
  return dirtiness(baseline, cwd);
}

function checkBaseline(config: WebTopsConfig, cwd: string): readonly Problem[] {
  if (config.enforce !== "ratchet") return [];
  const message = baselineFault(config.baseline, cwd);
  return message === undefined ? [] : [{ pointer: "/baseline", message }];
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
    ...checkHard(config, context.project ?? readProject(context.cwd)),
    ...checkCustomIds(config),
    ...checkBaseline(config, context.cwd),
  ];
}
