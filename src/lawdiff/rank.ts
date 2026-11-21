import type { Change, Direction, Item, Part, Ranked, Surface } from "./types.ts";

type Sign = -1 | 0 | 1;

/** Which of two numbers is higher: 1 when the second is, -1 when the first is, else 0. */
export const sign = (first: number, second: number): Sign => {
  if (second > first) return 1;
  return second < first ? -1 : 0;
};

function directions(): Record<Sign, Direction> {
  return { [-1]: "weakened", 0: "unchanged", 1: "strengthened" };
}

const added = (after: Ranked | undefined): Change =>
  after !== undefined && after.rank > 0 ? "strengthened" : "unchanged";

const removed = (before: Ranked): Change => (before.rank > 0 ? "weakened" : "unchanged");

function moved(before: Ranked, after: Ranked): Change {
  const direction = directions()[sign(before.rank, after.rank)];
  return direction === "unchanged" && after.review === true && before.shown !== after.shown
    ? "changed"
    : direction;
}

/**
 * How one value moved by its rank. A value that is new is stronger only when it holds something (a rank above 0), and
 * one that is gone is weaker only when it held something; a value that differs and is for review is `changed`.
 */
export function changeOf(before: Ranked | undefined, after: Ranked | undefined): Change {
  if (before === undefined) return added(after);
  return after === undefined ? removed(before) : moved(before, after);
}

const shownOf = (value: Ranked | undefined): string =>
  value === undefined ? "absent" : value.shown;

/** The values that moved between two maps, by name. A name in only one of them has been added or removed. */
export function compareRanked(
  base: ReadonlyMap<string, Ranked>,
  head: ReadonlyMap<string, Ranked>,
): Item[] {
  const names = [...new Set([...base.keys(), ...head.keys()])].sort();
  return names.flatMap((what) => {
    const before = base.get(what);
    const after = head.get(what);
    const change = changeOf(before, after);
    return change === "unchanged"
      ? []
      : [{ what, change, before: shownOf(before), after: shownOf(after) }];
  });
}

const unreadable = (ref: string, message: string): Item => ({
  what: `the surface at ${ref}`,
  change: "weakened",
  before: "readable",
  after: `cannot be read: ${message}`,
});

interface Outcome {
  readonly items: readonly Item[];
  readonly compared: number;
  readonly note?: string;
}

function gone(name: string, base: boolean): Outcome {
  const item: Item = base
    ? { what: name, change: "weakened", before: "present", after: "absent" }
    : { what: name, change: "strengthened", before: "absent", after: "present" };
  return { items: [item], compared: 1 };
}

/**
 * Compares one surface across two refs. A surface that cannot be read at either ref is never a pass: the diff
 * cannot say it held, so it says it did not. A surface that is not there at both is unchanged, and says so.
 */
export function comparePart<T>(
  name: string,
  base: Part<T>,
  head: Part<T>,
  compare: (base: T, head: T) => Outcome,
): Surface {
  const made = outcomeOf(name, base, head, compare);
  return { name, compared: made.compared, items: made.items, ...noteOf(made.note) };
}

const noteOf = (note: string | undefined): { note?: string } =>
  note === undefined ? {} : { note };

const broken = <T>(ref: string, part: Part<T>): Outcome | undefined =>
  part.state === "error" ? { items: [unreadable(ref, part.message)], compared: 0 } : undefined;

function alone<T>(name: string, base: Part<T>, head: Part<T>): Outcome {
  if (base.state === "ok") return gone(name, true);
  return head.state === "ok"
    ? gone(name, false)
    : { items: [], compared: 0, note: "not there at either ref" };
}

function both<T>(
  name: string,
  base: Part<T>,
  head: Part<T>,
  compare: (base: T, head: T) => Outcome,
): Outcome {
  return base.state === "ok" && head.state === "ok"
    ? compare(base.value, head.value)
    : alone(name, base, head);
}

function outcomeOf<T>(
  name: string,
  base: Part<T>,
  head: Part<T>,
  compare: (base: T, head: T) => Outcome,
): Outcome {
  return broken("base", base) ?? broken("head", head) ?? both(name, base, head, compare);
}

export type { Outcome };
