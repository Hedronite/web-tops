/** The one class table (WEB_TOPS.md section 5): classes, launch profiles, floors, caps, mapped layers. */

export const CLASSES = [
  "ts-library",
  "ui-components",
  "astro-site",
  "web-app",
  "node-service",
  "cli",
  "workspace-root",
  "config-only",
] as const;

export type ClassName = (typeof CLASSES)[number];

/** The `layers.*` keys that a class can map. `custom` is open to every class. */
export const LAYER_KEYS = [
  "package_exports",
  "size_limit",
  "html_validate",
  "axe",
  "rendered",
  "themes",
] as const;

export type LayerKey = (typeof LAYER_KEYS)[number];

/** The gate 1 steps of WEB_TOPS.md section 9, in run order. */
export const STEP_KEYS = [
  "install",
  "tsc",
  "astro_check",
  "eslint",
  "stylelint",
  "format",
  "dependency_cruiser",
  "audit",
] as const;

export type StepKey = (typeof STEP_KEYS)[number];

export interface Profile {
  readonly class: ClassName;
  /** Line coverage floor in percent (section 5.2). */
  readonly linesFloor: number;
  /** One CRAP cap per class (section 5.2). */
  readonly crapCap: number;
  readonly unexplainedSurvivorsMax: number;
  /** Layers this class maps. Every other `layers.*` key is written `enabled: false` with a reason. */
  readonly layers: readonly LayerKey[];
  /** Gate 1 steps this class maps. An unmapped step is `skip` with a reason that names the class. */
  readonly steps: readonly StepKey[];
}

const CORE_STEPS: readonly StepKey[] = [
  "install",
  "tsc",
  "eslint",
  "format",
  "dependency_cruiser",
  "audit",
];

/** The launch classes, in section 5.2's column order. */
export const PROFILES: readonly Profile[] = [
  {
    class: "ts-library",
    linesFloor: 85,
    crapCap: 4,
    unexplainedSurvivorsMax: 0,
    layers: ["package_exports", "size_limit"],
    steps: CORE_STEPS,
  },
  {
    class: "ui-components",
    linesFloor: 80,
    crapCap: 5,
    unexplainedSurvivorsMax: 1,
    layers: ["package_exports", "size_limit", "html_validate", "axe"],
    steps: [...CORE_STEPS, "stylelint"],
  },
  {
    class: "astro-site",
    linesFloor: 70,
    crapCap: 6,
    unexplainedSurvivorsMax: 2,
    layers: ["html_validate", "axe", "rendered", "themes"],
    steps: [...CORE_STEPS, "astro_check", "stylelint"],
  },
  {
    class: "web-app",
    linesFloor: 70,
    crapCap: 6,
    unexplainedSurvivorsMax: 2,
    layers: ["html_validate", "axe", "rendered", "themes"],
    steps: [...CORE_STEPS, "astro_check", "stylelint"],
  },
  {
    class: "node-service",
    linesFloor: 80,
    crapCap: 5,
    unexplainedSurvivorsMax: 1,
    layers: [],
    steps: CORE_STEPS,
  },
];

/** The profile of a class, or undefined for a class without a launch profile. */
export function profileFor(name: string): Profile | undefined {
  return PROFILES.find((profile) => profile.class === name);
}
