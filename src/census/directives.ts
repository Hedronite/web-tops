import { extname } from "node:path";
import { astroParts } from "../complexity/astro.ts";
import type { AstroPart } from "../complexity/astro.ts";
import { htmlComments, scriptComments, styleComments } from "./comments.ts";
import type { Comment } from "./comments.ts";
import type { SourceKind } from "./kinds.ts";

/** One directive comment: the census kind it counts under, and the line it starts on. */
export interface Directive {
  readonly kind: SourceKind;
  readonly line: number;
}

type Matcher = readonly [SourceKind, RegExp];

/** What a directive looks like at the start of a comment's text, in JavaScript and TypeScript. */
const SCRIPT: readonly Matcher[] = [
  ["eslint-disable", /^eslint-disable(?:-next-line|-line)?(?![\w-])/u],
  ["ts-expect-error", /^@ts-expect-error(?![\w-])/u],
  ["ts-ignore", /^@ts-ignore(?![\w-])/u],
  ["ts-nocheck", /^@ts-nocheck(?![\w-])/u],
  ["biome-ignore", /^biome-ignore(?:-all|-start)?(?![\w-])/u],
  ["stryker-disable", /^Stryker disable(?![\w-])/u],
];

const STYLE: readonly Matcher[] = [
  ["stylelint-disable", /^stylelint-disable(?:-next-line|-line)?(?![\w-])/u],
];

const MARKUP: readonly Matcher[] = [
  ["eslint-disable", /^eslint-disable(?:-next-line|-line)?(?![\w-])/u],
  ["stylelint-disable", /^stylelint-disable(?:-next-line|-line)?(?![\w-])/u],
  ["html-validate-disable", /^\[html-validate-disable(?:-block|-next)?(?=[\s\]])/u],
];

/** The kind a comment's text counts under, or undefined: only the start of the text is a directive, so prose that mentions one is not. */
function kindOf(body: string, matchers: readonly Matcher[]): SourceKind | undefined {
  const text = body.trim();
  return matchers.find(([, pattern]) => pattern.test(text))?.[0];
}

function directivesOf(comments: readonly Comment[], matchers: readonly Matcher[]): Directive[] {
  return comments.flatMap((comment): Directive[] => {
    const kind = kindOf(comment.body, matchers);
    return kind === undefined ? [] : [{ kind, line: comment.line }];
  });
}

/** The `<style>` blocks of markup, each with the line its content starts on. */
function styleBlocks(text: string): { readonly line: number; readonly css: string }[] {
  return [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/giu)].map((found) => ({
    line: text.slice(0, found.index + found[0].indexOf(">") + 1).split("\n").length,
    css: found[1] ?? "",
  }));
}

/** The comments of a `<style>` block, their lines counted from the file's top. */
function styleDirectives(text: string): Directive[] {
  return styleBlocks(text).flatMap((block) =>
    directivesOf(styleComments(block.css, false), STYLE).map((found) => ({
      kind: found.kind,
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

const NOT_HTML_VALIDATE = MARKUP.filter(([kind]) => kind !== "html-validate-disable");

/** The directives of an Astro file: its frontmatter and scripts as TypeScript, its template as markup, its styles as CSS. */
function astroDirectives(text: string, file: string): Directive[] {
  const code = codeParts(text, file);
  const template = astroTemplate(text, code);
  return [
    ...code.flatMap((part) => directivesOf(scriptComments(part.text), SCRIPT)),
    ...directivesOf(htmlComments(template), NOT_HTML_VALIDATE),
    ...styleDirectives(template),
  ];
}

type Reader = (text: string, file: string) => Directive[];

const readScript: Reader = (text) => directivesOf(scriptComments(text), SCRIPT);
const readBlockStyle: Reader = (text) => directivesOf(styleComments(text, false), STYLE);
const readLineStyle: Reader = (text) => directivesOf(styleComments(text, true), STYLE);
const readMarkup: Reader = (text) => [
  ...directivesOf(htmlComments(text), MARKUP),
  ...styleDirectives(text),
];

const withReader = (extensions: readonly string[], read: Reader): [string, Reader][] =>
  extensions.map((ext) => [ext, read]);

/** The reader for each file extension the census reads. */
const READERS: ReadonlyMap<string, Reader> = new Map([
  ...withReader([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"], readScript),
  ...withReader([".css", ".pcss", ".postcss"], readBlockStyle),
  ...withReader([".scss", ".sass", ".less"], readLineStyle),
  ...withReader([".html", ".htm"], readMarkup),
  ...withReader([".astro"], astroDirectives),
]);

const readerFor = (file: string): Reader | undefined => READERS.get(extname(file).toLowerCase());

/** True for a file whose comments the census reads. */
export const readsDirectives = (file: string): boolean => readerFor(file) !== undefined;

/**
 * The suppression directives in one source file, by census kind and line (WEB_TOPS.md section 6.7), in the
 * comment forms the tools honour. A directive written in a string, a template literal or a regular
 * expression, or mentioned in the middle of prose, is not counted. An Astro file that does not parse as
 * Astro is read as far as it can be.
 */
export function directivesIn(file: string, text: string): Directive[] {
  return readerFor(file)?.(text, file) ?? [];
}
