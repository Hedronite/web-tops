/**
 * The comments of a source file, found the way the language reads it: a comment marker inside a string, a
 * template literal or a regular expression starts no comment (WEB_TOPS.md section 6.7 counts comment forms
 * only). Each comment has the 1-based line it starts on and its text without the delimiters.
 */
export interface Comment {
  readonly line: number;
  readonly body: string;
}

/** The mutable position of a scan. */
interface State {
  readonly text: string;
  index: number;
  line: number;
  /** The last character that was not white space, outside comments: what decides whether `/` opens a regex. */
  last: string;
  /** The word that ends at `last`, for `return /x/`. */
  word: string;
  readonly comments: Comment[];
}

const WORD = /[A-Za-z0-9_$]/u;

/** After these a `/` starts a regular expression; after a name, a number or a closing bracket it divides. */
const REGEX_AFTER = "(,=:[!&|?{};+-*%<>~^}";

const REGEX_KEYWORDS = new Set([
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "instanceof",
  "void",
  "delete",
  "throw",
  "new",
  "yield",
  "await",
]);

const start = (text: string): State => ({
  text,
  index: 0,
  line: 1,
  last: "",
  word: "",
  comments: [],
});

const at = (state: State): string => state.text.charAt(state.index);

const startsWith = (state: State, marker: string): boolean =>
  state.text.startsWith(marker, state.index);

/** Moves past `count` characters, counting the line breaks. */
function skip(state: State, count: number): void {
  const end = Math.min(state.text.length, state.index + count);
  for (; state.index < end; state.index += 1) {
    if (state.text.charAt(state.index) === "\n") state.line += 1;
  }
}

/** A value was read (a string, a regular expression): what follows divides rather than opens a regex. */
function valueRead(state: State): void {
  state.last = "x";
  state.word = "";
}

const LINE = /\/\/([^\n]*)\n?/uy;
const BLOCK = /\/\*([\s\S]*?)(?:\*\/|$)/uy;
const URL = /url\([^)]*\)?/uy;

/** The match of a sticky pattern at the scan's position, or null. */
function matchAt(state: State, pattern: RegExp): RegExpExecArray | null {
  pattern.lastIndex = state.index;
  return pattern.exec(state.text);
}

/** A comment the pattern finds at the position: its text is the first group; it is consumed, line break included. */
function commentAt(state: State, pattern: RegExp): boolean {
  const found = matchAt(state, pattern);
  if (found === null) return false;
  state.comments.push({ line: state.line, body: String(found[1]) });
  skip(state, found[0].length);
  return true;
}

const lineComment = (state: State): boolean => commentAt(state, LINE);

const blockComment = (state: State): boolean => commentAt(state, BLOCK);

const isQuote = (char: string): boolean => char === "'" || char === '"';

/** A character that ends no string yet: not its closing quote, not the end of the line, not the end of the text. */
const inString = (state: State, quote: string): boolean =>
  state.index < state.text.length && at(state) !== quote && at(state) !== "\n";

/** One character of a string or template, or an escape pair. */
const textStep = (state: State): void => {
  skip(state, at(state) === "\\" ? 2 : 1);
};

/** A single- or double-quoted string, which ends at its closing quote or at the end of its line. */
function quoted(state: State): boolean {
  const quote = at(state);
  if (!isQuote(quote)) return false;
  skip(state, 1);
  while (inString(state, quote)) textStep(state);
  skip(state, 1);
  valueRead(state);
  return true;
}

const braceWeight = (char: string): number => (char === "{" ? 1 : char === "}" ? -1 : 0);

/** The code inside `${ }` of a template literal: scanned like code, so a comment in it is a comment. */
function substitution(state: State): void {
  let depth = 1;
  while (state.index < state.text.length) {
    depth += braceWeight(at(state));
    if (depth === 0) return;
    step(state);
  }
}

/** One piece of a template literal's text: a `${ }` substitution, or a character. */
function templateStep(state: State): void {
  if (!startsWith(state, "${")) {
    textStep(state);
    return;
  }
  skip(state, 2);
  substitution(state);
}

/** A template literal, its text skipped and its `${ }` code scanned. */
function template(state: State): boolean {
  if (at(state) !== "`") return false;
  skip(state, 1);
  while (state.index < state.text.length && at(state) !== "`") templateStep(state);
  skip(state, 1);
  valueRead(state);
  return true;
}

/** At the start of the text `last` is empty, which `includes` finds in any string: a regex may start there. */
const regexAllowed = (state: State): boolean =>
  REGEX_AFTER.includes(state.last) || REGEX_KEYWORDS.has(state.word);

const classAfter = (char: string, inClass: boolean): boolean =>
  char === "[" ? true : char === "]" ? false : inClass;

/** More of the regular expression: before its closing `/` (which a character class does not end) and its line's end. */
const inRegex = (state: State, inClass: boolean): boolean =>
  state.index < state.text.length && at(state) !== "\n" && (inClass || at(state) !== "/");

/** The body of a regular expression: to the closing `/` outside a class, then its flags. */
function regexBody(state: State): void {
  let inClass = false;
  while (inRegex(state, inClass)) {
    inClass = classAfter(at(state), inClass);
    textStep(state);
  }
  skip(state, 1);
}

function regexLiteral(state: State): boolean {
  if (at(state) !== "/" || !regexAllowed(state)) return false;
  skip(state, 1);
  regexBody(state);
  valueRead(state);
  return true;
}

/** Anything else: one character, remembered so the next `/` can be read. */
function other(state: State): void {
  const char = at(state);
  if (char.trim() !== "") {
    state.word = WORD.test(char) ? state.word + char : "";
    state.last = char;
  }
  skip(state, 1);
}

const SCANNERS = [lineComment, blockComment, quoted, template, regexLiteral];

function step(state: State): void {
  if (!SCANNERS.some((scan) => scan(state))) other(state);
}

/** The comments of JavaScript or TypeScript source (`//` and block comments), in order. */
export function scriptComments(text: string): Comment[] {
  const state = start(text);
  while (state.index < text.length) step(state);
  return state.comments;
}

/** A `url( )`, whose text may hold `//` that is not a comment, is skipped whole. */
function cssParen(state: State): boolean {
  const found = matchAt(state, URL);
  if (found === null) return false;
  skip(state, found[0].length);
  return true;
}

const BLOCK_SCANNERS = [cssParen, blockComment, quoted];
const LINE_SCANNERS = [cssParen, lineComment, blockComment, quoted];

function cssStep(state: State, scanners: readonly ((state: State) => boolean)[]): void {
  if (!scanners.some((scan) => scan(state))) other(state);
}

/** The comments of a stylesheet: block comments, and `//` ones too in Sass, SCSS and Less. */
export function styleComments(text: string, lineComments: boolean): Comment[] {
  const state = start(text);
  const scanners = lineComments ? LINE_SCANNERS : BLOCK_SCANNERS;
  while (state.index < text.length) cssStep(state, scanners);
  return state.comments;
}

const HTML_COMMENT = /<!--[\s\S]*?-->/gu;

/** The comments of HTML or of an Astro template: `<!-- ... -->`. */
export function htmlComments(text: string): Comment[] {
  return [...text.matchAll(HTML_COMMENT)].map((found) => ({
    line: text.slice(0, found.index).split("\n").length,
    body: found[0].slice(4, -3),
  }));
}
