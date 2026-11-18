/** A coverage hint removes lines from the profile (WEB_TOPS.md section 6.1); the census counts each one (section 6.7). */
export type HintKind = "v8-ignore" | "istanbul-ignore" | "c8-ignore";

export interface CoverageHint {
  readonly kind: HintKind;
  readonly line: number;
}

const HINTS: readonly (readonly [HintKind, RegExp])[] = [
  ["v8-ignore", /\bv8 ignore\b/gu],
  ["istanbul-ignore", /\bistanbul ignore\b/gu],
  ["c8-ignore", /\bc8 ignore\b/gu],
];

function inLine(text: string, line: number): CoverageHint[] {
  return HINTS.flatMap(([kind, pattern]) =>
    Array.from(text.matchAll(pattern), (): CoverageHint => ({ kind, line })),
  );
}

/** Every v8, istanbul and c8 ignore hint in a source file, by line and in source order. */
export function coverageHints(source: string): CoverageHint[] {
  return source.split("\n").flatMap((text, index) => inLine(text, index + 1));
}
