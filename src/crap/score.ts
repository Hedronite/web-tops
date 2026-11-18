import { analyzeFile, functionAt } from "../complexity/index.ts";
import type { Analysis, FunctionRecord, Options, Ts } from "../complexity/index.ts";
import { functionCoverage, moduleCoverage } from "../layers/coverage/functions.ts";
import { crapOf } from "./formula.ts";

/** One scored function: the counter's complexity joined with its statement coverage (WEB_TOPS.md section 6.2). */
export interface CrapRow {
  readonly file: string;
  /** The section 6.7 key, `file::container.chain.name`. */
  readonly key: string;
  /** The key without its file, which is the name the report carries. */
  readonly name: string;
  readonly line: number;
  readonly endLine: number;
  readonly complexity: number;
  /** Statement coverage of the function's body, 0 when it never ran. */
  readonly coverage: number;
  readonly crap: number;
}

export interface ScoreInput {
  readonly ts: Ts;
  readonly file: string;
  readonly text: string;
  /** This file's entry of `coverage-final.json`, or undefined when the run never reported it. */
  readonly coverage: unknown;
  readonly options: Options;
}

/** The offset where each line starts, so a coverage position (line, column) becomes an offset in the text. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
    starts.push(index + 1);
  }
  return starts;
}

/** The scored unit a coverage function is the body of, when it is that unit's own and not one folded into it. */
function ownUnit(analysis: Analysis, offset: number): string | undefined {
  const located = functionAt(analysis, offset);
  return located.innermost === located.scored ? located.scored : undefined;
}

function offsetOf(starts: readonly number[], fn: { line: number; column: number }): number {
  return (starts[fn.line - 1] ?? 0) + fn.column;
}

/**
 * The coverage of each scored unit: the coverage function whose body starts inside the unit and in none of
 * the functions folded into it. Its statements include those of the folded functions (section 6.2).
 */
function unitCoverage(input: ScoreInput, analysis: Analysis): Map<string, number> {
  const starts = lineStarts(input.text);
  const covers = new Map<string, number>();
  for (const fn of functionCoverage({ [input.file]: input.coverage })) {
    const unit = ownUnit(analysis, offsetOf(starts, fn));
    if (unit !== undefined && !covers.has(unit)) {
      covers.set(unit, fn.cov);
    }
  }
  return covers;
}

/** A unit is scored when the counter says so; module code only when it branches (a bare `<module>` has complexity 1). */
function isScored(record: FunctionRecord): boolean {
  return record.scored && (record.kind !== "module" || record.score > 1);
}

function rowOf(file: string, record: FunctionRecord, coverage: number): CrapRow {
  return {
    file,
    key: record.key,
    name: record.key.slice(file.length + 2),
    line: record.span.startLine,
    endLine: record.span.endLine,
    complexity: record.score,
    coverage,
    crap: crapOf(record.score, coverage),
  };
}

/** Every scored function of a file with its CRAP, in source order. A function the run never reported has cov 0. */
export function scoreFile(input: ScoreInput): CrapRow[] {
  const analysis = analyzeFile(input.ts, input.file, input.text, input.options);
  const covers = unitCoverage(input, analysis);
  const module = moduleCoverage(input.coverage);
  return analysis.records
    .filter(isScored)
    .map((record) =>
      rowOf(input.file, record, record.kind === "module" ? module : (covers.get(record.key) ?? 0)),
    );
}
