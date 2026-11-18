import { ComplexityError } from "./types.ts";

/**
 * An `.astro` file as the parts the counter reads (WEB_TOPS.md section 6.3: "a ternary or `&&` inside
 * JSX or an Astro template counts in its component"). Every part is the whole file with everything
 * outside it blanked to spaces (line breaks kept), so offsets and lines are the file's own.
 */
export interface AstroPart {
  readonly kind: "frontmatter" | "script" | "template";
  readonly text: string;
}

interface Range {
  readonly start: number;
  readonly end: number;
}

const OPEN_FENCE = /^\uFEFF?\s*---[ \t]*(?:\r\n|\n|\r)/;
const CLOSE_FENCE = /^[ \t]*---[ \t]*$/gm;
const COMMENT = /<!--[\s\S]*?-->/g;
const STYLE = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;
const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/dgi;
const TYPE_ATTRIBUTE = /\btype\s*=\s*["']?([^"'\s>]+)/i;
const JAVASCRIPT_TYPES = new Set(["module", "text/javascript", "application/javascript"]);

/** Replaces every character in the range but the line breaks with a space, so no offset moves. */
function blank(text: string, range: Range): string {
  const hidden = text.slice(range.start, range.end).replace(/[^\r\n\u2028\u2029]/g, " ");
  return text.slice(0, range.start) + hidden + text.slice(range.end);
}

const blankAll = (text: string, ranges: readonly Range[]): string => ranges.reduce(blank, text);

/** Hides everything outside the range. */
const keepOnly = (text: string, keep: Range): string =>
  blankAll(text, [
    { start: 0, end: keep.start },
    { start: keep.end, end: text.length },
  ]);

function matchesOf(pattern: RegExp, text: string): Range[] {
  return [...text.matchAll(pattern)].map((found) => ({
    start: found.index,
    end: found.index + found[0].length,
  }));
}

interface Frontmatter {
  /** The two fence lines and what is between them. */
  readonly block: Range;
  /** What is between the fences. */
  readonly code: Range;
}

/** The `---` fenced block at the top of the file, if any. An opening fence that is never closed is an error. */
function frontmatterOf(text: string, file: string): Frontmatter | undefined {
  const open = OPEN_FENCE.exec(text);
  if (open === null) return undefined;
  CLOSE_FENCE.lastIndex = open[0].length;
  const close = CLOSE_FENCE.exec(text);
  if (close === null)
    throw new ComplexityError("frontmatter fence `---` is never closed", file, 1, 1);
  return {
    block: { start: 0, end: close.index + close[0].length },
    code: { start: open[0].length, end: close.index },
  };
}

interface ScriptBlock {
  readonly block: Range;
  readonly code: Range | undefined;
}

/** A `<script>` holds code unless it says its `type` is something else (JSON, an import map). */
function holdsCode(attributes: string): boolean {
  const type = TYPE_ATTRIBUTE.exec(attributes)?.[1];
  return type === undefined || JAVASCRIPT_TYPES.has(type.toLowerCase());
}

/** The code range of a `<script>` whose attributes say it holds code. */
const codeRange = (content: readonly [number, number], attributes: string): Range | undefined =>
  holdsCode(attributes) ? { start: content[0], end: content[1] } : undefined;

function scriptBlock(found: RegExpExecArray): ScriptBlock {
  const block = { start: found.index, end: found.index + found[0].length };
  const content = found.indices?.[2];
  return { block, code: content === undefined ? undefined : codeRange(content, String(found[1])) };
}

const scriptBlocks = (text: string): ScriptBlock[] => [...text.matchAll(SCRIPT)].map(scriptBlock);

const scriptParts = (text: string, scripts: readonly ScriptBlock[]): AstroPart[] =>
  scripts.flatMap(({ code }) =>
    code === undefined ? [] : [{ kind: "script" as const, text: keepOnly(text, code) }],
  );

/** The parts of an `.astro` file, in source order: frontmatter, each `<script>` of code, then the template. */
export function astroParts(text: string, file: string): AstroPart[] {
  const front = frontmatterOf(text, file);
  const body = front === undefined ? text : blank(text, front.block);
  const plain = blankAll(body, matchesOf(COMMENT, body));
  const scripts = scriptBlocks(plain);
  const hidden = [...matchesOf(STYLE, plain), ...scripts.map((script) => script.block)];
  const first: AstroPart[] =
    front === undefined ? [] : [{ kind: "frontmatter", text: keepOnly(text, front.code) }];
  return [
    ...first,
    ...scriptParts(text, scripts),
    { kind: "template", text: blankAll(plain, hidden) },
  ];
}
