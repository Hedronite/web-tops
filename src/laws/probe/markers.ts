import type { Expectation } from "./types.ts";

/**
 * `// expect: a, b` at the end of a line, which is also how an Astro frontmatter marks one; a CSS twin writes the same as
 * a block comment, and an Astro template as an HTML comment.
 */
function markerLine(): RegExp {
  return /(?:\/\/|\/\*|<!--) expect:\s*(?!\*\/|-->)(\S.*?)\s*(?:\*\/|-->)?\s*$/u;
}

/** The rule ids a marker names: comma-separated, blanks dropped. */
const rulesOf = (text: string): string[] =>
  text
    .split(",")
    .map((rule) => rule.trim())
    .filter((rule) => rule !== "");

interface Marker {
  readonly at: number;
  readonly rules: readonly string[];
}

/** The marker on a line, if it names at least one rule. */
function markerOf(line: string): Marker | undefined {
  const found = markerLine().exec(line);
  if (found === null) {
    return undefined;
  }
  const rules = rulesOf(String(found[1]));
  return rules.length === 0 ? undefined : { at: found.index, rules };
}

/**
 * The line a marker is about: its own line, or the next when the comment stands alone. A suppression directive cannot
 * carry a marker on its own line, because the marker would become the directive's description.
 */
function targetOf(line: string, markerAt: number, lineNumber: number): number {
  return line.slice(0, markerAt).trim() === "" ? lineNumber + 1 : lineNumber;
}

/** The expectations of one twin file: an `// expect: <rule>` marker names the rules its line must report. */
export function parseMarkers(file: string, text: string): Expectation[] {
  return text.split("\n").flatMap((line, index) => {
    const marker = markerOf(line);
    return marker === undefined
      ? []
      : [{ file, line: targetOf(line, marker.at, index + 1), rules: marker.rules }];
  });
}
