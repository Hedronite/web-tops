import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Runner } from "../census/eslint.ts";
import type { Cruise, Ranked } from "./types.ts";

/** How long the tool may take to answer: five minutes. */
const timeoutMs = (): number => 5 * 60 * 1000;

/** The config files dependency-cruiser looks for in a project's root, in its own order. */
export function configNames(): readonly string[] {
  return [
    ".dependency-cruiser.json",
    ".dependency-cruiser.cjs",
    ".dependency-cruiser.js",
    ".dependency-cruiser.mjs",
  ];
}

/**
 * Run under Node from the checkout: dependency-cruiser's own loader reads the config file the way `depcruise` does,
 * `extends` included, and the whole config is printed as JSON.
 */
function script(): string {
  return `
const { default: extract } = await import("dependency-cruiser/config-utl/extract-depcruise-config");
process.stdout.write(JSON.stringify(await extract(process.env.WEBTOPS_LAWDIFF_CONFIG)));
`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** How hard a severity holds: ignore, info, warn, error, with `warn` for a rule that names none. */
function severities(): readonly string[] {
  return ["ignore", "info", "warn", "error"];
}

const severityRank = (severity: unknown): Ranked => {
  const shown = typeof severity === "string" ? severity : "warn";
  return { shown, rank: severities().indexOf(shown) };
};

/** A rule's definition: everything but its name, severity and comment, as JSON. */
function definitionOf(rule: Record<string, unknown>): string {
  const own = Object.entries(rule).filter(
    ([key]) => !["name", "severity", "comment"].includes(key),
  );
  return JSON.stringify(Object.fromEntries(own));
}

function ruleEntries(kind: string, rules: unknown): [string, Ranked][] {
  if (!Array.isArray(rules)) return [];
  return rules.flatMap((rule: unknown): [string, Ranked][] => {
    if (!isRecord(rule) || typeof rule["name"] !== "string") return [];
    const key = `${kind}: ${rule["name"]}`;
    return [
      [key, severityRank(rule["severity"])],
      [`${key} definition`, { shown: definitionOf(rule), rank: 0, review: true }],
    ];
  });
}

/** The entries with no name, kept as they are: dropping one drops a rule nothing else names. */
function unnamed(kind: string, rules: unknown): string[] {
  if (!Array.isArray(rules)) return [];
  return rules.flatMap((rule: unknown): string[] =>
    isRecord(rule) && typeof rule["name"] !== "string" ? [`${kind}: ${JSON.stringify(rule)}`] : [],
  );
}

const pathsOf = (path: unknown): string[] =>
  Array.isArray(path)
    ? path.flatMap((entry: unknown) => (typeof entry === "string" ? [entry] : []))
    : [];

/** The paths of an `exclude` or `doNotFollow` option: a pattern, a list, or an object with a `path`. */
function patternsOf(option: unknown): string[] {
  if (typeof option === "string") return [option];
  if (!isRecord(option)) return [];
  const path = option["path"];
  return typeof path === "string" ? [path] : pathsOf(path);
}

function optionsOf(config: Record<string, unknown>, name: string): string[] {
  const options = config["options"];
  return isRecord(options) ? patternsOf(options[name]).map((path) => `${name}: ${path}`) : [];
}

/** What a dependency-cruiser config holds: each named rule's severity and definition, the allowed set, and what it leaves out. */
export function cruiseOf(config: unknown): Cruise | undefined {
  if (!isRecord(config)) return undefined;
  return {
    values: new Map<string, Ranked>([
      ...ruleEntries("forbidden", config["forbidden"]),
      ...ruleEntries("required", config["required"]),
      ["allowedSeverity", severityRank(config["allowedSeverity"])],
    ]),
    allowed: [
      ...(Array.isArray(config["allowed"])
        ? config["allowed"].map((rule: unknown) => JSON.stringify(rule))
        : []),
      ...unnamed("forbidden", config["forbidden"]),
      ...unnamed("required", config["required"]),
    ],
    excluded: [...optionsOf(config, "exclude"), ...optionsOf(config, "doNotFollow")],
  };
}

export type CruiseRead =
  { readonly ok: true; readonly value: Cruise } | { readonly ok: false; readonly message: string };

function problem(result: { code: number | null; stderr: string; failure?: string }): string {
  const why =
    result.failure ??
    `exit ${String(result.code)}: ${result.stderr.trim().split("\n").slice(-3).join(" ")}`;
  return `dependency-cruiser's config could not be read (${why})`;
}

/** Reads the config file at `path` with the checkout's own dependency-cruiser. */
export async function askCruise(runner: Runner, path: string): Promise<CruiseRead> {
  const folder = join(runner.outDir, "lawdiff");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "cruise.mjs"), script());
  const result = await runner.exec("node", [join(folder, "cruise.mjs")], {
    cwd: runner.cwd,
    env: { ...runner.env, WEBTOPS_LAWDIFF_CONFIG: join(runner.cwd, path) },
    timeoutMs: timeoutMs(),
  });
  if (result.failure !== undefined || result.code !== 0)
    return { ok: false, message: problem(result) };
  const value = cruiseOf(parsed(result.stdout));
  return value === undefined
    ? { ok: false, message: "dependency-cruiser printed something that is not a config" }
    : { ok: true, value };
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
