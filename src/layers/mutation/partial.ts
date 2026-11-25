import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MutationMetric } from "../../config/report.ts";
import type { MutationRead, SurvivorRow } from "./read.ts";

/** Metadata shared by every shard of one sharded mutation run, used by `--join` to fail closed on mismatches. */
export interface ShardMeta {
  readonly shard: number;
  readonly shards: number;
  readonly base: string;
  readonly entriesHash: string;
  readonly entriesCount: number;
  readonly shardEntries: readonly string[];
}

/** Partial mutation artifact written by `--shard i/n` to `.web-tops/out/mutation/partial.json`. */
export interface PartialMutation extends ShardMeta {
  readonly version: 1;
  readonly counts: MutationMetric;
  readonly survivors: readonly SurvivorRow[];
  readonly excluded: number;
  readonly unknown: readonly string[];
  readonly timedOut: boolean;
  readonly starved: boolean;
  readonly vacuous: boolean;
}

/** Zeroed mutation status counts, created inside a function to avoid static module-level data (R95). */
export function zeroCounts(): MutationMetric {
  return {
    killed: 0,
    timeout: 0,
    survived: 0,
    no_coverage: 0,
    runtime_error: 0,
    compile_error: 0,
    ignored: 0,
  };
}

/** Partial artifact for a vacuous diff or an empty shard, preserving `entriesHash` and shard metadata. */
export function vacuousPartial(meta: ShardMeta): PartialMutation {
  return {
    version: 1,
    ...meta,
    counts: zeroCounts(),
    survivors: [],
    excluded: 0,
    unknown: [],
    timedOut: false,
    starved: false,
    vacuous: true,
  };
}

/** Partial artifact when Stryker hits `time_budget_minutes` before completing. */
export function timedOutPartial(meta: ShardMeta): PartialMutation {
  return {
    version: 1,
    ...meta,
    counts: zeroCounts(),
    survivors: [],
    excluded: 0,
    unknown: [],
    timedOut: true,
    starved: false,
    vacuous: false,
  };
}

/** Partial artifact from a completed Stryker run on this shard, carrying raw survivors and counts. */
export function readPartial(
  meta: ShardMeta,
  read: MutationRead,
  starved: boolean,
  vacuous: boolean,
): PartialMutation {
  return {
    version: 1,
    ...meta,
    counts: read.counts,
    survivors: read.survivors,
    excluded: read.excluded,
    unknown: read.unknown,
    timedOut: false,
    starved,
    vacuous,
  };
}

/** Writes `.web-tops/out/mutation/partial.json` and returns its path. */
export function writePartial(outDir: string, partial: PartialMutation): string {
  const directory = join(outDir, "mutation");
  mkdirSync(directory, { recursive: true });
  const file = join(directory, "partial.json");
  writeFileSync(file, JSON.stringify(partial, null, 2));
  return file;
}
