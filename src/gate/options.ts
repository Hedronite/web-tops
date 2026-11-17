import type { GateOptions, Tier } from "./types.ts";

export type ParsedOptions =
  | { readonly ok: true; readonly options: GateOptions }
  | { readonly ok: false; readonly error: string };

/** The options as the arguments fill them in. */
interface Draft {
  maxTier: Tier;
  only?: string;
  base?: string;
  keepGoing: boolean;
  json: boolean;
  dryRun: boolean;
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

const SWITCHES: ReadonlyMap<string, "keepGoing" | "json" | "dryRun"> = new Map([
  ["--keep-going", "keepGoing"],
  ["--json", "json"],
  ["--dry-run", "dryRun"],
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

const VALUED: ReadonlyMap<string, ValuedFlag> = new Map([
  ["--max-tier", maxTier],
  ["--only", only],
  ["--base", base],
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

function optionsOf(draft: Draft): GateOptions {
  return {
    maxTier: draft.maxTier,
    ...(draft.only === undefined ? {} : { only: draft.only }),
    ...(draft.base === undefined ? {} : { base: draft.base }),
    keepGoing: draft.keepGoing,
    json: draft.json,
    dryRun: draft.dryRun,
  };
}

/** Parses `webtops gate` arguments (WEB_TOPS.md section 12). A usage error is exit 2. */
export function parseGateArgs(argv: readonly string[]): ParsedOptions {
  const draft: Draft = { maxTier: 1, keepGoing: false, json: false, dryRun: false };
  const queue = [...argv];
  for (let argument = queue.shift(); argument !== undefined; argument = queue.shift()) {
    const [flag, inline] = split(argument);
    const error = applyFlag(draft, flag, argument, () => inline ?? queue.shift());
    if (error !== undefined) {
      return { ok: false, error };
    }
  }
  return { ok: true, options: optionsOf(draft) };
}
