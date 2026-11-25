import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { MutationMetric } from "../../config/report.ts";
import type { RawFinding } from "../../report/findings.ts";
import { keyString } from "../../survivors/key.ts";
import { failFinding } from "../hygiene/tooling.ts";
import { zeroCounts, type PartialMutation } from "./partial.ts";
import type { MutationRead, SurvivorRow } from "./read.ts";

export type JoinedMutation =
  | { readonly finding: RawFinding }
  | {
      readonly timedOutReason: string;
      readonly unknown: readonly string[];
      readonly counts: MutationMetric;
    }
  | {
      readonly read: MutationRead;
      readonly shardStarved: boolean;
      readonly starvedReason: string;
    };

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonNegInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const isPosInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

const hasStrings = (raw: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean =>
  keys.every((key) => typeof raw[key] === "string");

const hasBooleans = (raw: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean =>
  keys.every((key) => typeof raw[key] === "boolean");

function joinFail(rule: string, message: string, file?: string): RawFinding {
  return failFinding("webtops", rule, message, file === undefined ? {} : { file });
}

function fromEntry(
  dir: string,
  entry: { readonly name: string; isDirectory: () => boolean; isFile: () => boolean },
): string[] {
  const full = join(dir, entry.name);
  if (entry.isDirectory()) {
    return collectJsonFiles(full);
  }
  return entry.isFile() && entry.name.endsWith(".json") ? [full] : [];
}

function collectJsonFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => fromEntry(dir, entry))
    .sort();
}

function listPartialFiles(
  joinDir: string,
): { readonly files: string[] } | { readonly finding: RawFinding } {
  try {
    if (!statSync(joinDir).isDirectory()) {
      return { finding: joinFail("join-missing", `${joinDir} is not a directory`) };
    }
  } catch {
    return { finding: joinFail("join-missing", `${joinDir} could not be read`) };
  }
  const files = collectJsonFiles(joinDir);
  return files.length === 0
    ? { finding: joinFail("join-empty", `no partial mutation artifacts found in ${joinDir}`) }
    : { files };
}

function hasCounts(value: unknown): value is MutationMetric {
  if (!isRecord(value)) return false;
  const keys = [
    "killed",
    "timeout",
    "survived",
    "no_coverage",
    "runtime_error",
    "compile_error",
    "ignored",
  ];
  return keys.every((key) => isNonNegInt(value[key]));
}

function isSurvivorKey(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasStrings(value, ["file", "function", "mutator", "original", "replacement"]) &&
    isPosInt(value["occurrence"])
  );
}

function isSurvivorRow(value: unknown): value is SurvivorRow {
  return (
    isRecord(value) &&
    hasStrings(value, ["status", "file"]) &&
    isPosInt(value["line"]) &&
    isSurvivorKey(value["key"])
  );
}

function validShardPair(shard: unknown, shards: unknown): boolean {
  return isPosInt(shard) && isPosInt(shards) && shard <= shards;
}

function hasValidHeader(raw: Readonly<Record<string, unknown>>): boolean {
  return (
    raw["version"] === 1 &&
    validShardPair(raw["shard"], raw["shards"]) &&
    isNonEmptyString(raw["base"]) &&
    isNonEmptyString(raw["entriesHash"])
  );
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function hasValidSurvivors(value: unknown): boolean {
  return Array.isArray(value) && value.every(isSurvivorRow);
}

function hasValidBody(raw: Readonly<Record<string, unknown>>): boolean {
  return [
    hasCounts(raw["counts"]),
    hasValidSurvivors(raw["survivors"]),
    isNonNegInt(raw["excluded"]),
    isStringArray(raw["unknown"]),
    hasBooleans(raw, ["timedOut", "starved", "vacuous"]),
  ].every(Boolean);
}

function isPartialMutation(value: unknown): value is PartialMutation {
  return isRecord(value) && hasValidHeader(value) && hasValidBody(value);
}

function parsePartialFile(
  file: string,
): { readonly partial: PartialMutation } | { readonly finding: RawFinding } {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return isPartialMutation(parsed)
      ? { partial: parsed }
      : {
          finding: joinFail(
            "join-invalid",
            `${file} is not a valid partial mutation artifact`,
            file,
          ),
        };
  } catch {
    return { finding: joinFail("join-unparseable", `${file} is not valid JSON`, file) };
  }
}

function loadAllPartials(
  files: readonly string[],
): { readonly partials: PartialMutation[] } | { readonly finding: RawFinding } {
  const partials: PartialMutation[] = [];
  for (const file of files) {
    const loaded = parsePartialFile(file);
    if ("finding" in loaded) {
      return loaded;
    }
    partials.push(loaded.partial);
  }
  return { partials };
}

function pairMismatch(first: PartialMutation, item: PartialMutation): RawFinding | undefined {
  const tag = `shard ${String(item.shard)}/${String(item.shards)}`;
  if (item.shards !== first.shards) {
    return joinFail("join-mismatch", `${tag} disagrees with shard count ${String(first.shards)}`);
  }
  if (item.base !== first.base) {
    return joinFail("join-mismatch", `${tag} has base ${item.base}, expected ${first.base}`);
  }
  return item.entriesHash === first.entriesHash
    ? undefined
    : joinFail("join-mismatch", `${tag} has mismatched entriesHash`);
}

function checkMetadata(
  first: PartialMutation,
  rest: readonly PartialMutation[],
): RawFinding | undefined {
  for (const item of rest) {
    const mismatch = pairMismatch(first, item);
    if (mismatch !== undefined) {
      return mismatch;
    }
  }
  return undefined;
}

function findMissingShard(seen: ReadonlySet<number>, total: number): RawFinding | undefined {
  for (let index = 1; index <= total; index += 1) {
    if (!seen.has(index)) {
      return joinFail("join-missing-shard", `missing shard ${String(index)}/${String(total)}`);
    }
  }
  return undefined;
}

function checkCompleteness(
  partials: readonly PartialMutation[],
  total: number,
): RawFinding | undefined {
  const seen = new Set<number>();
  for (const item of partials) {
    if (seen.has(item.shard)) {
      return joinFail("join-duplicate", `duplicate shard ${String(item.shard)}/${String(total)}`);
    }
    seen.add(item.shard);
  }
  return findMissingShard(seen, total);
}

function validatePartials(
  first: PartialMutation,
  rest: readonly PartialMutation[],
): RawFinding | undefined {
  return checkMetadata(first, rest) ?? checkCompleteness([first, ...rest], first.shards);
}

function addCounts(acc: Record<keyof MutationMetric, number>, next: MutationMetric): void {
  acc.killed += next.killed;
  acc.timeout += next.timeout;
  acc.survived += next.survived;
  acc.no_coverage += next.no_coverage;
  acc.runtime_error += next.runtime_error;
  acc.compile_error += next.compile_error;
  acc.ignored += next.ignored;
}

function sumCounts(partials: readonly PartialMutation[]): MutationMetric {
  const total: Record<keyof MutationMetric, number> = { ...zeroCounts() };
  for (const item of partials) {
    addCounts(total, item.counts);
  }
  return total;
}

function addSurvivor(byKey: Map<string, SurvivorRow>, row: SurvivorRow): void {
  const key = keyString(row.key);
  if (!byKey.has(key)) {
    byKey.set(key, row);
  }
}

function unionSurvivors(partials: readonly PartialMutation[]): SurvivorRow[] {
  const byKey = new Map<string, SurvivorRow>();
  for (const item of partials) {
    for (const row of item.survivors) {
      addSurvivor(byKey, row);
    }
  }
  return [...byKey.values()];
}

function unionUnknown(partials: readonly PartialMutation[]): string[] {
  return [...new Set(partials.flatMap((item) => item.unknown))];
}

function aggregate(partials: readonly PartialMutation[]): JoinedMutation {
  const sorted = [...partials].sort((a, b) => a.shard - b.shard);
  const counts = sumCounts(sorted);
  const unknown = unionUnknown(sorted);
  const timedOut = sorted.filter((item) => item.timedOut);
  if (timedOut.length > 0) {
    const names = timedOut.map((item) => `${String(item.shard)}/${String(item.shards)}`).join(", ");
    return {
      timedOutReason: `shard ${names} timed out at the mutation time budget; a run cut short is never a pass`,
      unknown,
      counts,
    };
  }
  const starved = sorted.filter((item) => item.starved);
  const shardStarved = starved.length > 0;
  const starvedNames = starved
    .map((item) => `${String(item.shard)}/${String(item.shards)}`)
    .join(", ");
  return {
    read: {
      killed: counts.killed + counts.timeout,
      survivors: unionSurvivors(sorted),
      excluded: sorted.reduce((sum, item) => sum + item.excluded, 0),
      unknown,
      counts,
    },
    shardStarved,
    starvedReason: shardStarved ? `shard ${starvedNames} timed out too many mutants (starved)` : "",
  };
}

function finalizePartials(partials: readonly PartialMutation[]): JoinedMutation {
  const [first, ...rest] = partials;
  const problem = first === undefined ? undefined : validatePartials(first, rest);
  return problem === undefined ? aggregate(partials) : { finding: problem };
}

/** Reads, validates, and merges all shard partial artifacts in `joinDir`, failing closed on any mismatch or gap. */
export function loadJoined(joinDir: string): JoinedMutation {
  const listed = listPartialFiles(joinDir);
  if ("finding" in listed) {
    return listed;
  }
  const loaded = loadAllPartials(listed.files);
  return "finding" in loaded ? loaded : finalizePartials(loaded.partials);
}
