import { mapsStep, profileFor } from "../config/profiles.ts";
import { requiredLayers } from "../config/required.ts";
import { LAYER_IDS } from "../config/report.ts";
import type { LayerKey, Profile, Project } from "../config/profiles.ts";
import type { PackageExportsLayer, Switch, WebTopsConfig } from "../config/types.ts";
import {
  HYGIENE_STEPS,
  type AuditLevel,
  type BudgetsSettings,
  type BuildSettings,
  type CoverageSettings,
  type CrapSettings,
  type GateConfig,
  type HygieneSettings,
  type HygieneStep,
  type MutationSettings,
  type TestsSettings,
  type Toggle,
} from "./types.ts";

type Gates = NonNullable<WebTopsConfig["gates"]>;
type HygieneConfig = NonNullable<Gates["hygiene"]>;
type CoverageConfig = NonNullable<Gates["coverage"]>;

/** A switch the config turned off, with its reason; an absent or enabled switch needs no entry. */
function off(entry: Switch | undefined): Toggle | undefined {
  return entry?.enabled === false
    ? { enabled: false, reason: entry.reason ?? "disabled in web-tops.yaml" }
    : undefined;
}

/** The `layers.*` keys that build output stands for (WEB_TOPS.md section 7); `package_exports` runs inside gate 1. */
const BUILD_OUTPUT_KEYS: readonly LayerKey[] = [
  "size_limit",
  "html_validate",
  "axe",
  "rendered",
  "themes",
];

/** The gates whose `enabled` switch is `gates.<id>.enabled`. */
const GATE_SWITCHES = ["hygiene", "tests", "coverage", "crap", "mutation"] as const;

function mappedBuildKeys(config: WebTopsConfig): LayerKey[] {
  const mapped = profileFor(config.class)?.layers ?? [];
  return BUILD_OUTPUT_KEYS.filter((key) => mapped.includes(key));
}

/** Every mapped build layer is switched off: the reason is the config's, else a generic one. */
function allOff(config: WebTopsConfig, keys: readonly LayerKey[]): Toggle | undefined {
  const entries = keys.map((key) => config.layers?.[key]);
  if (!entries.every((entry) => entry?.enabled === false)) {
    return undefined;
  }
  const reason = entries.find((entry) => entry?.reason !== undefined)?.reason;
  return { enabled: false, reason: reason ?? "disabled in web-tops.yaml" };
}

/**
 * Build output is switched off when the class maps none of its layers, or the config switches off every
 * one the class maps. The reason is the config's, else names the class.
 */
function buildOutput(config: WebTopsConfig): Toggle | undefined {
  const keys = mappedBuildKeys(config);
  return keys.length === 0
    ? { enabled: false, reason: `class ${config.class} maps no build-output layer` }
    : allOff(config, keys);
}

/** Why a step is not mapped: a conditional one (astro_check) says what would map it. */
function unmapped(className: string, step: HygieneStep, conditional: boolean): string {
  return conditional
    ? `class ${className} maps ${step} only when package.json lists astro`
    : `class ${className} does not map ${step}`;
}

function isConditional(profile: Profile | undefined, step: HygieneStep): boolean {
  return profile?.conditionalSteps.some((name) => name === step) ?? false;
}

/** The class and the project map the step; `package_exports` is a layer key, the others are steps. */
function isMapped(profile: Profile | undefined, step: HygieneStep, project: Project): boolean {
  if (profile === undefined) {
    return false;
  }
  return step === "package_exports"
    ? profile.layers.includes("package_exports")
    : mapsStep(profile, step, project);
}

/** `skip_private` on a private package switches the exports check off with its own reason (WEB_TOPS.md section 9). */
function privateSkip(
  exports: PackageExportsLayer | undefined,
  project: Project,
): Switch | undefined {
  if (exports?.skip_private === undefined || project.isPrivate !== true) return undefined;
  return { enabled: false, reason: exports.skip_private };
}

function exportsSwitch(config: WebTopsConfig, project: Project): Switch | undefined {
  const exports = config.layers?.package_exports;
  return privateSkip(exports, project) ?? exports;
}

function stepSwitch(
  config: WebTopsConfig,
  hygiene: HygieneConfig | undefined,
  step: HygieneStep,
  project: Project,
): Switch | undefined {
  return step === "package_exports" ? exportsSwitch(config, project) : hygiene?.[step];
}

/** Off when the class and project do not map the step (`mapsStep`) or the config switches it off. */
function stepToggle(
  config: WebTopsConfig,
  hygiene: HygieneConfig | undefined,
  step: HygieneStep,
  project: Project,
): Toggle | undefined {
  const profile = profileFor(config.class);
  if (isMapped(profile, step, project)) {
    return off(stepSwitch(config, hygiene, step, project));
  }
  return { enabled: false, reason: unmapped(config.class, step, isConditional(profile, step)) };
}

function stepsOf(
  config: WebTopsConfig,
  hygiene: HygieneConfig | undefined,
  project: Project,
): Partial<Record<HygieneStep, Toggle>> {
  return Object.fromEntries(
    HYGIENE_STEPS.flatMap((step) => {
      const toggle = stepToggle(config, hygiene, step, project);
      return toggle === undefined ? [] : [[step, toggle]];
    }),
  );
}

function eslintConfigOf(hygiene: HygieneConfig | undefined): string | undefined {
  return hygiene?.eslint?.config;
}

function formatToolOf(hygiene: HygieneConfig | undefined): "prettier" | "biome" | undefined {
  return hygiene?.format?.tool;
}

function auditLevelOf(hygiene: HygieneConfig | undefined): AuditLevel {
  return hygiene?.audit?.fail_on ?? "high";
}

/** Gate 1 settings from `gates.hygiene` and `layers.package_exports`, resolved against the class and the project. */
function hygieneSettings(config: WebTopsConfig, project: Project): HygieneSettings {
  const hygiene = config.gates?.hygiene;
  const eslintConfig = eslintConfigOf(hygiene);
  const formatTool = formatToolOf(hygiene);
  return {
    steps: stepsOf(config, hygiene, project),
    ...(eslintConfig === undefined ? {} : { eslintConfig }),
    ...(formatTool === undefined ? {} : { formatTool }),
    auditFailOn: auditLevelOf(hygiene),
  };
}

/** Gate 3's floor is the config's, else the class profile's (WEB_TOPS.md section 5.2); `check` has already refused a class with no profile. */
function floorFor(config: WebTopsConfig, coverage: CoverageConfig | undefined): number {
  const profile = profileFor(config.class);
  if (profile === undefined) {
    throw new Error(`class ${config.class} has no launch profile`);
  }
  return coverage?.lines_floor ?? profile.linesFloor;
}

function coverageSettings(config: WebTopsConfig): CoverageSettings {
  const coverage = config.gates?.coverage;
  return { linesFloor: floorFor(config, coverage), exclude: coverage?.exclude ?? [] };
}

function crapConfig(config: WebTopsConfig): Gates["crap"] {
  return config.gates?.crap;
}

/** The class profile's CRAP cap (section 5.2); `check` has already refused a class with no profile. */
function classCap(config: WebTopsConfig): number {
  const profile = profileFor(config.class);
  if (profile === undefined) {
    throw new Error(`class ${config.class} has no launch profile`);
  }
  return profile.crapCap;
}

function capOf(config: WebTopsConfig): number {
  return crapConfig(config)?.cap ?? classCap(config);
}

function scopeOf(config: WebTopsConfig): "diff" | "all" {
  return crapConfig(config)?.scope ?? "diff";
}

function nullishOf(config: WebTopsConfig): boolean {
  return crapConfig(config)?.complexity?.nullish_discount ?? true;
}

/** Gate 4's cap is the config's, else the class profile's; the scope is the diff unless the config says all. */
function crapSettings(config: WebTopsConfig): CrapSettings {
  return { cap: capOf(config), scope: scopeOf(config), nullishDiscount: nullishOf(config) };
}

function profileOf(config: WebTopsConfig): Profile {
  const profile = profileFor(config.class);
  if (profile === undefined) {
    throw new Error(`class ${config.class} has no launch profile`);
  }
  return profile;
}

function mutationOf(config: WebTopsConfig): Gates["mutation"] {
  return config.gates?.mutation;
}

function maxSurvivorsOf(config: WebTopsConfig): number {
  return mutationOf(config)?.unexplained_survivors_max ?? profileOf(config).unexplainedSurvivorsMax;
}

function budgetOf(config: WebTopsConfig): number {
  return mutationOf(config)?.time_budget_minutes ?? profileOf(config).mutationBudgetMinutes;
}

function ledgerSetting(config: WebTopsConfig): { readonly ledger?: string } {
  const ledger = mutationOf(config)?.ledger;
  return ledger === undefined ? {} : { ledger };
}

/** Gate 5: the config's scope, survivors maximum and time budget, else the class profile's (sections 5.2 and 6.4). */
function mutationSettings(config: WebTopsConfig): MutationSettings {
  return {
    scope: mutationOf(config)?.scope ?? "diff",
    maxSurvivors: maxSurvivorsOf(config),
    timeBudgetMinutes: budgetOf(config),
    ...ledgerSetting(config),
  };
}

function testsSettings(config: WebTopsConfig): TestsSettings {
  return { shuffle: config.gates?.tests?.shuffle ?? true };
}

function togglesOf(config: WebTopsConfig): Record<string, Toggle> {
  const entries: readonly [string, Toggle | undefined][] = [
    ...GATE_SWITCHES.map((id): [string, Toggle | undefined] => [id, off(config.gates?.[id])]),
    ["build-output", buildOutput(config)],
    ["laws", off(config.laws)],
  ];
  return Object.fromEntries(
    entries.flatMap(([id, toggle]) => (toggle === undefined ? [] : [[id, toggle]])),
  );
}

function baseOf(config: WebTopsConfig): string | undefined {
  return config.gates?.mutation?.base;
}

/** The built-in layers the class profile does not require (section 3.3); custom layers are always required. */
function optionalOf(config: WebTopsConfig): readonly string[] {
  const profile = profileFor(config.class);
  const required = profile === undefined ? LAYER_IDS : requiredLayers(profile);
  return LAYER_IDS.filter((id) => !required.includes(id));
}

function routesSettings(config: WebTopsConfig): { readonly routes?: readonly string[] } {
  return config.routes === undefined ? {} : { routes: config.routes };
}

function buildSettings(config: WebTopsConfig): { readonly build?: BuildSettings } {
  const raw = config.build;
  if (raw === undefined) return {};
  const dir = raw.dir ?? "dist";
  return { build: { dir, ...(raw.command === undefined ? {} : { command: raw.command }) } };
}

function assignDefined<K extends keyof BudgetsSettings>(
  out: { -readonly [P in K]?: BudgetsSettings[P] },
  key: K,
  value: BudgetsSettings[K],
): void {
  if (value !== undefined) out[key] = value;
}

function budgetsSettings(config: WebTopsConfig): { readonly budgets?: BudgetsSettings } {
  const b = config.budgets;
  if (b === undefined) return {};
  const out: { -readonly [P in keyof BudgetsSettings]: BudgetsSettings[P] } = {};
  assignDefined(out, "pageJsBytes", b.page_js_bytes);
  assignDefined(out, "staticPageJsBytes", b.static_page_js_bytes);
  assignDefined(out, "routeJsBytes", b.route_js_bytes);
  assignDefined(out, "pages", b.pages);
  assignDefined(out, "routes", b.routes);
  return Object.keys(out).length === 0 ? {} : { budgets: out };
}

function customOf(config: WebTopsConfig): GateConfig["custom"] {
  return (config.layers?.custom ?? []).map(({ id, tier, command }) => ({ id, tier, command }));
}

/** Narrows a validated `web-tops.yaml` to what the runner needs (the class profile and the switches). */
export function toGateConfig(config: WebTopsConfig, project: Project): GateConfig {
  const base = baseOf(config);
  return {
    protocol: config.protocol,
    package: config.package,
    class: config.class,
    enforce: config.enforce,
    ...(base === undefined ? {} : { base }),
    ...(config.laws?.ack_ledger === undefined ? {} : { ackLedger: config.laws.ack_ledger }),
    reportPath: config.report.path,
    baselinePath: config.baseline,
    toggles: togglesOf(config),
    custom: customOf(config),
    optionalLayers: optionalOf(config),
    hygiene: hygieneSettings(config, project),
    tests: testsSettings(config),
    coverage: coverageSettings(config),
    crap: crapSettings(config),
    mutation: mutationSettings(config),
    ...buildSettings(config),
    ...routesSettings(config),
    ...budgetsSettings(config),
  };
}
