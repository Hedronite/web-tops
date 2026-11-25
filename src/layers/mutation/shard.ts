import { createHash } from "node:crypto";

/**
 * Sharding the mutation run: the `mutate` entries (`file:start-end`, or a whole file) are split into `count` groups that
 * are disjoint, cover every entry, and are the same on every machine, so shard `index` of `count` is reproducible.
 */

export type Weigh = (entry: ParsedEntry) => number;

export interface ParsedEntry {
  readonly text: string;
  readonly file: string;
  /** The first line of the range; 0 for a whole file, which sorts before its ranges. */
  readonly start: number;
  /** The last line of the range; 0 for a whole file. */
  readonly end: number;
}

/** `file:start-end`, or `file` alone; Stryker's column forms (`:1:3-1:5`) are not written by the gate. */
function parseEntry(text: string): ParsedEntry {
  const match = /^(.*):(\d+)-(\d+)$/u.exec(text);
  return match === null
    ? { text, file: text, start: 0, end: 0 }
    : { text, file: String(match[1]), start: Number(match[2]), end: Number(match[3]) };
}

const bySource = (left: ParsedEntry, right: ParsedEntry): number =>
  Number(left.file > right.file) - Number(left.file < right.file) ||
  left.start - right.start ||
  left.end - right.end;

/** A range weighs its lines, which is what the mutants of a function follow; a whole file weighs one unless told. */
function linesOf(entry: ParsedEntry): number {
  return entry.end - entry.start + 1;
}

const isWithin = (value: number, low: number, high: number): boolean =>
  Number.isInteger(value) && value >= low && value <= high;

function checked(index: number, count: number): void {
  if (!isWithin(count, 1, Number.MAX_SAFE_INTEGER) || !isWithin(index, 1, count)) {
    throw new RangeError(`shard ${String(index)}/${String(count)} is not a shard`);
  }
}

/** The shard each entry goes to, heaviest first, each to the lightest shard so far (the lowest on a tie). */
function assign(
  entries: readonly ParsedEntry[],
  count: number,
  weigh: Weigh,
): Map<ParsedEntry, number> {
  const load = Array.from({ length: count }, () => 0);
  const placed = new Map<ParsedEntry, number>();
  const heaviest = [...entries].sort((left, right) => weigh(right) - weigh(left));
  for (const entry of heaviest) {
    const target = load.indexOf(Math.min(...load));
    load[target] = (load[target] ?? 0) + weigh(entry);
    placed.set(entry, target + 1);
  }
  return placed;
}

function canonicalEntries(entries: readonly string[]): ParsedEntry[] {
  return [...new Set(entries)].map(parseEntry).sort(bySource);
}

/**
 * Deterministic SHA-256 hex digest of the canonical sorted unique `mutate` entries so the join can verify
 * every shard partitioned the exact same entry set (including the empty set).
 */
export function hashEntries(entries: readonly string[]): string {
  const payload = canonicalEntries(entries)
    .map((entry) => entry.text)
    .join("\n");
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * The `mutate` entries of shard `index` (1 to `count`), in source order. Entries are never cut: a range is a whole
 * scored unit (section 6.7), so the occurrence of a survivor's key is the same in a shard as in the whole run.
 */
export function shardOf(
  entries: readonly string[],
  index: number,
  count: number,
  weigh: Weigh = linesOf,
): string[] {
  checked(index, count);
  const sorted = canonicalEntries(entries);
  const placed = assign(sorted, count, weigh);
  return sorted.filter((entry) => placed.get(entry) === index).map((entry) => entry.text);
}
