import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { analyzeFile } from "./analyze.ts";
import type { Analysis, FunctionRecord } from "./types.ts";

export { ts };

export const FIXTURES = fileURLToPath(new URL("../../fixtures/complexity/", import.meta.url));

/** The hand-written shape of one record in `expected.json`; the counter never writes these. */
export interface Expected {
  readonly key: string;
  readonly kind: string;
  readonly scored: boolean;
  readonly own: number;
  readonly score: number;
  readonly lines: readonly [number, number];
}

export interface Golden {
  readonly name: string;
  readonly file: string;
  readonly text: string;
  readonly records: readonly Expected[];
  readonly withoutDiscount: readonly Expected[] | undefined;
  readonly diagnostics: "some" | undefined;
}

type Fields = Readonly<Record<string, unknown>>;

function fieldsOf(raw: unknown, what: string): Fields {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new Error(`${what} is not an object`);
  return Object.fromEntries(Object.entries(raw));
}

function text(fields: Fields, key: string): string {
  const value = fields[key];
  if (typeof value !== "string") throw new Error(`${key} is not a string`);
  return value;
}

function number(fields: Fields, key: string): number {
  const value = fields[key];
  if (typeof value !== "number") throw new Error(`${key} is not a number`);
  return value;
}

function lines(fields: Fields): readonly [number, number] {
  const value = fields["lines"];
  const pair: unknown[] = Array.isArray(value) ? value : [];
  const [first, last] = pair;
  if (typeof first !== "number" || typeof last !== "number")
    throw new Error("lines is not [first, last]");
  return [first, last];
}

function expectedOf(raw: unknown): Expected {
  const fields = fieldsOf(raw, "a record");
  const scored = fields["scored"];
  if (typeof scored !== "boolean") throw new Error("scored is not a boolean");
  return {
    key: text(fields, "key"),
    kind: text(fields, "kind"),
    scored,
    own: number(fields, "own"),
    score: number(fields, "score"),
    lines: lines(fields),
  };
}

const listOf = (raw: unknown): Expected[] => (Array.isArray(raw) ? raw.map(expectedOf) : []);

function goldenOf(name: string): Golden {
  const dir = join(FIXTURES, name);
  const file = readdirSync(dir).find((entry) => entry.startsWith("input."));
  if (file === undefined) throw new Error(`${name} has no input file`);
  const raw: unknown = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"));
  const fields = fieldsOf(raw, `${name}/expected.json`);
  const without = fields["withoutDiscount"];
  return {
    name,
    file,
    text: readFileSync(join(dir, file), "utf8"),
    records: listOf(fields["records"]),
    withoutDiscount: without === undefined ? undefined : listOf(without),
    diagnostics: fields["diagnostics"] === "some" ? "some" : undefined,
  };
}

/** Every golden case under `fixtures/complexity/`, by directory name. */
export function goldens(): Golden[] {
  return readdirSync(FIXTURES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => goldenOf(entry.name));
}

export const shape = (found: FunctionRecord): Expected => ({
  key: found.key,
  kind: found.kind,
  scored: found.scored,
  own: found.own,
  score: found.score,
  lines: [found.span.startLine, found.span.endLine],
});

export const analyze = (path: string, source: string, nullishDiscount = true): Analysis =>
  analyzeFile(ts, path, source, { nullishDiscount });

/** The 1-based line of an offset, counting `\r\n`, `\n` and `\r` as one break each. */
export const lineOf = (source: string, offset: number): number =>
  source.slice(0, offset).split(/\r\n|[\n\r]/).length;
