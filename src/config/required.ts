import { PROFILES, type LayerKey, type Profile, type Project } from "./profiles.ts";
import { LAYER_IDS, type BuiltInLayerId } from "./report.ts";

/**
 * The laws WEB_TOPS.md section 8.2 marks as judged in v0.1 (the tick column). A class requires the
 * judged laws it maps (section 3.3), so this list grows as laws get readers.
 */
export const JUDGED_LAWS: readonly string[] = [
  "W-01",
  "W-02",
  "W-04",
  "W-05",
  "W-06",
  "W-10",
  "W-11",
  "W-13",
  "W-14",
  "W-15",
  "W-16",
  "W-17",
  "W-18",
  "W-19",
  "W-20",
  "W-21",
  "W-22",
  "W-23",
  "W-26",
  "W-27",
  "W-29",
  "W-34",
  "W-35",
  "W-38",
  "W-40",
  "W-41",
];

/** W-01 to W-49 (WEB_TOPS.md section 8.2). */
export const LAW_COUNT = 49;
const ALL_LAWS = Array.from(
  { length: LAW_COUNT },
  (_, index) => `W-${String(index + 1).padStart(2, "0")}`,
);

/** The laws some class gates: a class maps these only if its own profile names them. */
const GATED = new Set(
  PROFILES.flatMap((profile) => [...profile.extraLaws, ...profile.conditionalLaws]),
);

/** The `layers.*` keys that build output stands for; `package_exports` runs inside gate 1 (section 7). */
const BUILD_OUTPUT: readonly LayerKey[] = [
  "size_limit",
  "html_validate",
  "axe",
  "rendered",
  "themes",
];

/** Every law the class maps: the ones no class gates, and the class's own (W-27 only with Astro). */
export function mappedLaws(profile: Profile, project: Project): readonly string[] {
  const own = [...profile.extraLaws, ...(project.dependsOnAstro ? profile.conditionalLaws : [])];
  return ALL_LAWS.filter((id) => !GATED.has(id) || own.includes(id));
}

/** The judged laws the class maps. */
export function requiredLaws(profile: Profile, project: Project): readonly string[] {
  return mappedLaws(profile, project).filter((id) => JUDGED_LAWS.includes(id));
}

/** The built-in layers the class requires, in report order; build output only where the class maps one. */
export function requiredLayers(profile: Profile): readonly BuiltInLayerId[] {
  const mapsBuild = profile.layers.some((key) => BUILD_OUTPUT.includes(key));
  return LAYER_IDS.filter((id) => id !== "build-output" || mapsBuild);
}

export function isRequiredLayer(profile: Profile, id: BuiltInLayerId): boolean {
  return requiredLayers(profile).includes(id);
}
