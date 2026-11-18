import type { Ts } from "../../complexity/index.ts";
import { keyMutants } from "../../survivors/key.ts";
import type { Mutant, SurvivorKey } from "../../survivors/key.ts";

/** A mutant as Stryker's JSON reports it, with its status. */
interface Reported extends Mutant {
  readonly status: string;
}

/** One survivor: the mutant's status, where it is, and the key a ledger entry matches it by. */
export interface SurvivorRow {
  readonly status: string;
  readonly file: string;
  readonly line: number;
  readonly key: SurvivorKey;
}

export interface MutationRead {
  readonly killed: number;
  readonly survivors: readonly SurvivorRow[];
  readonly excluded: number;
  /** Statuses the table does not list, each once, in the order met. */
  readonly unknown: readonly string[];
}

type Kind = "killed" | "survivor" | "excluded";

/**
 * The P3 status table (WEB_TOPS.md section 6.4). `NoCoverage` counts with `Survived`: a function no test runs has
 * only `NoCoverage` mutants, and counting `Survived` alone would score it best.
 */
const KINDS: ReadonlyMap<string, Kind> = new Map([
  ["Killed", "killed"],
  ["Timeout", "killed"],
  ["Survived", "survivor"],
  ["NoCoverage", "survivor"],
  ["CompileError", "excluded"],
  ["RuntimeError", "excluded"],
  ["Ignored", "excluded"],
]);

interface Tally {
  killed: number;
  excluded: number;
  survivors: SurvivorRow[];
  unknown: string[];
}

const COUNT: Readonly<Record<Kind, (tally: Tally, row: SurvivorRow) => void>> = {
  killed: (tally) => {
    tally.killed += 1;
  },
  excluded: (tally) => {
    tally.excluded += 1;
  },
  survivor: (tally, row) => {
    tally.survivors.push(row);
  },
};

function count(tally: Tally, row: SurvivorRow): void {
  const kind = KINDS.get(row.status);
  if (kind !== undefined) {
    COUNT[kind](tally, row);
  } else if (!tally.unknown.includes(row.status)) {
    tally.unknown.push(row.status);
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function bad(what: string): Error {
  return new Error(`the mutation report is not Stryker's: ${what}`);
}

function positionOf(value: unknown): Mutant["location"]["start"] {
  if (isRecord(value) && typeof value["line"] === "number" && typeof value["column"] === "number") {
    return { line: value["line"], column: value["column"] };
  }
  throw bad("a mutant has no line and column");
}

function recordOf(value: unknown, what: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw bad(`${what} is not an object`);
  }
  return value;
}

function stringOf(fields: Readonly<Record<string, unknown>>, key: string): string {
  const found = fields[key];
  if (typeof found !== "string") {
    throw bad(`a mutant has no ${key}`);
  }
  return found;
}

function mutantOf(value: unknown): Reported {
  const fields = recordOf(value, "a mutant");
  const location = recordOf(fields["location"], "a mutant's location");
  const status = fields["status"];
  return {
    mutatorName: stringOf(fields, "mutatorName"),
    replacement: stringOf(fields, "replacement"),
    status: typeof status === "string" ? status : "",
    location: { start: positionOf(location["start"]), end: positionOf(location["end"]) },
  };
}

/** The mutants a file entry of the report lists. */
function mutantsOf(file: string, entry: unknown): Reported[] {
  const mutants = isRecord(entry) ? entry["mutants"] : undefined;
  if (!Array.isArray(mutants)) {
    throw bad(`${file} has no mutants`);
  }
  return mutants.map(mutantOf);
}

/** The mutants of each file of the report, in the report's order. */
function filesOf(report: unknown): [string, Reported[]][] {
  const files = isRecord(report) ? report["files"] : undefined;
  if (!isRecord(files)) {
    throw bad("it has no files");
  }
  return Object.entries(files).map(([file, entry]) => [file, mutantsOf(file, entry)]);
}

export interface ReadInput {
  readonly ts: Ts;
  readonly report: unknown;
  /** The source of a project-relative file, or undefined when it cannot be read. */
  readonly text: (file: string) => string | undefined;
}

/**
 * Reads a Stryker JSON report through the status table and keys each survivor (section 6.4). Every mutant of a file
 * is keyed, whatever its status, so the occurrence of a survivor does not move when a neighbour is killed. Throws
 * for a report that is not Stryker's, and for a file whose source cannot be read.
 */
export function readMutation(input: ReadInput): MutationRead {
  const tally: Tally = { killed: 0, excluded: 0, survivors: [], unknown: [] };
  for (const [file, mutants] of filesOf(input.report)) {
    const source = input.text(file);
    if (source === undefined) {
      throw new Error(`${file}: the source of a mutated file could not be read`);
    }
    const keys = keyMutants(input.ts, file, source, mutants);
    mutants.forEach((mutant, index) => {
      const key = keys[index];
      if (key !== undefined) {
        count(tally, { status: mutant.status, file, line: mutant.location.start.line, key });
      }
    });
  }
  return tally;
}
