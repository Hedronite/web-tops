import type { Item } from "./types.ts";

/** Which way a set loosens a check: by gaining an entry (an exclusion, an allowance), or by losing one (an include, a reference). */
export type Loosens = "added" | "removed";

const item = (what: string, entry: string, weaker: boolean, listed: boolean): Item => ({
  what,
  change: weaker ? "weakened" : "strengthened",
  before: listed ? "not listed" : "listed",
  after: listed ? "listed" : "not listed",
  where: entry,
});

/**
 * The entries of a set that moved. An entry only the head has was added, one only the base has was removed; whether
 * that is weaker depends on the set: an added exclusion or allowance is, a removed include or reference is.
 */
export function compareSets(
  what: string,
  base: readonly string[],
  head: readonly string[],
  loosens: Loosens,
): Item[] {
  const had = new Set(base);
  const has = new Set(head);
  const added = [...has].filter((entry) => !had.has(entry)).sort();
  const removed = [...had].filter((entry) => !has.has(entry)).sort();
  return [
    ...added.map((entry) => item(what, entry, loosens === "added", true)),
    ...removed.map((entry) => item(what, entry, loosens === "removed", false)),
  ];
}
