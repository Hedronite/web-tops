import { extname } from "node:path";
import { astroParts } from "../complexity/astro.ts";
import type { AstroPart } from "../complexity/astro.ts";
import { htmlComments, scriptComments, styleComments } from "./comments.ts";
import type { Comment } from "./comments.ts";
import type { AckKind, SourceKind } from "./kinds.ts";

/** The kinds a comment can be: a suppression directive, or an acknowledgement of a soft law. */
type DirectiveKind = SourceKind | AckKind;

/** One comment that is a directive: the kind it counts under, the line it starts on, and its text without the delimiters. */
interface Found<Kind extends DirectiveKind> {
  readonly kind: Kind;
  readonly line: number;
  readonly body: string;
}

/** A suppression directive, counted by the census (section 6.7). */
export type Directive = Found<SourceKind>;

/** An acknowledgement of a soft law written as a comment (section 8.1). */
export type AckDirective = Found<AckKind>;

type AnyDirective = Found<DirectiveKind>;

type Matcher = readonly [DirectiveKind, RegExp];

/** An acknowledgement of a soft law, in any comment form (WEB_TOPS.md section 8.1). */
const ack = (): Matcher => ["webtops-ack", /^webtops-ack(?![\w-])/u];

/** What a directive looks like at the start of a comment's text, in JavaScript and TypeScript. */
const scriptMatchers = (): readonly Matcher[] => [
  ["eslint-disable", /^eslint-disable(?:-next-line|-line)?(?![\w-])/u],
  ["ts-expect-error", /^@ts-expect-error(?![\w-])/u],
  ["ts-ignore", /^@ts-ignore(?![\w-])/u],
  ["ts-nocheck", /^@ts-nocheck(?![\w-])/u],
  ["biome-ignore", /^biome-ignore(?:-all|-start)?(?![\w-])/u],
  ["stryker-disable", /^Stryker disable(?![\w-])/u],
  ack(),
];

const styleMatchers = (): readonly Matcher[] => [
  ["stylelint-disable", /^stylelint-disable(?:-next-line|-line)?(?![\w-])/u],
  ack(),
];

const markupMatchers = (): readonly Matcher[] => [
  ["eslint-disable", /^eslint-disable(?:-next-line|-line)?(?![\w-])/u],
  ["stylelint-disable", /^stylelint-disable(?:-next-line|-line)?(?![\w-])/u],
  ["html-validate-disable", /^\[html-validate-disable(?:-block|-next)?(?=[\s\]])/u],
  ack(),
];

/** The kind a comment's text counts under, or undefined: only the start of the text is a directive, so prose that mentions one is not. */
function kindOf(body: string, matchers: readonly Matcher[]): DirectiveKind | undefined {
  const text = body.trim();
  return matchers.find(([, pattern]) => pattern.test(text))?.[0];
}

function directivesOf(comments: readonly Comment[], matchers: readonly Matcher[]): AnyDirective[] {
  return comments.flatMap((comment): AnyDirective[] => {
    const kind = kindOf(comment.body, matchers);
    return kind === undefined ? [] : [{ kind, line: comment.line, body: comment.body.trim() }];
  });
}

const styleBlock = (): RegExp => /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/giu;

const linesBefore = (text: string, index: number): number =>
  text.slice(0, index).split("\n").length;

/** The `<style>` blocks of markup, each with the line its content starts on (an opening tag may span lines). */
function styleBlocks(text: string): { readonly line: number; readonly css: string }[] {
  return [...text.matchAll(styleBlock())].map((found) => ({
    line: linesBefore(text, found.index) + String(found[1]).split("\n").length - 1,
    css: String(found[2]),
  }));
}

/** The comments of a `<style>` block, their lines counted from the file's top. */
function styleDirectives(text: string): AnyDirective[] {
  return styleBlocks(text).flatMap((block) =>
    directivesOf(styleComments(block.css, false), styleMatchers()).map((found) => ({
      ...found,
      line: found.line + block.line - 1,
    })),
  );
}

/** The frontmatter and `<script>` parts of an Astro file; none when the file is not Astro that can be split (an unclosed fence). */
function codeParts(text: string, file: string): AstroPart[] {
  try {
    return astroParts(text, file).filter((part) => part.kind !== "template");
  } catch {
    return [];
  }
}

/** Everything in an Astro file that is not code: the frontmatter and scripts blanked, so only the template is left. */
function astroTemplate(text: string, code: readonly AstroPart[]): string {
  return text
    .split("")
    .map((char, index) => (code.some((part) => part.text.charAt(index).trim() !== "") ? " " : char))
    .join("");
}

const notHtmlValidate = (): readonly Matcher[] =>
  markupMatchers().filter(([kind]) => kind !== "html-validate-disable");

/** The directives of an Astro file: its frontmatter and scripts as TypeScript, its template as markup, its styles as CSS. */
function astroDirectives(text: string, file: string): AnyDirective[] {
  const code = codeParts(text, file);
  const template = astroTemplate(text, code);
  return [
    ...code.flatMap((part) => directivesOf(scriptComments(part.text), scriptMatchers())),
    ...directivesOf(htmlComments(template), notHtmlValidate()),
    ...styleDirectives(template),
  ];
}

type Reader = (text: string, file: string) => AnyDirective[];

const readScript: Reader = (text) => directivesOf(scriptComments(text), scriptMatchers());
const readBlockStyle: Reader = (text) => directivesOf(styleComments(text, false), styleMatchers());
const readLineStyle: Reader = (text) => directivesOf(styleComments(text, true), styleMatchers());
const readMarkup: Reader = (text) => [
  ...directivesOf(htmlComments(text), markupMatchers()),
  ...styleDirectives(text),
];

const withReader = (extensions: readonly string[], read: Reader): [string, Reader][] =>
  extensions.map((ext) => [ext, read]);

/** The reader for each file extension the census reads. */
const readers = (): ReadonlyMap<string, Reader> =>
  new Map([
    ...withReader([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"], readScript),
    ...withReader([".css", ".pcss", ".postcss"], readBlockStyle),
    ...withReader([".scss", ".sass", ".less"], readLineStyle),
    ...withReader([".html", ".htm"], readMarkup),
    ...withReader([".astro"], astroDirectives),
  ]);

const readerFor = (file: string): Reader | undefined => readers().get(extname(file).toLowerCase());

/** True for a file whose comments the census reads. */
export const readsDirectives = (file: string): boolean => readerFor(file) !== undefined;

/**
 * The directives in one source file, suppressions and acknowledgements, by kind and line, in the
 * comment forms the tools honour. A directive written in a string, a template literal or a regular
 * expression, or mentioned in the middle of prose, is not counted. An Astro file that does not parse as
 * Astro is read as far as it can be.
 */
export function allDirectivesIn(file: string, text: string): AnyDirective[] {
  return readerFor(file)?.(text, file) ?? [];
}

const isAck = (found: AnyDirective): found is AckDirective => found.kind === "webtops-ack";
const isSuppression = (found: AnyDirective): found is Directive => found.kind !== "webtops-ack";

/** The suppression directives of a file, which the census counts (WEB_TOPS.md section 6.7). */
export function directivesIn(file: string, text: string): Directive[] {
  return allDirectivesIn(file, text).filter(isSuppression);
}

/** The acknowledgement comments of a file, in any comment form the file's kind has (WEB_TOPS.md section 8.1). */
export function ackDirectivesIn(file: string, text: string): AckDirective[] {
  return allDirectivesIn(file, text).filter(isAck);
}
