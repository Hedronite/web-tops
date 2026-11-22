import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Loosens } from "./sets.ts";
import { isRecord, listOf, parseJsonc, reviewed, switched } from "./toolconfig.ts";
import type { Part, Ranked, ToolConfig, ToolSet } from "./types.ts";

/** The files knip looks for in a project's root, in its own order; the first it finds is the one it reads. */
export function configNames(): readonly string[] {
  return [
    "knip.json",
    "knip.jsonc",
    ".knip.json",
    ".knip.jsonc",
    "knip.ts",
    "knip.js",
    "knip.config.ts",
    "knip.config.js",
  ];
}

/** Lists that hold files, packages or issue types out of the report (an added entry is weaker), or into it (a removed one is). */
function listKeys(): readonly (readonly [string, Loosens])[] {
  return [
    ["entry", "added"],
    ["project", "removed"],
    ["ignore", "added"],
    ["ignoreFiles", "added"],
    ["ignoreBinaries", "added"],
    ["ignoreGlobalBinaries", "added"],
    ["ignoreDependencies", "added"],
    ["ignoreMembers", "added"],
    ["ignoreUnresolved", "added"],
    ["ignoreWorkspaces", "added"],
    ["include", "removed"],
    ["exclude", "added"],
  ];
}

/** Switches that report more when on. */
const switchKeys = (): readonly string[] => [
  "includeEntryExports",
  "includeSubpathExports",
  "treatConfigHintsAsErrors",
  "treatTagHintsAsErrors",
];

/** Keys that hold something for a person to read, with no better or worse. */
const reviewKeys = (): readonly string[] => [
  "tags",
  "paths",
  "preprocessor",
  "preprocessorOptions",
];

/** What `ignoreExportsUsedInFile` can name: `true` names them all. */
const exportKinds = (): readonly string[] => [
  "class",
  "enum",
  "function",
  "interface",
  "member",
  "type",
  "variable",
];

/** The issue types a rule level can be set for. */
const issueTypes = (): readonly string[] => [
  "binaries",
  "catalog",
  "catalogReferences",
  "cycles",
  "dependencies",
  "devDependencies",
  "duplicates",
  "enumMembers",
  "exports",
  "files",
  "namespaceMembers",
  "nsExports",
  "nsTypes",
  "optionalPeerDependencies",
  "subpaths",
  "types",
  "unlisted",
  "unresolved",
];

const levels = (): readonly string[] => ["off", "warn", "error"];

/** A rule's level, `error` when the config sets none: a lower one reports less. */
function levelOf(value: unknown): Ranked {
  const shown = typeof value === "string" ? value : "error";
  return { shown, rank: levels().indexOf(shown) };
}

interface Found {
  readonly values: [string, Ranked][];
  readonly sets: ToolSet[];
}

const handled = (): readonly string[] => [
  ...listKeys().map(([key]) => key),
  ...switchKeys(),
  ...reviewKeys(),
  "ignoreExportsUsedInFile",
  "ignoreIssues",
  "cycles",
  "rules",
  "workspaces",
  "$schema",
];

const without = (
  record: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));

function listSets(scope: string, config: Record<string, unknown>): ToolSet[] {
  return listKeys().flatMap(([key, loosens]) =>
    key in config ? [{ name: `${scope}${key}`, loosens, entries: listOf(config[key]) }] : [],
  );
}

/** `ignoreIssues` maps a file pattern to the issue types it holds out: one entry for each pair. */
function issueSet(scope: string, value: unknown): ToolSet[] {
  const pairs = isRecord(value)
    ? Object.entries(value).flatMap(([pattern, types]) =>
        listOf(types).map((type) => `${pattern}: ${type}`),
      )
    : [];
  return [{ name: `${scope}ignoreIssues`, loosens: "added", entries: pairs }];
}

/** The exports a file's own use does not count, each reported or ignored. */
function usedInFile(scope: string, value: unknown): [string, Ranked][] {
  return exportKinds().map((kind): [string, Ranked] => {
    const ignored = value === true || (isRecord(value) && value[kind] === true);
    return [`${scope}ignoreExportsUsedInFile ${kind}`, switched(!ignored, ["reported", "ignored"])];
  });
}

/** The level of each issue type; a type the config does not set is `error`. */
function ruleValues(value: unknown): [string, Ranked][] {
  const set = isRecord(value) ? value : {};
  const types = new Set([...issueTypes(), ...Object.keys(set)]);
  return [...types].map((type): [string, Ranked] => [`rules ${type}`, levelOf(set[type])]);
}

/** Cycles knip accepts: each is a path, and an added one is weaker; the rest of the setting is for review. */
function cycleParts(scope: string, value: unknown): Found {
  const set = isRecord(value) ? value : {};
  return {
    values: [[`${scope}cycles`, reviewed(without(set, ["allow"]))]],
    sets: [
      {
        name: `${scope}cycles allow`,
        loosens: "added",
        entries: Array.isArray(set["allow"])
          ? set["allow"].map((cycle: unknown) => JSON.stringify(cycle))
          : [],
      },
    ],
  };
}

/** A plugin's setting: off holds less; its lists (`entry`, `project`) as lists; what else it says, for review. */
function pluginParts(scope: string, key: string, value: unknown): Found {
  if (typeof value === "boolean") {
    return { values: [[`${scope}plugin ${key}`, switched(value, ["on", "off"])]], sets: [] };
  }
  if (!isRecord(value)) return { values: [[`${scope}plugin ${key}`, reviewed(value)]], sets: [] };
  return {
    values: [
      [
        `${scope}plugin ${key}`,
        reviewed(
          without(
            value,
            listKeys().map(([name]) => name),
          ),
        ),
      ],
    ],
    sets: listSets(`${scope}${key} `, value),
  };
}

function scopeParts(scope: string, config: Record<string, unknown>): Found {
  const cycles = cycleParts(scope, config["cycles"]);
  const plugins = Object.entries(without(config, handled())).map(([key, value]) =>
    pluginParts(scope, key, value),
  );
  return {
    values: [
      ...switchKeys().map((key): [string, Ranked] => [
        `${scope}${key}`,
        switched(config[key] === true, ["on", "off"]),
      ]),
      ...reviewKeys().map((key): [string, Ranked] => [`${scope}${key}`, reviewed(config[key])]),
      ...usedInFile(scope, config["ignoreExportsUsedInFile"]),
      ...(scope === "" ? ruleValues(config["rules"]) : []),
      ...cycles.values,
      ...plugins.flatMap((one) => one.values),
    ],
    sets: [
      ...listSets(scope, config),
      ...issueSet(scope, config["ignoreIssues"]),
      ...cycles.sets,
      ...plugins.flatMap((one) => one.sets),
    ],
  };
}

function workspaceParts(config: Record<string, unknown>): Found {
  const spaces = isRecord(config["workspaces"]) ? Object.entries(config["workspaces"]) : [];
  const found = spaces.map(([name, space]): Found => {
    const scope = `workspace ${name}: `;
    return isRecord(space)
      ? scopeParts(scope, space)
      : { values: [[`workspace ${name}`, reviewed(space)]], sets: [] };
  });
  return {
    values: found.flatMap((one) => one.values),
    sets: found.flatMap((one) => one.sets),
  };
}

/** What knip runs with when the project keeps no config. */
export const defaultKnip = (): ToolConfig => knipOf({});

/** What a knip config holds, the root's and each workspace's: ignores, entries, projects, rule levels, plugins. */
export function knipOf(
  config: Record<string, unknown>,
  code?: { readonly name: string; readonly hash: string },
): ToolConfig {
  const root = scopeParts("", config);
  const spaces = workspaceParts(config);
  const file: [string, Ranked][] =
    code === undefined
      ? []
      : [["config file", { shown: `${code.name} ${code.hash}`, rank: 0, review: true }]];
  return {
    values: new Map([...root.values, ...spaces.values, ...file]),
    sets: [...root.sets, ...spaces.sets],
  };
}

const failed = (message: string): Part<never> => ({ state: "error", message });

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const knipKey = (manifest: unknown): Record<string, unknown> => {
  const knip = isRecord(manifest) ? manifest["knip"] : undefined;
  return isRecord(knip) ? knip : {};
};

/** The `knip` key of `package.json`, which knip merges under the file's keys. */
function manifestKnip(
  dir: string,
): { readonly knip: Record<string, unknown> } | { readonly error: string } {
  const path = join(dir, "package.json");
  try {
    return { knip: existsSync(path) ? knipKey(JSON.parse(readFileSync(path, "utf8"))) : {} };
  } catch (error) {
    return { error: `package.json: ${reasonOf(error)}` };
  }
}

const isCode = (name: string): boolean => /\.[jt]s$/u.test(name);

const hashOf = (text: string): string =>
  `sha1:${createHash("sha1").update(text).digest("hex").slice(0, 12)}`;

type FileConfig =
  | { readonly kind: "data"; readonly config: Record<string, unknown> }
  | { readonly kind: "code"; readonly name: string; readonly hash: string }
  | { readonly kind: "error"; readonly message: string };

/** A data config file's object, or why it cannot be read. */
function dataConfig(name: string, text: string): FileConfig {
  const parsed = parseJsonc(name, text);
  return parsed.ok
    ? { kind: "data", config: parsed.value }
    : { kind: "error", message: `${name}: ${parsed.message}` };
}

/** The config file knip reads: data it can say, code it can only hash, or why it cannot be read. */
function fileConfig(dir: string, name: string): FileConfig {
  try {
    const text = readFileSync(join(dir, name), "utf8");
    return isCode(name) ? { kind: "code", name, hash: hashOf(text) } : dataConfig(name, text);
  } catch (error) {
    return { kind: "error", message: `${name}: ${reasonOf(error)}` };
  }
}

/** The file's keys over the manifest's, as knip merges them; a code file is only hashed. */
function withFile(manifest: Record<string, unknown>, file: FileConfig): ToolConfigRead {
  if (file.kind === "error") return { error: file.message };
  return file.kind === "data"
    ? { config: { ...manifest, ...file.config } }
    : { config: manifest, code: file };
}

/** What knip merges in a checkout: the `knip` key of `package.json` under the first config file knip finds. */
function mergedConfig(dir: string): ToolConfigRead | undefined {
  const manifest = manifestKnip(dir);
  if ("error" in manifest) return { error: manifest.error };
  const name = configNames().find((file) => existsSync(join(dir, file)));
  if (name !== undefined) return withFile(manifest.knip, fileConfig(dir, name));
  return Object.keys(manifest.knip).length === 0 ? undefined : { config: manifest.knip };
}

interface ToolConfigRead {
  readonly config?: Record<string, unknown>;
  readonly code?: { readonly name: string; readonly hash: string };
  readonly error?: string;
}

/** knip's config in a checkout, as knip merges it; absent for a project with none, which runs on knip's defaults. */
export function knipPart(dir: string): Part<ToolConfig> {
  const read = mergedConfig(dir);
  if (read === undefined) return { state: "absent" };
  if (read.error !== undefined) return failed(read.error);
  return { state: "ok", value: knipOf(read.config ?? {}, read.code) };
}
