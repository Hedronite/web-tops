import ts from "typescript";
import { compareRanked, type Outcome } from "./rank.ts";
import { compareSets } from "./sets.ts";
import type { Item, Ranked, ToolConfig, ToolSet } from "./types.ts";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The strings of a list, or of one string: a config says an entry or a list of them. */
export function listOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.map((entry: unknown) => (typeof entry === "string" ? entry : JSON.stringify(entry)));
}

/** A value as a record: itself when it is one, else an empty one. */
export const recordOf = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

export type Parsed =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly message: string };

/** The object a JSON file that may hold comments holds, as a config file may; a root that is not an object is an error. */
export function parseJsonc(name: string, text: string): Parsed {
  const read = ts.parseConfigFileTextToJson(name, text);
  return read.error === undefined
    ? { ok: true, value: recordOf(read.config) }
    : {
        ok: false,
        message: ts.flattenDiagnosticMessageText(read.error.messageText, ts.sys.newLine),
      };
}

/** A value for a person to review, whatever it is: it has no better or worse, so a change is listed as `changed`. */
export const reviewed = (value: unknown): Ranked => ({
  shown: JSON.stringify(value ?? null),
  rank: 0,
  review: true,
});

/** A switch: on holds more than off. */
export const switched = (on: boolean, label: [string, string]): Ranked => ({
  shown: on ? label[0] : label[1],
  rank: on ? 1 : 0,
});

const setsMoved = (base: readonly ToolSet[], head: readonly ToolSet[]): Item[] => {
  const loosens = new Map([...base, ...head].map((set) => [set.name, set.loosens] as const));
  const entriesOf = (sets: readonly ToolSet[], name: string): string[] =>
    sets.filter((set) => set.name === name).flatMap((set) => [...set.entries]);
  return [...loosens]
    .sort()
    .flatMap(([name, way]) => compareSets(name, entriesOf(base, name), entriesOf(head, name), way));
};

const entriesIn = (config: ToolConfig): Set<string> =>
  new Set(config.sets.flatMap((set) => set.entries.map((entry) => `${set.name}\0${entry}`)));

/** What a value is when a config does not name it, if it is anything: the default the other config's name stands against. */
export type Fallback = (key: string) => Ranked | undefined;

/** The values of one config, and for each name only the other has, what the config's own default says it is. */
function completed(own: ToolConfig, other: ToolConfig, fallback: Fallback): Map<string, Ranked> {
  const missing = [...other.values.keys()].filter((key) => !own.values.has(key));
  return new Map([
    ...own.values,
    ...missing.flatMap((key): [string, Ranked][] => {
      const given = fallback(key);
      return given === undefined ? [] : [[key, given]];
    }),
  ]);
}

/** What moved in a tool's config: its values by rank, and each of its lists by the way it loosens. */
export function compareToolConfig(
  base: ToolConfig,
  head: ToolConfig,
  fallback: Fallback = () => undefined,
): Outcome {
  const names = new Set([...base.values.keys(), ...head.values.keys()]);
  return {
    items: [
      ...compareRanked(completed(base, head, fallback), completed(head, base, fallback)),
      ...setsMoved(base.sets, head.sets),
    ],
    compared: names.size + new Set([...entriesIn(base), ...entriesIn(head)]).size,
  };
}
