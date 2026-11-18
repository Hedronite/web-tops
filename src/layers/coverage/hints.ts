/** A coverage hint removes lines from the profile (WEB_TOPS.md section 6.1); the census counts each one (section 6.7). */
export type HintKind = "v8-ignore" | "istanbul-ignore" | "c8-ignore";

export interface CoverageHint {
  readonly kind: HintKind;
  readonly line: number;
}

// The comment forms the coverage tools honour, a block comment or a line comment that starts with the tool's name and
// `ignore`. Prose and strings are not hints.
const HINT = /(?:\/\*|\/\/)\s*(v8|c8|istanbul) ignore\b/gu;

const KINDS: Readonly<Record<string, HintKind>> = {
  v8: "v8-ignore",
  c8: "c8-ignore",
  istanbul: "istanbul-ignore",
};

/** A string literal on one line: double, single or backtick quoted, with escapes. */
const STRING = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/gu;

/** The line with the inside of every string literal blanked, so a hint written in a string is not found. */
function withoutStrings(line: string): string {
  return line.replace(STRING, (match) => " ".repeat(match.length));
}

function kindOf(name: string | undefined): HintKind | undefined {
  return name === undefined ? undefined : KINDS[name];
}

function inLine(text: string, line: number): CoverageHint[] {
  return Array.from(withoutStrings(text).matchAll(HINT)).flatMap((match) => {
    const kind = kindOf(match[1]);
    return kind === undefined ? [] : [{ kind, line }];
  });
}

/** Every v8, istanbul and c8 ignore hint in a source file, by line and in source order. */
export function coverageHints(source: string): CoverageHint[] {
  return source.split("\n").flatMap((text, index) => inLine(text, index + 1));
}
