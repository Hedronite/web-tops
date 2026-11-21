import { compareLaws } from "./catalog.ts";
import { compareFileSets } from "./fileset.ts";
import { compareGlobs } from "./globs.ts";
import { compareLevels, comparedOf, type Renames } from "./levels.ts";
import { compareProfiles, profileNote } from "./profile.ts";
import { compareRanked, comparePart, type Outcome } from "./rank.ts";
import { compareTools } from "./tools.ts";
import { notCompared } from "./settings.ts";
import type { Ranked, Settings, Snapshot, Surface } from "./types.ts";

const unionSize = <T>(left: ReadonlyMap<string, T>, right: ReadonlyMap<string, T>): number =>
  new Set([...left.keys(), ...right.keys()]).size;

function settingsOutcome(base: Settings, head: Settings): Outcome {
  return {
    items: [...compareRanked(base.values, head.values), ...compareGlobs(base.globs, head.globs)],
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

function fileSetSurface(base: Snapshot, head: Snapshot, renames: Renames): Surface {
  return comparePart(
    "tsconfig file set: include, exclude, files, references (W-04)",
    base.fileSets,
    head.fileSets,
    (before, after) => compareFileSets(before, after, renames, head.tracked),
  );
}

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
    fileSetSurface(base, head, renames),
  ];
}

/** How many compared parts got weaker, over every surface. */
export const weakenedCount = (surfaces: readonly Surface[]): number =>
  surfaces.reduce(
    (total, surface) => total + surface.items.filter((item) => item.change === "weakened").length,
    0,
  );
