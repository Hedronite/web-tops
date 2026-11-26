/** One local-candidate reference extracted from an HTML tag attribute. */
export interface HtmlReference {
  readonly line: number;
  readonly attr: "href" | "src" | "srcset" | "poster";
  readonly target: string;
}

/** Parsed anchors (`id` and `<a name>`) and link/asset references of one HTML file. */
export interface ParsedHtml {
  readonly anchors: ReadonlySet<string>;
  readonly refs: readonly HtmlReference[];
}

const HREF_TAGS = new Set(["a", "area", "link"]);
const SRC_TAGS = new Set(["audio", "embed", "iframe", "img", "script", "source", "track", "video"]);
const SRCSET_TAGS = new Set(["img", "source"]);
const CLOSE_BODY_RE = new Map<string, RegExp>([
  ["script", /<\/script[^>]*>/giu],
  ["style", /<\/style[^>]*>/giu],
]);
const QUOTES = new Set(['"', "\u0027"]);

const NAMED_ENTITIES = new Map<string, string>([
  ["amp", "&"],
  ["apos", "\u0027"],
  ["gt", ">"],
  ["lt", "<"],
  ["quot", '"'],
]);

function decodeNumericEntity(num: string, hex: boolean): string {
  const code = Number.parseInt(num, hex ? 16 : 10);
  return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
}

function replaceEntity(raw: string, body: string): string {
  if (body.toLowerCase().startsWith("#x")) return decodeNumericEntity(body.slice(2), true);
  if (body.startsWith("#")) return decodeNumericEntity(body.slice(1), false);
  return NAMED_ENTITIES.get(body) ?? raw;
}

function decodeEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/gu, (raw, body: string) =>
    replaceEntity(raw, body),
  );
}

function splitSrcsetItem(entry: string): string | undefined {
  const match = /\S+/u.exec(entry);
  return match === null ? undefined : match[0];
}

function parseSrcset(value: string): string[] {
  return value
    .split(",")
    .map(splitSrcsetItem)
    .filter((item): item is string => item !== undefined);
}

const ATTR_RE =
  /([a-zA-Z_:][a-zA-Z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|\x27([^\x27]*)\x27|([^\s"\x27=<>`]+))/gu;

function recordAttr(out: Map<string, string>, match: RegExpExecArray): void {
  const name = String(match[1]).toLowerCase();
  if (!out.has(name)) out.set(name, decodeEntities(match[2] ?? match[3] ?? String(match[4])));
}

function parseAttributes(attrText: string): Map<string, string> {
  const out = new Map<string, string>();
  ATTR_RE.lastIndex = 0;
  let match = ATTR_RE.exec(attrText);
  while (match !== null) {
    recordAttr(out, match);
    match = ATTR_RE.exec(attrText);
  }
  return out;
}

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

function addNonEmpty(set: Set<string>, value: string | undefined): void {
  if (value !== undefined && value !== "") set.add(value);
}

function collectAnchors(
  tag: string,
  attrs: ReadonlyMap<string, string>,
  anchors: Set<string>,
): void {
  addNonEmpty(anchors, attrs.get("id"));
  if (tag === "a") addNonEmpty(anchors, attrs.get("name"));
}

function pushRef(
  refs: HtmlReference[],
  line: number,
  attr: HtmlReference["attr"],
  target: string | undefined,
): void {
  if (target !== undefined) refs.push({ line, attr, target });
}

function collectSrcset(
  tag: string,
  attrs: ReadonlyMap<string, string>,
  line: number,
  refs: HtmlReference[],
): void {
  const srcset = SRCSET_TAGS.has(tag) ? attrs.get("srcset") : undefined;
  if (srcset === undefined) return;
  for (const target of parseSrcset(srcset)) refs.push({ line, attr: "srcset", target });
}

function collectTagRefs(
  tag: string,
  attrs: ReadonlyMap<string, string>,
  line: number,
  refs: HtmlReference[],
): void {
  if (HREF_TAGS.has(tag)) pushRef(refs, line, "href", attrs.get("href"));
  if (SRC_TAGS.has(tag)) pushRef(refs, line, "src", attrs.get("src"));
  if (tag === "video") pushRef(refs, line, "poster", attrs.get("poster"));
  collectSrcset(tag, attrs, line, refs);
}

function skipComment(source: string, start: number): number {
  const end = source.indexOf("-->", start + 4);
  return end === -1 ? source.length : end + 3;
}

function openQuote(ch: string): string {
  return QUOTES.has(ch) ? ch : "";
}

function nextQuote(ch: string, quote: string): string {
  if (quote === "") return openQuote(ch);
  return ch === quote ? "" : quote;
}

function isTagClose(ch: string, quote: string): boolean {
  return quote === "" && ch === ">";
}

function findTagEnd(source: string, start: number): number {
  let quote = "";
  let pos = start + 1;
  for (const ch of source.slice(start + 1)) {
    if (isTagClose(ch, quote)) return pos + 1;
    quote = nextQuote(ch, quote);
    pos += 1;
  }
  return source.length;
}

function findCloseTag(source: string, closeRe: RegExp, from: number): number {
  closeRe.lastIndex = from;
  return closeRe.exec(source) === null ? source.length : closeRe.lastIndex;
}

function collectFromHeader(
  tag: string,
  attrText: string,
  line: number,
  anchors: Set<string>,
  refs: HtmlReference[],
): void {
  const attrs = parseAttributes(attrText);
  collectAnchors(tag, attrs, anchors);
  collectTagRefs(tag, attrs, line, refs);
}

function scanNext(source: string, lt: number, anchors: Set<string>, refs: HtmlReference[]): number {
  if (source.startsWith("<!--", lt)) return skipComment(source, lt);
  const tagEnd = findTagEnd(source, lt);
  const header = /^\s*([a-zA-Z][a-zA-Z0-9-]*)\b([\s\S]*)/u.exec(source.slice(lt + 1, tagEnd));
  if (header === null) return tagEnd;
  const tag = String(header[1]).toLowerCase();
  collectFromHeader(tag, String(header[2]), lineAt(source, lt), anchors, refs);
  const closeRe = CLOSE_BODY_RE.get(tag);
  return closeRe === undefined ? tagEnd : findCloseTag(source, closeRe, tagEnd);
}

/** Extracts anchor IDs and link/asset references with source line numbers from built HTML. */
export function parseHtmlPage(source: string): ParsedHtml {
  const anchors = new Set<string>();
  const refs: HtmlReference[] = [];
  let lt = source.indexOf("<");
  while (lt !== -1) {
    lt = source.indexOf("<", scanNext(source, lt, anchors, refs));
  }
  return { anchors, refs };
}
