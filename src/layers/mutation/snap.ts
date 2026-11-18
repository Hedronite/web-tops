import { analyzeFile } from "../../complexity/index.ts";
import type { Ts } from "../../complexity/index.ts";

/** An inclusive range of 1-based lines. */
interface Range {
  readonly start: number;
  readonly end: number;
}

interface Entry extends Range {
  readonly file: string;
}

const ENTRY = /^(.+):(\d+)-(\d+)$/u;

function parse(entry: string): Entry | undefined {
  const [file, start, end] = ENTRY.exec(entry)?.slice(1) ?? [];
  return file === undefined ? undefined : { file, start: Number(start), end: Number(end) };
}

/** The line spans of the scored units of a file (never `<module>`), or undefined when the file cannot be read as code. */
function unitsOf(ts: Ts, file: string, text: string | undefined): Range[] | undefined {
  if (text === undefined) {
    return undefined;
  }
  try {
    return analyzeFile(ts, file, text)
      .records.filter((record) => record.scored && record.kind !== "module")
      .map((record) => ({ start: record.span.startLine, end: record.span.endLine }));
  } catch {
    return undefined;
  }
}

const overlaps = (a: Range, b: Range): boolean => a.start <= b.end && b.start <= a.end;

/** A range and every scored unit it reaches into, so a changed line mutates its whole function. */
const widen = (range: Range, units: readonly Range[]): Range[] => [
  range,
  ...units.filter((unit) => overlaps(range, unit)),
];

/** The ranges in line order, with those that overlap or touch joined. */
function joined(ranges: readonly Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  return sorted.reduce<Range[]>((done, next) => {
    const last = done.at(-1);
    return last !== undefined && next.start <= last.end + 1
      ? [...done.slice(0, -1), { start: last.start, end: Math.max(last.end, next.end) }]
      : [...done, next];
  }, []);
}

const show = (file: string, range: Range): string =>
  `${file}:${String(range.start)}-${String(range.end)}`;

/**
 * Widens each `file:start-end` entry to the scored units it reaches into (WEB_TOPS.md section 6.4), so whole
 * functions are mutated and a survivor's key always names a unit. Lines outside every unit stay as they are. An
 * entry whose file cannot be read or parsed, or that has no range, is kept as it was given.
 */
export function snapEntries(
  ts: Ts,
  entries: readonly string[],
  text: (file: string) => string | undefined,
): string[] {
  const parsed = entries.map((entry) => ({ entry, found: parse(entry) }));
  const byFile = new Map<string, Range[]>();
  for (const { found } of parsed) {
    if (found !== undefined) {
      byFile.set(found.file, [...(byFile.get(found.file) ?? []), found]);
    }
  }
  const kept = parsed.filter((item) => item.found === undefined).map((item) => item.entry);
  const snapped = [...byFile.keys()].sort().flatMap((file) => {
    const ranges = byFile.get(file) ?? [];
    const units = unitsOf(ts, file, text(file));
    return units === undefined
      ? ranges.map((range) => show(file, range))
      : joined(ranges.flatMap((range) => widen(range, units))).map((range) => show(file, range));
  });
  return [...kept, ...snapped];
}
