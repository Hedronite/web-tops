export interface FlagSpec {
  /** Options that take a value: `--reason text` or `--reason=text`. */
  readonly values?: readonly string[];
  /** Options that stand alone. */
  readonly switches: readonly string[];
}

export interface Flags {
  readonly positionals: string[];
  readonly values: Map<string, string>;
  readonly switches: Set<string>;
}

/** `--name=value` becomes `--name`, `value`, so one loop reads both spellings. */
const expand = (argv: readonly string[]): string[] =>
  argv.flatMap((arg) => {
    const at = arg.indexOf("=");
    return arg.startsWith("--") && at !== -1 ? [arg.slice(0, at), arg.slice(at + 1)] : [arg];
  });

/** Takes the value that follows a value-taking option. */
function takeValue(tokens: readonly string[], index: number, out: Flags): number | string {
  const token = String(tokens[index]);
  const value = tokens[index + 1];
  if (value === undefined) return `${token} needs a value`;
  out.values.set(token, value);
  return index + 2;
}

/** Reads the flag at `index`; returns the index after it, or the problem. */
function consumeFlag(
  tokens: readonly string[],
  index: number,
  spec: FlagSpec,
  out: Flags,
): number | string {
  const token = String(tokens[index]);
  if (spec.switches.includes(token)) {
    out.switches.add(token);
    return index + 1;
  }
  return spec.values?.includes(token) === true
    ? takeValue(tokens, index, out)
    : `unknown option ${token}`;
}

function step(
  tokens: readonly string[],
  index: number,
  spec: FlagSpec,
  out: Flags,
): number | string {
  const token = String(tokens[index]);
  if (token.startsWith("--")) return consumeFlag(tokens, index, spec, out);
  out.positionals.push(token);
  return index + 1;
}

/** Splits argv into positional words, options with values, and switches; a string is what is wrong with it. */
export function parseFlags(argv: readonly string[], spec: FlagSpec): Flags | string {
  const tokens = expand(argv);
  const out: Flags = { positionals: [], values: new Map(), switches: new Set() };
  let index = 0;
  while (index < tokens.length) {
    const next = step(tokens, index, spec, out);
    if (typeof next === "string") return next;
    index = next;
  }
  return out;
}
