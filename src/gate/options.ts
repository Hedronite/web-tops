import type { GateOptions, ShardSpec, Tier } from "./types.ts";

export type ParsedOptions =
  | { readonly ok: true; readonly options: GateOptions }
  | { readonly ok: false; readonly error: string };

/** The options as the arguments fill them in. */
const MAX_SHARDS = 4;

interface Draft {
  maxTier: Tier;
  only?: string;
  base?: string;
  shard?: ShardSpec;
  join?: string;
  keepGoing: boolean;
  json: boolean;
  dryRun: boolean;
  all: boolean;
}

/** Reads the value that follows a flag (`--flag=value` or the next argument). */
type TakeValue = () => string | undefined;

/** Applies one flag that takes a value; the result is the usage error, if there is one. */
type ValuedFlag = (draft: Draft, take: TakeValue) => string | undefined;

const TIERS: ReadonlyMap<string, Tier> = new Map<string, Tier>([
  ["0", 0],
  ["1", 1],
  ["2", 2],
  ["3", 3],
]);

const SWITCHES: ReadonlyMap<string, "keepGoing" | "json" | "dryRun" | "all"> = new Map([
  ["--keep-going", "keepGoing"],
  ["--json", "json"],
  ["--dry-run", "dryRun"],
  ["--all", "all"],
] as const);

const maxTier: ValuedFlag = (draft, take) => {
  const value = take();
  const tier = value === undefined ? undefined : TIERS.get(value);
  if (tier === undefined) {
    return `--max-tier takes 0, 1, 2 or 3, got ${value ?? "nothing"}`;
  }
  draft.maxTier = tier;
  return undefined;
};

const only: ValuedFlag = (draft, take) => {
  const value = take();
  if (value === undefined || value === "") {
    return "--only takes a layer id";
  }
  if (draft.only !== undefined) {
    return "--only is given once";
  }
  draft.only = value;
  return undefined;
};

const base: ValuedFlag = (draft, take) => {
  const value = take();
  if (value === undefined || value === "") {
    return "--base takes a git ref";
  }
  draft.base = value;
  return undefined;
};

const shardRangeError = (index: number, count: number, value: string): string | undefined =>
  count > MAX_SHARDS
    ? `--shard supports at most ${String(MAX_SHARDS)} shards, got ${value}`
    : index > count
      ? `--shard index must not exceed count (1 <= i <= n), got ${value}`
      : undefined;

function parseShardSpec(value: string): ShardSpec | string {
  const match = /^([1-9]\d*)\/([1-9]\d*)$/u.exec(value);
  if (match === null) {
    return `--shard takes i/n (positive integers), got ${value}`;
  }
  const index = Number(match[1]);
  const count = Number(match[2]);
  return shardRangeError(index, count, value) ?? { index, count };
}

function readShard(draft: Draft, value: string): string | undefined {
  if (draft.shard !== undefined) {
    return "--shard is given once";
  }
  const parsed = parseShardSpec(value);
  if (typeof parsed === "string") {
    return parsed;
  }
  draft.shard = parsed;
  return undefined;
}

const shard: ValuedFlag = (draft, take) => {
  const value = take();
  return value === undefined || value === "" ? "--shard takes i/n" : readShard(draft, value);
};

const joinFlag: ValuedFlag = (draft, take) => {
  const value = take();
  if (value === undefined || value === "") {
    return "--join takes a directory";
  }
  if (draft.join !== undefined) {
    return "--join is given once";
  }
  draft.join = value;
  return undefined;
};

const VALUED: ReadonlyMap<string, ValuedFlag> = new Map([
  ["--max-tier", maxTier],
  ["--only", only],
  ["--base", base],
  ["--shard", shard],
  ["--join", joinFlag],
]);

/** Splits `--flag=value` into its parts; a bare `--flag` has no value. */
function split(argument: string): [string, string | undefined] {
  const at = argument.indexOf("=");
  return at === -1 ? [argument, undefined] : [argument.slice(0, at), argument.slice(at + 1)];
}

function unknownFlag(flag: string, argument: string): string {
  return flag.startsWith("--") ? `unknown option "${flag}"` : `unexpected argument "${argument}"`;
}

function applyFlag(
  draft: Draft,
  flag: string,
  argument: string,
  take: TakeValue,
): string | undefined {
  const toggle = SWITCHES.get(flag);
  if (toggle !== undefined) {
    draft[toggle] = true;
    return undefined;
  }
  const valued = VALUED.get(flag);
  return valued === undefined ? unknownFlag(flag, argument) : valued(draft, take);
}

function optionalJoin(draft: Draft): Pick<GateOptions, "join"> {
  return draft.join === undefined ? {} : { join: draft.join };
}

function optionalOf(draft: Draft): Pick<GateOptions, "only" | "base" | "shard" | "join"> {
  return {
    ...(draft.only === undefined ? {} : { only: draft.only }),
    ...(draft.base === undefined ? {} : { base: draft.base }),
    ...(draft.shard === undefined ? {} : { shard: draft.shard }),
    ...optionalJoin(draft),
  };
}

function optionsOf(draft: Draft): GateOptions {
  return {
    maxTier: draft.maxTier,
    ...optionalOf(draft),
    keepGoing: draft.keepGoing,
    json: draft.json,
    dryRun: draft.dryRun,
    all: draft.all,
  };
}

/** Parses `webtops gate` arguments (WEB_TOPS.md section 12). A usage error is exit 2. */
function joinConflict(draft: Draft): string | undefined {
  if (draft.join === undefined) return undefined;
  if (draft.shard !== undefined) return "--join and --shard cannot be used together";
  return draft.only === undefined ? undefined : "--join and --only cannot be used together";
}

export function parseGateArgs(argv: readonly string[]): ParsedOptions {
  const draft: Draft = { maxTier: 1, keepGoing: false, json: false, dryRun: false, all: false };
  const queue = [...argv];
  for (let argument = queue.shift(); argument !== undefined; argument = queue.shift()) {
    const [flag, inline] = split(argument);
    const error = applyFlag(draft, flag, argument, () => inline ?? queue.shift());
    if (error !== undefined) {
      return { ok: false, error };
    }
  }
  const conflict = joinConflict(draft);
  return conflict === undefined
    ? { ok: true, options: optionsOf(draft) }
    : { ok: false, error: conflict };
}
