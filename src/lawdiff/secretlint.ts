import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { PRESET, PROJECT_CONFIG } from "../laws/readers/secrets.ts";
import { isRecord, listOf, parseJsonc, reviewed, switched } from "./toolconfig.ts";
import type { Part, Ranked, ToolConfig, ToolSet } from "./types.ts";

/** Where the diff reads the W-39 scanner's config: what the W-39 reader reads (`.secretlintrc.json`, else the kit's preset). */
export const IGNORE_FILE = ".secretlintignore";

const severities = (): readonly string[] => ["info", "warning", "error"];

/** A rule's severity, `error` when it names none; a lower one is weaker. */
function severityOf(value: unknown): Ranked {
  const shown = typeof value === "string" ? value : "error";
  return { shown, rank: severities().indexOf(shown) };
}

/** What the scanner runs with when the project keeps no `.secretlintrc.json`: the recommended preset alone. */
const defaultConfig = (): unknown => ({ rules: [{ id: PRESET }] });

/** The scanner's config of a project that keeps none, with no ignore file. */
export const defaultSecretlint = (): ToolConfig => secretlintOf(defaultConfig());

const without = (
  record: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));

interface Found {
  readonly values: [string, Ranked][];
  readonly sets: ToolSet[];
}

/** One rule or preset of the config, under the name it has in its list. */
function ruleParts(key: string, rule: Record<string, unknown>): Found {
  const options = isRecord(rule["options"]) ? rule["options"] : {};
  const others = without(options, ["allows"]);
  const known = ["id", "options", "disabled", "allowMessageIds", "severity", "rules"];
  return {
    values: [
      [`rule ${key}`, switched(rule["disabled"] !== true, ["on", "disabled"])],
      [`severity ${key}`, severityOf(rule["severity"])],
      [`options ${key}`, reviewed(others)],
      [`other ${key}`, reviewed(without(rule, known))],
    ],
    sets: [
      { name: `allows ${key}`, loosens: "added", entries: listOf(options["allows"]) },
      {
        name: `allowMessageIds ${key}`,
        loosens: "added",
        entries: listOf(rule["allowMessageIds"]),
      },
    ],
  };
}

/** A name for each entry of a list: its id, and the id with its place when a list names it again. */
function nameIn(seen: Map<string, number>, prefix: string, id: string): string {
  const count = (seen.get(id) ?? 0) + 1;
  seen.set(id, count);
  return count === 1 ? `${prefix}${id}` : `${prefix}${id}#${String(count)}`;
}

/** What a rule nested in a preset is when the config does not name it: the preset's own, on, at error, with nothing set. */
export const nestedDefault = (key: string): Ranked | undefined =>
  key.includes(" > ")
    ? nestedDefaults().find(([prefix]) => key.startsWith(prefix))?.[1]
    : undefined;

const nestedDefaults = (): readonly (readonly [string, Ranked])[] => [
  ["rule ", { shown: "on", rank: 1 }],
  ["severity ", { shown: "error", rank: 2 }],
  ["options ", reviewed({})],
  ["other ", reviewed({})],
];

const none = (): Found => ({ values: [], sets: [] });

const merge = (found: readonly Found[]): Found => ({
  values: found.flatMap((one) => one.values),
  sets: found.flatMap((one) => one.sets),
});

const idOf = (rule: unknown): string | undefined =>
  isRecord(rule) && typeof rule["id"] === "string" ? rule["id"] : undefined;

function entryParts(rule: unknown, at: number, prefix: string, seen: Map<string, number>): Found {
  const id = idOf(rule);
  if (id === undefined || !isRecord(rule)) {
    return { values: [[`unreadable ${prefix}${String(at)}`, reviewed(rule)]], sets: [] };
  }
  const key = nameIn(seen, prefix, id);
  const inside = rule["rules"];
  return merge([
    ruleParts(key, rule),
    Array.isArray(inside) ? listParts(inside, `${key} > `) : none(),
  ]);
}

function listParts(rules: readonly unknown[], prefix: string): Found {
  const seen = new Map<string, number>();
  return merge(rules.map((rule, at) => entryParts(rule, at, prefix, seen)));
}

/** What a scanner config holds: each rule and preset on or disabled, its severity, allow lists and options; what it cannot read, for review. */
export function secretlintOf(config: unknown): ToolConfig {
  if (!isRecord(config) || !Array.isArray(config["rules"])) {
    return { values: new Map([["config", reviewed(config)]]), sets: [] };
  }
  const found = listParts(config["rules"], "");
  return {
    values: new Map([...found.values, ["other keys", reviewed(without(config, ["rules"]))]]),
    sets: found.sets,
  };
}

/** The patterns of one ignore file: a pattern that ignores more, and a `!` pattern that takes some back. */
function ignoreSets(files: readonly { readonly file: string; readonly text: string }[]): ToolSet[] {
  const lines = files.flatMap(({ file, text }) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => ({ file, line })),
  );
  const entries = (negated: boolean): string[] =>
    lines
      .filter(({ line }) => line.startsWith("!") === negated)
      .map(({ file, line }) => `${file}: ${line}`);
  return [
    { name: "secretlintignore", loosens: "added", entries: entries(false) },
    { name: "secretlintignore !", loosens: "removed", entries: entries(true) },
  ];
}

const failed = (message: string): Part<never> => ({ state: "error", message });

function textOf(path: string): { readonly text: string } | { readonly error: string } {
  try {
    return { text: readFileSync(path, "utf8") };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** The project's `.secretlintrc.json` the W-39 reader uses, none when it keeps none, or why it cannot be read. */
function configAt(dir: string): { readonly config?: unknown } | { readonly error: string } {
  if (!existsSync(join(dir, PROJECT_CONFIG))) return {};
  const read = textOf(join(dir, PROJECT_CONFIG));
  if ("error" in read) return { error: `${PROJECT_CONFIG}: ${read.error}` };
  const parsed = parseJsonc(PROJECT_CONFIG, read.text);
  return parsed.ok ? { config: parsed.value } : { error: `${PROJECT_CONFIG}: ${parsed.message}` };
}

type IgnoreTexts =
  | { readonly texts: readonly { readonly file: string; readonly text: string }[] }
  | { readonly error: string };

/** The text of each `.secretlintignore` the checkout tracks, or why one could not be read. */
function ignoreTexts(dir: string, files: readonly string[]): IgnoreTexts {
  const texts: { file: string; text: string }[] = [];
  for (const file of files) {
    const read = textOf(join(dir, file));
    if ("error" in read) return { error: `${file}: ${read.error}` };
    texts.push({ file, text: read.text });
  }
  return { texts };
}

/** The config and the ignore files of a project, or absent when it keeps neither. */
function partOf(
  config: unknown,
  files: readonly string[],
  texts: readonly { readonly file: string; readonly text: string }[],
): Part<ToolConfig> {
  if (config === undefined && files.length === 0) return { state: "absent" };
  const base = config === undefined ? defaultSecretlint() : secretlintOf(config);
  return {
    state: "ok",
    value: { values: base.values, sets: [...base.sets, ...ignoreSets(texts)] },
  };
}

/** The scanner's config and ignore files of a checkout, as the W-39 reader reads them; absent for a project that keeps neither. */
export function secretlintPart(dir: string, listed: readonly string[] | string): Part<ToolConfig> {
  if (typeof listed === "string") return failed(listed);
  const config = configAt(dir);
  const files = listed.filter((file) => basename(file) === IGNORE_FILE);
  const ignores = ignoreTexts(dir, files);
  if ("error" in config) return failed(config.error);
  if ("error" in ignores) return failed(ignores.error);
  return partOf(config.config, files, ignores.texts);
}
