import type { Item } from "./types.ts";

/** The coverage exclusions that moved: a glob the head excludes that the base did not is weaker, one it dropped stronger. */
export function compareGlobs(base: readonly string[], head: readonly string[]): Item[] {
  const had = new Set(base);
  const has = new Set(head);
  const added = [...has].filter((glob) => !had.has(glob)).sort();
  const dropped = [...had].filter((glob) => !has.has(glob)).sort();
  return [
    ...added.map((glob) => ({
      what: "gates.coverage.exclude",
      change: "weakened" as const,
      before: "covered",
      after: "excluded",
      where: glob,
    })),
    ...dropped.map((glob) => ({
      what: "gates.coverage.exclude",
      change: "strengthened" as const,
      before: "excluded",
      after: "covered",
      where: glob,
    })),
  ];
}
