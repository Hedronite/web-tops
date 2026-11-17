/**
 * The globs of WEB_TOPS.md section 6.1 and `gates.coverage.exclude`: `**`, `*`, `?`, `{a,b}`, `[abc]` and
 * the optional group `?(a|b)`. A path is matched whole, with `/` as the separator.
 */

interface Piece {
  /** The regular expression for what was read. */
  readonly text: string;
  /** Where reading goes on. */
  readonly next: number;
}

type Rule = (glob: string, at: number) => Piece | undefined;

function weight(char: string, open: string, close: string): number {
  if (char === open) {
    return 1;
  }
  return char === close ? -1 : 0;
}

/** The index of the bracket that closes the one at `at`, or -1 when it is never closed. */
function closing(glob: string, at: number, open: string, close: string): number {
  let depth = 0;
  for (let index = at; index < glob.length; index += 1) {
    depth += weight(glob.charAt(index), open, close);
    if (depth === 0) {
      return index;
    }
  }
  return -1;
}

/** Splits on commas that are not inside a nested brace or group. */
function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    depth += weight(char, "{", "}") + weight(char, "(", ")");
    if (char === "," && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

const globstarDirectory: Rule = (glob, at) =>
  glob.startsWith("**/", at) ? { text: "(?:[^/]+/)*", next: at + 3 } : undefined;

const globstar: Rule = (glob, at) =>
  glob.startsWith("**", at) ? { text: ".*", next: at + 2 } : undefined;

const optionalGroup: Rule = (glob, at) => {
  const end = glob.startsWith("?(", at) ? closing(glob, at + 1, "(", ")") : -1;
  if (end === -1) {
    return undefined;
  }
  const inner = glob
    .slice(at + 2, end)
    .split("|")
    .map(translate)
    .join("|");
  return { text: `(?:${inner})?`, next: end + 1 };
};

const star: Rule = (glob, at) =>
  glob.charAt(at) === "*" ? { text: "[^/]*", next: at + 1 } : undefined;

const anyChar: Rule = (glob, at) =>
  glob.charAt(at) === "?" ? { text: "[^/]", next: at + 1 } : undefined;

const alternatives: Rule = (glob, at) => {
  const end = glob.charAt(at) === "{" ? closing(glob, at, "{", "}") : -1;
  if (end === -1) {
    return undefined;
  }
  const parts = splitTop(glob.slice(at + 1, end)).map(translate);
  return { text: `(?:${parts.join("|")})`, next: end + 1 };
};

const characterClass: Rule = (glob, at) => {
  const end = glob.charAt(at) === "[" ? glob.indexOf("]", at + 1) : -1;
  return end === -1 ? undefined : { text: glob.slice(at, end + 1), next: end + 1 };
};

// In the order they must be tried: the directory globstar before the plain one before a star, and a group before a single character.
const RULES: readonly Rule[] = [
  globstarDirectory,
  globstar,
  optionalGroup,
  star,
  anyChar,
  alternatives,
  characterClass,
];

const SPECIAL = /[.+^${}()|[\]\\]/u;

function literal(char: string): string {
  return SPECIAL.test(char) ? `\\${char}` : char;
}

function firstPiece(glob: string, at: number): Piece {
  for (const rule of RULES) {
    const piece = rule(glob, at);
    if (piece !== undefined) {
      return piece;
    }
  }
  return { text: literal(glob.charAt(at)), next: at + 1 };
}

function translate(glob: string): string {
  let text = "";
  let at = 0;
  while (at < glob.length) {
    const piece = firstPiece(glob, at);
    text += piece.text;
    at = piece.next;
  }
  return text;
}

/** Whether the whole path matches the glob. */
export function matchesGlob(path: string, glob: string): boolean {
  return new RegExp(`^${translate(glob)}$`, "u").test(path);
}
