import type { Law, LawClass } from "./types.ts";

/** What `laws list` narrows to: the laws a class maps, and the laws a class (or any class) requires. */
export interface Filter {
  readonly cls: LawClass | undefined;
  readonly required: boolean;
}

const inClass = (law: Law, cls: LawClass | undefined): boolean =>
  cls === undefined || law.classes.includes(cls);

/** A law is required where it is mapped and judged (WEB_TOPS.md section 5.2): ticked, or given a reader in M3. */
const wanted = (law: Law, required: boolean): boolean => !required || law.judged !== "no";

export function select(laws: readonly Law[], filter: Filter): Law[] {
  return laws.filter((law) => inClass(law, filter.cls) && wanted(law, filter.required));
}

/** Whether the class maps the law only when the project depends on Astro (W-27). */
export const isConditional = (law: Law, cls: LawClass | undefined): boolean =>
  cls !== undefined && (law.conditional_classes ?? []).includes(cls);

export const findLaw = (laws: readonly Law[], id: string): Law | undefined =>
  laws.find((law) => law.id === id);
