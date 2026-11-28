import { compareLaws } from "./catalog.ts";
import { compareFileSets } from "./fileset.ts";
import { compareGlobs } from "./globs.ts";
import { compareLevels, comparedOf, type Renames } from "./levels.ts";
import { compareProfiles, profileNote } from "./profile.ts";
import { compareRanked, comparePart, type Outcome } from "./rank.ts";
import { compareBudgetSettings } from "./budgets.ts";
import { compareSets } from "./sets.ts";
import { defaultKnip } from "./knip.ts";
import { defaultSecretlint, nestedDefault } from "./secretlint.ts";
import { compareToolConfig } from "./toolconfig.ts";
import { compareTools } from "./tools.ts";
import { notCompared } from "./settings.ts";
import type { Cruise, Part, Ranked, Settings, Snapshot, Surface, ToolConfig } from "./types.ts";

const unionSize = <T>(left: ReadonlyMap<string, T>, right: ReadonlyMap<string, T>): number =>
  new Set([...left.keys(), ...right.keys()]).size;

function settingsOutcome(base: Settings, head: Settings): Outcome {
  return {
    items: [...compareBudgetSettings(base, head), ...compareGlobs(base.globs, head.globs)],
    compared: unionSize(base.values, head.values) + new Set([...base.globs, ...head.globs]).size,
  };
}

function rankedOutcome(
  base: ReadonlyMap<string, Ranked>,
  head: ReadonlyMap<string, Ranked>,
): Outcome {
  return { items: compareRanked(base, head), compared: unionSize(base, head) };
}

function profileOutcome(base: Snapshot["profile"], head: Snapshot["profile"]): Surface {
  return comparePart("profile", base, head, (before, after) => {
    const note = profileNote(before, after);
    return {
      items: compareProfiles(before, after),
      compared: new Set([...before.required, ...after.required, ...before.layers, ...after.layers])
        .size,
      ...(note === undefined ? {} : { note }),
    };
  });
}

function withNote(surface: Surface, note: string): Surface {
  return { ...surface, note: surface.note === undefined ? note : `${surface.note}; ${note}` };
}

function cruiseOutcome(base: Cruise, head: Cruise): Outcome {
  return {
    items: [
      ...compareRanked(base.values, head.values),
      ...compareSets("allowed", base.allowed, head.allowed, "added"),
      ...compareSets("left out", base.excluded, head.excluded, "added"),
    ],
    compared: unionSize(base.values, head.values) + base.allowed.length + base.excluded.length,
  };
}

function styleSurface(base: Snapshot, head: Snapshot, renames: Renames): Surface {
  return comparePart(
    "Stylelint rule levels and options (W-26)",
    base.style,
    head.style,
    (before, after) => {
      const seen = comparedOf(before, after, renames, head.trackedStyle);
      return {
        items: compareLevels(before, after, renames, head.trackedStyle),
        compared: seen.rules,
        note: `${String(seen.files)} files, ${String(seen.rules)} rules compared`,
      };
    },
  );
}

function fileSetSurface(base: Snapshot, head: Snapshot, renames: Renames): Surface {
  return comparePart(
    "tsconfig file set: include, exclude, files, references (W-04)",
    base.fileSets,
    head.fileSets,
    (before, after) => compareFileSets(before, after, renames, head.tracked),
  );
}

/** A tool's config at a ref, or what the tool runs with when the project keeps none there. */
const orDefault = (part: Snapshot["knip"], make: () => ToolConfig): Part<ToolConfig> =>
  part ?? { state: "ok", value: make() };

/** Every surface of the diff, in a fixed order, each listed whether or not anything moved. */
export function compareSnapshots(base: Snapshot, head: Snapshot, renames: Renames): Surface[] {
  return [
    comparePart("ESLint rule levels and options", base.levels, head.levels, (before, after) => {
      const seen = comparedOf(before, after, renames, head.tracked);
      return {
        items: compareLevels(before, after, renames, head.tracked),
        compared: seen.rules,
        note: `${String(seen.files)} files, ${String(seen.rules)} rules compared`,
      };
    }),
    comparePart("compiler flags", base.flags, head.flags, rankedOutcome),
    withNote(
      comparePart(
        "gate settings, floors, caps and budgets",
        base.settings,
        head.settings,
        settingsOutcome,
      ),
      notCompared(),
    ),
    comparePart("law catalog", base.laws, head.laws, (before, after) => ({
      items: compareLaws(before, after),
      compared: unionSize(before, after),
    })),
    profileOutcome(base.profile, head.profile),
    comparePart("tool versions", base.tools, head.tools, (before, after) => ({
      items: compareTools(before, after),
      compared: unionSize(before, after),
    })),
    styleSurface(base, head, renames),
    comparePart(
      "dependency-cruiser rules (W-16, W-17, W-19)",
      base.cruise,
      head.cruise,
      cruiseOutcome,
    ),
    fileSetSurface(base, head, renames),
    comparePart(
      "secretlint rules, allow lists and ignores (W-39)",
      orDefault(base.secretlint, defaultSecretlint),
      orDefault(head.secretlint, defaultSecretlint),
      (before, after) => compareToolConfig(before, after, nestedDefault),
    ),
    comparePart(
      "knip ignores, entries, projects and rule levels (W-48)",
      orDefault(base.knip, defaultKnip),
      orDefault(head.knip, defaultKnip),
      compareToolConfig,
    ),
  ];
}

/** How many compared parts got weaker, over every surface. */
export const weakenedCount = (surfaces: readonly Surface[]): number =>
  surfaces.reduce(
    (total, surface) => total + surface.items.filter((item) => item.change === "weakened").length,
    0,
  );
