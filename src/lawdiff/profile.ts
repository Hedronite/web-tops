import { compareRanked } from "./rank.ts";
import type { Item, Profile, Ranked } from "./types.ts";

const PRESENT: Ranked = { shown: "required", rank: 1 };

function heldBy(profile: Profile): Map<string, Ranked> {
  const held = new Map<string, Ranked>();
  profile.required.forEach((id) => held.set(`law ${id}`, PRESENT));
  profile.layers.forEach((layer) => held.set(`layer ${layer}`, PRESENT));
  return held;
}

/** What the class requires of the project: each law it requires and each layer it maps, at either ref. */
export const compareProfiles = (base: Profile, head: Profile): Item[] =>
  compareRanked(heldBy(base), heldBy(head));

export const profileNote = (base: Profile, head: Profile): string | undefined =>
  base.className === head.className
    ? undefined
    : `class ${base.className} became ${head.className}`;
