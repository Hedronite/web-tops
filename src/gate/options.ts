import type { GateOptions, Tier } from "./types.ts";

export type ParsedOptions =
  | { readonly ok: true; readonly options: GateOptions }
  | { readonly ok: false; readonly error: string };

function toTier(text: string): Tier | undefined {
  switch (text) {
    case "0":
      return 0;
    case "1":
      return 1;
    case "2":
      return 2;
    case "3":
      return 3;
    default:
      return undefined;
  }
}

/** Splits `--flag=value` into its parts; a bare `--flag` has no value. */
function split(argument: string): [string, string | undefined] {
  const at = argument.indexOf("=");
  return at === -1 ? [argument, undefined] : [argument.slice(0, at), argument.slice(at + 1)];
}

/** Parses `webtops gate` arguments (WEB_TOPS.md section 12). A usage error is exit 2. */
export function parseGateArgs(argv: readonly string[]): ParsedOptions {
  let maxTier: Tier = 1;
  let only: string | undefined;
  let base: string | undefined;
  let keepGoing = false;
  let json = false;
  let dryRun = false;
  const queue = [...argv];
  for (let argument = queue.shift(); argument !== undefined; argument = queue.shift()) {
    const [flag, inline] = split(argument);
    const takeValue = (): string | undefined => inline ?? queue.shift();
    switch (flag) {
      case "--keep-going":
        keepGoing = true;
        break;
      case "--json":
        json = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--max-tier": {
        const value = takeValue();
        const tier = value === undefined ? undefined : toTier(value);
        if (tier === undefined) {
          return { ok: false, error: `--max-tier takes 0, 1, 2 or 3, got ${value ?? "nothing"}` };
        }
        maxTier = tier;
        break;
      }
      case "--only": {
        const value = takeValue();
        if (value === undefined || value === "") {
          return { ok: false, error: "--only takes a layer id" };
        }
        if (only !== undefined) {
          return { ok: false, error: "--only is given once" };
        }
        only = value;
        break;
      }
      case "--base": {
        const value = takeValue();
        if (value === undefined || value === "") {
          return { ok: false, error: "--base takes a git ref" };
        }
        base = value;
        break;
      }
      default:
        return {
          ok: false,
          error: flag.startsWith("--")
            ? `unknown option "${flag}"`
            : `unexpected argument "${argument}"`,
        };
    }
  }
  return {
    ok: true,
    options: {
      maxTier,
      ...(only === undefined ? {} : { only }),
      ...(base === undefined ? {} : { base }),
      keepGoing,
      json,
      dryRun,
    },
  };
}
