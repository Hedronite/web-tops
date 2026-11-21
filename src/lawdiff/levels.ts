import { changeOf } from "./rank.ts";
import type { Change, Item, Ranked, RuleSetting, Rules } from "./types.ts";

function names(): readonly string[] {
  return ["off", "warn", "error"];
}

const nameOf = (level: number): string => String(names()[level] ?? level);

/** A setting as it is shown: its level, and its options when it has any. */
const labelOf = (setting: RuleSetting): string =>
  setting.options === "[]" ? nameOf(setting.level) : `${nameOf(setting.level)} ${setting.options}`;

const levelRank = (level: number): Ranked => ({ shown: nameOf(level), rank: level });

/** A rule a file does not set is off. */
const off = (): RuleSetting => ({ level: 0, options: "[]" });

/** The rules whose option is a ceiling: a higher number is a looser rule. */
function ceilings(): readonly string[] {
  return [
    "complexity",
    "max-lines",
    "max-depth",
    "max-params",
    "max-statements",
    "max-nested-callbacks",
  ];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parsed(options: string): unknown {
  try {
    return JSON.parse(options);
  } catch {
    return undefined;
  }
}

const firstOf = (options: string): unknown => {
  const list = parsed(options);
  const first: unknown = Array.isArray(list) ? list[0] : undefined;
  return first;
};

const maxOf = (value: unknown): number | undefined =>
  isRecord(value) && typeof value["max"] === "number" ? value["max"] : undefined;

/** The number a ceiling rule allows: its first option, or the `max` of it. */
function ceilingOf(options: string): number | undefined {
  const first = firstOf(options);
  return typeof first === "number" ? first : maxOf(first);
}

const grew = (was: number | undefined, now: number | undefined): boolean =>
  was !== undefined && now !== undefined && now > was;

const raised = (rule: string, before: string, after: string): boolean =>
  ceilings().includes(rule) && grew(ceilingOf(before), ceilingOf(after));

/** The options of a rule that is on: a ceiling that rose is weaker, any other difference is for a person to review. */
function optionsChange(rule: string, before: RuleSetting, after: RuleSetting): Change {
  if (before.options === after.options || before.level === 0) return "unchanged";
  return raised(rule, before.options, after.options) ? "weakened" : "changed";
}

function moveOf(rule: string, before: RuleSetting, after: RuleSetting): Change {
  const level = changeOf(levelRank(before.level), levelRank(after.level));
  return level === "unchanged" ? optionsChange(rule, before, after) : level;
}

interface Moved {
  readonly files: string[];
  readonly before: string;
  readonly after: string;
}

type Table = Map<string, Moved>;

type Tables = ReadonlyMap<Change, Table>;

/** The table of a change that is listed, or an empty one for a change that is not. */
const tableOf = (tables: Tables, change: Change): Table =>
  tables.get(change) ?? new Map<string, Moved>();

/** A file of the head, and the file of the base it came from: itself, or the path it was renamed from. */
export type Renames = ReadonlyMap<string, string>;

type Settings = ReadonlyMap<string, RuleSetting>;

function note(table: Table, rule: string, file: string, before: string, after: string): void {
  const found = table.get(rule);
  if (found === undefined) {
    table.set(rule, { files: [file], before, after });
  } else {
    found.files.push(file);
  }
}

function moveAt(rule: string, base: Settings, head: Settings): [RuleSetting, RuleSetting, Change] {
  const before = base.get(rule) ?? off();
  const after = head.get(rule) ?? off();
  return [before, after, moveOf(rule, before, after)];
}

function sortFile(file: string, base: Settings, head: Settings, tables: Tables): void {
  for (const rule of new Set([...base.keys(), ...head.keys()])) {
    const [before, after, change] = moveAt(rule, base, head);
    const table = tables.get(change);
    if (table !== undefined) note(table, rule, file, labelOf(before), labelOf(after));
  }
}

/** The settings the base had for a file of the head: its own, or those of the path it was renamed from. */
const baseOf = (base: Rules, file: string, renames: Renames): Settings | undefined =>
  base.get(renames.get(file) ?? file);

/** A file the head tracks that ESLint no longer reaches: every rule the base held on for it is weaker. */
function dropFile(file: string, before: Settings, tables: Tables): void {
  for (const [rule, setting] of before) {
    if (setting.level > 0)
      note(tableOf(tables, "weakened"), rule, file, labelOf(setting), "no longer linted");
  }
}

/**
 * For each rule, the files where it fell, rose or changed, among the files of the head the base has settings for. A
 * file the head tracks and ESLint no longer reaches (an ignore, a narrower `files`) is weaker; a file the head no
 * longer has is not compared.
 */
function sorted(base: Rules, head: Rules, renames: Renames, tracked: readonly string[]): Tables {
  const tables: Tables = new Map([
    ["weakened", new Map()],
    ["strengthened", new Map()],
    ["changed", new Map()],
  ]);
  for (const file of new Set([...head.keys(), ...tracked])) {
    const before = baseOf(base, file, renames);
    const after = head.get(file);
    if (before === undefined) continue;
    if (after === undefined) dropFile(file, before, tables);
    else sortFile(file, before, after, tables);
  }
  return tables;
}

const where = (files: readonly string[]): string =>
  files.length === 1
    ? String(files[0])
    : `${String(files[0])} and ${String(files.length - 1)} more`;

function itemsOf(table: Table, change: Change): Item[] {
  return [...table].sort().map(([what, moved]) => ({
    what,
    change,
    before: moved.before,
    after: moved.after,
    where: where(moved.files),
  }));
}

/**
 * The rules whose effective level or options moved, for every file of the head. The base is asked about the head's
 * files as well as its own, so a file the PR adds is held to what the base's config said of its path, and a renamed
 * file to what the base said of the path it came from.
 */
export function compareLevels(
  base: Rules,
  head: Rules,
  renames: Renames,
  tracked: readonly string[],
): Item[] {
  const tables = sorted(base, head, renames, tracked);
  return [
    ...itemsOf(tableOf(tables, "weakened"), "weakened"),
    ...itemsOf(tableOf(tables, "strengthened"), "strengthened"),
    ...itemsOf(tableOf(tables, "changed"), "changed"),
  ];
}

/** The head files the base has settings for: what was compared. */
function reached(base: Rules, head: Rules, renames: Renames, tracked: readonly string[]): string[] {
  return [...new Set([...head.keys(), ...tracked])].filter(
    (file) => baseOf(base, file, renames) !== undefined,
  );
}

const keysOf = (settings: Settings | undefined): string[] => [...(settings?.keys() ?? [])];

const rulesOfFile = (base: Rules, head: Rules, file: string, renames: Renames): string[] => [
  ...keysOf(baseOf(base, file, renames)),
  ...keysOf(head.get(file)),
];

/** How many files and how many distinct rules were compared. */
export function comparedOf(
  base: Rules,
  head: Rules,
  renames: Renames,
  tracked: readonly string[],
): { readonly files: number; readonly rules: number } {
  const files = reached(base, head, renames, tracked);
  const rules = new Set(files.flatMap((file) => rulesOfFile(base, head, file, renames)));
  return { files: files.length, rules: rules.size };
}
