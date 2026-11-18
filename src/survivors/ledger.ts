import { parseDocument, visit } from "yaml";
import type { Document } from "yaml";
import type { Problem } from "../config/types.ts";
import { isCalendarDate } from "./dates.ts";
import { keyString } from "./key.ts";
import type { SurvivorKey } from "./key.ts";
import type { LedgerEntry, LedgerParse } from "./types.ts";

/** The version of the ledger file format this reader accepts. */
export const LEDGER_VERSION = 1;

const TOP_LEVEL = new Set(["version", "survivors"]);
const FIELDS = [
  "file",
  "function",
  "mutator",
  "original",
  "replacement",
  "occurrence",
  "reason",
  "owner",
  "expires",
] as const;

type Fields = Readonly<Record<string, unknown>>;

const problem = (pointer: string, message: string): Problem => ({ pointer, message });

const at = (index: number, key?: string): string =>
  key === undefined ? `/survivors/${String(index)}` : `/survivors/${String(index)}/${key}`;

const isMap = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const firstLine = (message: string): string => message.split("\n")[0] ?? message;

/** True when the document holds an alias: a ledger is plain data, and an alias can hide a repeated entry. */
function hasAlias(doc: Document): boolean {
  let found = false;
  visit(doc, {
    Alias: () => {
      found = true;
      return visit.BREAK;
    },
  });
  return found;
}

/** YAML that is not valid, has a duplicate key, an unresolved tag, or an alias. */
function yamlProblems(doc: Document): Problem[] {
  const found = [...doc.errors, ...doc.warnings].map((issue) =>
    problem("", firstLine(issue.message)),
  );
  return hasAlias(doc) ? [...found, problem("", "aliases are not allowed in the ledger")] : found;
}

type Got<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problem: Problem };

const got = <T>(value: T): Got<T> => ({ ok: true, value });
const bad = (pointer: string, message: string): Got<never> => ({
  ok: false,
  problem: problem(pointer, message),
});
const failure = (result: Got<unknown>): Problem[] => (result.ok ? [] : [result.problem]);
const valueOf = <T>(result: Got<T>, fallback: T): T => (result.ok ? result.value : fallback);

const isBlank = (value: string, exact: boolean): boolean => !exact && value.trim() === "";

/** A string field: present, a string, and (unless `exact`) not blank. */
function text(fields: Fields, index: number, key: string, exact: boolean): Got<string> {
  const value = fields[key];
  if (value === undefined) return bad(at(index, key), `${key} is missing`);
  if (typeof value !== "string") return bad(at(index, key), `${key} must be text`);
  return isBlank(value, exact) ? bad(at(index, key), `${key} is blank`) : got(value);
}

function occurrence(fields: Fields, index: number): Got<number> {
  const value = fields["occurrence"];
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) return got(value);
  return bad(at(index, "occurrence"), "occurrence must be a whole number, 1 or more");
}

function expires(fields: Fields, index: number): Got<string | undefined> {
  const value = fields["expires"];
  if (value === undefined) return got(undefined);
  if (typeof value === "string" && isCalendarDate(value)) return got(value);
  return bad(at(index, "expires"), "expires must be a real date written YYYY-MM-DD");
}

const unknownFields = (fields: Fields, index: number): Problem[] =>
  Object.keys(fields)
    .filter((key) => !FIELDS.some((field) => field === key))
    .map((key) => problem(at(index, key), `${key} is not a ledger field`));

/** A function key belongs to its file: `src/a.ts::f` for `src/a.ts`. */
function ownedBy(file: string, fn: string, index: number): Problem[] {
  return fn.startsWith(`${file}::`)
    ? []
    : [problem(at(index, "function"), `function must start with "${file}::"`)];
}

function partsOf(fields: Fields, index: number) {
  return {
    file: text(fields, index, "file", false),
    fn: text(fields, index, "function", false),
    mutator: text(fields, index, "mutator", false),
    original: text(fields, index, "original", true),
    replacement: text(fields, index, "replacement", true),
    occurrence: occurrence(fields, index),
    reason: text(fields, index, "reason", false),
    owner: text(fields, index, "owner", false),
    expires: expires(fields, index),
  };
}

type Parts = ReturnType<typeof partsOf>;

const keyOf = (parts: Parts): SurvivorKey => ({
  file: valueOf(parts.file, ""),
  function: valueOf(parts.fn, ""),
  mutator: valueOf(parts.mutator, ""),
  original: valueOf(parts.original, ""),
  replacement: valueOf(parts.replacement, ""),
  occurrence: valueOf(parts.occurrence, 0),
});

function build(fields: Fields, index: number): LedgerEntry | Problem[] {
  const parts = partsOf(fields, index);
  const found = [...unknownFields(fields, index), ...Object.values(parts).flatMap(failure)];
  const key = keyOf(parts);
  const owned = found.length === 0 ? ownedBy(key.file, key.function, index) : [];
  const all = [...found, ...owned];
  if (all.length > 0) return all;
  const { reason, owner, expires: until } = parts;
  return {
    key,
    reason: valueOf(reason, ""),
    owner: valueOf(owner, ""),
    expires: valueOf(until, undefined),
  };
}

function entryOf(raw: unknown, index: number): LedgerEntry | Problem[] {
  return isMap(raw) ? build(raw, index) : [problem(at(index), "an entry must be a map")];
}

/** Each key may appear once: a second entry for the same mutant is a problem at the later one. */
function duplicates(entries: readonly (LedgerEntry | undefined)[]): Problem[] {
  const first = new Map<string, number>();
  return entries.flatMap((entry, index) => {
    if (entry === undefined) return [];
    const seen = first.get(keyString(entry.key));
    first.set(keyString(entry.key), seen ?? index);
    return seen === undefined ? [] : [problem(at(index), `duplicates the entry at ${at(seen)}`)];
  });
}

const failuresOf = (built: readonly (LedgerEntry | Problem[])[]): Problem[] =>
  built.flatMap((item) => (Array.isArray(item) ? item : []));

const entriesIn = (built: readonly (LedgerEntry | Problem[])[]): (LedgerEntry | undefined)[] =>
  built.map((item) => (Array.isArray(item) ? undefined : item));

const present = (entries: readonly (LedgerEntry | undefined)[]): LedgerEntry[] =>
  entries.flatMap((entry) => (entry === undefined ? [] : [entry]));

function entriesOf(list: readonly unknown[]): LedgerParse {
  const built = list.map(entryOf);
  const problems = failuresOf(built);
  const entries = entriesIn(built);
  const all = [...problems, ...(problems.length === 0 ? duplicates(entries) : [])];
  return all.length > 0 ? { ok: false, problems: all } : { ok: true, entries: present(entries) };
}

function topLevel(value: Fields): Problem[] {
  const extra = Object.keys(value)
    .filter((key) => !TOP_LEVEL.has(key))
    .map((key) => problem(`/${key}`, `${key} is not a ledger key (version, survivors)`));
  const version =
    value["version"] === LEDGER_VERSION
      ? []
      : [problem("/version", `version must be ${String(LEDGER_VERSION)}`)];
  const list = value["survivors"];
  const shape =
    list === undefined || Array.isArray(list)
      ? []
      : [problem("/survivors", "survivors must be a list")];
  return [...extra, ...version, ...shape];
}

function fromMap(value: Fields): LedgerParse {
  const wrong = topLevel(value);
  if (wrong.length > 0) return { ok: false, problems: wrong };
  const list = value["survivors"];
  return entriesOf(Array.isArray(list) ? list : []);
}

function fromValue(value: unknown): LedgerParse {
  if (value === null || value === undefined) return { ok: true, entries: [] };
  if (!isMap(value))
    return {
      ok: false,
      problems: [problem("", "the ledger must be a map with version and survivors")],
    };
  return fromMap(value);
}

/**
 * Reads the text of `.web-tops/survivors.yaml`: an empty file or one of comments is an empty ledger.
 * Every problem carries a JSON pointer (`/survivors/2/owner`). Unknown fields, duplicate map keys,
 * aliases, unresolved tags, a blank `reason` or `owner`, a bad `occurrence` or `expires`, and two
 * entries for one key are all problems; nothing is guessed.
 */
export function parseLedger(source: string): LedgerParse {
  const doc = parseDocument(source.replace(/^\uFEFF/, ""), { uniqueKeys: true, merge: false });
  const syntax = yamlProblems(doc);
  return syntax.length > 0 ? { ok: false, problems: syntax } : fromValue(doc.toJS());
}
