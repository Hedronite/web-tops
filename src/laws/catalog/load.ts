import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { validateLaw } from "./schema.ts";
import type { Law } from "./types.ts";

/** A problem in the catalog: the file (or folder), the JSON pointer inside it, and what is wrong. */
export interface FileProblem {
  readonly file: string;
  readonly pointer: string;
  readonly message: string;
}

export type Catalog =
  | { readonly ok: true; readonly laws: readonly Law[] }
  | { readonly ok: false; readonly problems: readonly FileProblem[] };

type Read =
  | { readonly ok: true; readonly law: Law }
  | { readonly ok: false; readonly problems: readonly FileProblem[] };

const problem = (file: string, pointer: string, message: string): FileProblem => ({
  file,
  pointer,
  message,
});

const refused = (file: string, pointer: string, message: string): Read => ({
  ok: false,
  problems: [problem(file, pointer, message)],
});

type Parsed =
  { readonly ok: true; readonly doc: unknown } | { readonly ok: false; readonly message: string };

function parseFile(path: string): Parsed {
  try {
    const doc: unknown = parse(readFileSync(path, "utf8"));
    return { ok: true, doc };
  } catch (error) {
    return { ok: false, message: String(error) };
  }
}

/** One law file: valid YAML, valid against the schema, and named for its id. */
function readOne(dir: string, name: string): Read {
  const parsed = parseFile(join(dir, name));
  if (!parsed.ok) return refused(name, "", `is not valid YAML: ${parsed.message}`);
  const checked = validateLaw(parsed.doc);
  if (!checked.ok) {
    return {
      ok: false,
      problems: checked.problems.map((found) => problem(name, found.pointer, found.message)),
    };
  }
  const law = checked.value;
  return name === `${law.id}.yaml`
    ? { ok: true, law }
    : refused(name, "/id", `is ${law.id}: a file is named for its id`);
}

type Listed =
  | { readonly ok: true; readonly names: readonly string[] }
  | { readonly ok: false; readonly message: string };

/** The `.yaml` files of the folder, in id order (numbers compare as numbers, so W-100 follows W-99). */
function namesIn(dir: string): Listed {
  try {
    const names = readdirSync(dir).filter((name) => name.endsWith(".yaml"));
    return { ok: true, names: names.sort((a, b) => a.localeCompare(b, "en", { numeric: true })) };
  } catch (error) {
    return { ok: false, message: String(error) };
  }
}

const expected = (index: number): string => `W-${String(index + 1).padStart(2, "0")}`;

/** Ids run W-01, W-02, ... with no gap and no repeat: a law is added at the end, never renumbered (Q13). */
function sequenceProblems(laws: readonly Law[]): FileProblem[] {
  const index = laws.findIndex((law, at) => law.id !== expected(at));
  const law = laws[index];
  return law === undefined
    ? []
    : [
        problem(
          `${law.id}.yaml`,
          "/id",
          `is out of place: expected ${expected(index)} (ids run from W-01 with no gap)`,
        ),
      ];
}

function partition(reads: readonly Read[]): { laws: Law[]; problems: FileProblem[] } {
  const laws: Law[] = [];
  const problems: FileProblem[] = [];
  for (const read of reads) {
    if (read.ok) laws.push(read.law);
    else problems.push(...read.problems);
  }
  return { laws, problems };
}

/** Reads `laws/W-NN.yaml` from the folder and checks each file and the sequence of ids. */
export function loadCatalog(dir: string): Catalog {
  const listed = namesIn(dir);
  if (!listed.ok)
    return { ok: false, problems: [problem(dir, "", `cannot be read: ${listed.message}`)] };
  const { laws, problems } = partition(listed.names.map((name) => readOne(dir, name)));
  const all = problems.length > 0 ? problems : sequenceProblems(laws);
  return all.length === 0 ? { ok: true, laws } : { ok: false, problems: all };
}
