import { profileFor, type Profile, type Project } from "./profiles.ts";
import type { Problem, Switch, WebTopsConfig } from "./types.ts";

function isOn(gate: Switch | undefined): boolean {
  return gate?.enabled !== false;
}

function floorOf(config: WebTopsConfig): number | undefined {
  return config.gates?.coverage?.lines_floor;
}

/** The cap, unless the CRAP gate is switched off: a cap on a gate that does not run holds nothing. */
function capOf(config: WebTopsConfig): number | undefined {
  const crap = config.gates?.crap;
  return isOn(crap) ? crap?.cap : undefined;
}

function survivorsOf(config: WebTopsConfig): number {
  return config.gates?.mutation?.unexplained_survivors_max ?? 0;
}

function floorProblem(config: WebTopsConfig, profile: Profile): readonly Problem[] {
  const floor = floorOf(config);
  if (floor === undefined || floor >= profile.linesFloor) return [];
  return [
    {
      pointer: "/gates/coverage/lines_floor",
      message: `under hard, the coverage floor ${String(floor)} is below class ${config.class}'s ${String(profile.linesFloor)}`,
    },
  ];
}

function capProblem(config: WebTopsConfig, profile: Profile): readonly Problem[] {
  const cap = capOf(config);
  if (cap === undefined || cap <= profile.crapCap) return [];
  return [
    {
      pointer: "/gates/crap/cap",
      message: `under hard, the CRAP cap ${String(cap)} is above class ${config.class}'s ${String(profile.crapCap)}`,
    },
  ];
}

/** ts-library's survivors rule (always zero) already refuses its own pointer, so it is left to that rule. */
function survivorsLoose(config: WebTopsConfig, profile: Profile): boolean {
  return config.class !== "ts-library" && survivorsOf(config) > profile.unexplainedSurvivorsMax;
}

function survivorsProblem(config: WebTopsConfig, profile: Profile): readonly Problem[] {
  if (!isOn(config.gates?.mutation) || !survivorsLoose(config, profile)) return [];
  return [
    {
      pointer: "/gates/mutation/unexplained_survivors_max",
      message: `under hard, unexplained_survivors_max is above class ${config.class}'s ${String(profile.unexplainedSurvivorsMax)}`,
    },
  ];
}

/** Under `hard`, a floor, cap or survivors limit looser than the class profile is refused (WEB_TOPS.md section 12). */
export function checkLimits(config: WebTopsConfig): readonly Problem[] {
  const profile = profileFor(config.class);
  if (config.enforce !== "hard" || profile === undefined) return [];
  return [
    ...floorProblem(config, profile),
    ...capProblem(config, profile),
    ...survivorsProblem(config, profile),
  ];
}

const PRIVATE_LAYERS = ["package_exports", "size_limit"] as const;

/** `skip_private` needs `"private": true` in the package.json beside the config (section 9). */
export function checkSkipPrivate(config: WebTopsConfig, project: Project): readonly Problem[] {
  const layers = config.layers;
  if (project.isPrivate === true || layers === undefined) return [];
  return PRIVATE_LAYERS.flatMap((key) =>
    layers[key]?.skip_private === undefined
      ? []
      : [
          {
            pointer: `/layers/${key}/skip_private`,
            message: 'skip_private needs "private": true in the package.json beside web-tops.yaml',
          },
        ],
  );
}
