import { analyzeFile, functionAt } from "../complexity/index.ts";
import type { Ts } from "../complexity/index.ts";

/** A line and column as Stryker writes them in `mutation.json`: both 1-based, the end exclusive. */
export interface Position {
  readonly line: number;
  readonly column: number;
}

/** The parts of one Stryker mutant the key needs. */
export interface Mutant {
  readonly mutatorName: string;
  readonly replacement: string;
  readonly location: { readonly start: Position; readonly end: Position };
}

/**
 * The key of a mutant (WEB_TOPS.md section 6.4): never Stryker's mutant id, which is a run ordinal, and
 * never a line number, so an entry in the survivor ledger outlives edits elsewhere in the file.
 */
export interface SurvivorKey {
  readonly file: string;
  /** The section 6.7 key of the scored unit the mutant is written in: a callback counts for the function that holds it. */
  readonly function: string;
  readonly mutator: string;
  /** The source text the mutator replaced, as written (a block mutant's original is the whole block). */
  readonly original: string;
  readonly replacement: string;
  /** 1-based, in source order, among the mutants of the same mutator, original and replacement in that function. */
  readonly occurrence: number;
}

/** A mutant whose location is not in the file it is said to belong to. */
export class SurvivorKeyError extends Error {
  readonly file: string;

  constructor(message: string, file: string) {
    super(`${file}: ${message}`);
    this.name = "SurvivorKeyError";
    this.file = file;
  }
}

const LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/g;

/** The offset at which each line starts, counting `\r\n`, `\n`, `\r`, U+2028 and U+2029 as one break each. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (const found of text.matchAll(LINE_BREAK)) starts.push(found.index + found[0].length);
  return starts;
}

interface Source {
  readonly file: string;
  readonly text: string;
  readonly starts: readonly number[];
}

/** Where a line ends: the start of the next, or one past the text for the last line. */
const lineEndOf = (source: Source, line: number): number =>
  source.starts[line] ?? source.text.length + 1;

function inFile(source: Source, position: Position): number | undefined {
  const lineStart = source.starts[position.line - 1];
  if (lineStart === undefined || position.column < 1) return undefined;
  const offset = lineStart + position.column - 1;
  return offset < lineEndOf(source, position.line) ? offset : undefined;
}

function offsetOf(source: Source, position: Position): number {
  const offset = inFile(source, position);
  if (offset !== undefined) return offset;
  const where = `${String(position.line)}:${String(position.column)}`;
  throw new SurvivorKeyError(`a mutant location ${where} is not in the file`, source.file);
}

interface Placed {
  readonly index: number;
  readonly mutant: Mutant;
  readonly start: number;
  readonly end: number;
}

function place(source: Source, mutant: Mutant, index: number): Placed {
  const start = offsetOf(source, mutant.location.start);
  const end = offsetOf(source, mutant.location.end);
  if (end >= start) return { index, mutant, start, end };
  throw new SurvivorKeyError(`mutant ${String(index)} ends before it starts`, source.file);
}

const bySource = (a: Placed, b: Placed): number =>
  a.start - b.start || a.end - b.end || a.index - b.index;

/** What makes two mutants the same mutation: the occurrence counts within one of these. */
const groupOf = (fn: string, mutant: Mutant, original: string): string =>
  JSON.stringify([fn, mutant.mutatorName, original, mutant.replacement]);

/**
 * The key of every mutant of one file, in the order given. Pass every mutant Stryker reported for the
 * file, whatever its status, not only the survivors: the occurrence counts the others too, so killing
 * a neighbour does not move a survivor's key. `file` is the project-relative path (forward slashes) the
 * key carries and the one the function keys start with. Throws `ComplexityError` for a file that does
 * not parse and `SurvivorKeyError` for a location outside the file.
 */
export function keyMutants(
  ts: Ts,
  file: string,
  text: string,
  mutants: readonly Mutant[],
): SurvivorKey[] {
  const source: Source = { file, text, starts: lineStarts(text) };
  const analysis = analyzeFile(ts, file, text);
  const seen = new Map<string, number>();
  const keys: SurvivorKey[] = [];
  const placed = mutants.map((mutant, index) => place(source, mutant, index)).sort(bySource);
  for (const at of placed) {
    const original = text.slice(at.start, at.end);
    const fn = functionAt(analysis, at.start).scored;
    const group = groupOf(fn, at.mutant, original);
    const occurrence = (seen.get(group) ?? 0) + 1;
    seen.set(group, occurrence);
    keys[at.index] = {
      file,
      function: fn,
      mutator: at.mutant.mutatorName,
      original,
      replacement: at.mutant.replacement,
      occurrence,
    };
  }
  return keys;
}

/** One string for a key, equal exactly when all six fields are: what a ledger lookup compares. */
export const keyString = (key: SurvivorKey): string =>
  JSON.stringify([
    key.file,
    key.function,
    key.mutator,
    key.original,
    key.replacement,
    key.occurrence,
  ]);
