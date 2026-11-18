import { readFileSync } from "node:fs";
import type { SurvivorKey } from "./key.ts";

export type ReportSurvivors =
  | { readonly ok: true; readonly survivors: readonly SurvivorKey[] }
  | { readonly ok: false; readonly absent: boolean; readonly message: string };

const read = (from: unknown, key: string): unknown =>
  typeof from === "object" && from !== null ? Reflect.get(from, key) : undefined;

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const textOf = (from: unknown, key: string): string | undefined => {
  const value = read(from, key);
  return typeof value === "string" ? value : undefined;
};

const or = (value: string | undefined): string => value ?? "";

/** The six key fields of a finding's `survivor` object, or undefined when it has none or one is wrong. */
function keyOf(survivor: unknown): SurvivorKey | undefined {
  const parts = ["file", "function", "mutator", "original", "replacement"].map((name) =>
    textOf(survivor, name),
  );
  const occurrence = read(survivor, "occurrence");
  if (parts.includes(undefined) || typeof occurrence !== "number") return undefined;
  const [file, fn, mutator, original, replacement] = parts;
  return {
    file: or(file),
    function: or(fn),
    mutator: or(mutator),
    original: or(original),
    replacement: or(replacement),
    occurrence,
  };
}

/** The `survivor` objects on the findings of the mutation layer of a parsed gate report. */
function survivorsIn(report: unknown): SurvivorKey[] {
  const layers = listOf(read(report, "layers")).filter((layer) => read(layer, "id") === "mutation");
  const found = layers.flatMap((layer) => listOf(read(layer, "findings")));
  return found.flatMap((finding) => {
    const key = keyOf(read(finding, "survivor"));
    return key === undefined ? [] : [key];
  });
}

/**
 * The survivors the last gate report names: the findings of its `mutation` layer that carry a `survivor`
 * object with the six key fields (report_version 2.1.0). A missing report is `absent`.
 */
export function readReportSurvivors(path: string): ReportSurvivors {
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    return { ok: false, absent: true, message: `no report at ${path}; run webtops gate first` };
  }
  try {
    const parsed: unknown = JSON.parse(source);
    return { ok: true, survivors: survivorsIn(parsed) };
  } catch {
    return { ok: false, absent: false, message: `${path} is not valid JSON` };
  }
}
