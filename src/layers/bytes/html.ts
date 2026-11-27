/** Extracted JavaScript sources from one built HTML page. */
export interface PageScripts {
  readonly inlineBodies: readonly string[];
  readonly externalRefs: readonly { readonly line: number; readonly target: string }[];
  readonly hasIsland: boolean;
}

const JS_MIME_TYPES = new Set([
  "",
  "module",
  "text/javascript",
  "application/javascript",
  "application/ecmascript",
  "text/ecmascript",
]);

const NAMED_ENTITIES = new Map<string, string>([
  ["amp", "&"],
  ["apos", "\u0027"],
  ["gt", ">"],
  ["lt", "<"],
  ["quot", '"'],
]);

const QUOTES = new Set(['"', "\u0027"]);
const SCRIPT_CLOSE_RE = /<\/script[^>]*>/giu;

function decodeEntities(text: string): string {
  return text.replace(/&([a-zA-Z]+);/gu, (raw, body: string) => NAMED_ENTITIES.get(body) ?? raw);
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

function skipComment(source: string, start: number): number {
  const end = source.indexOf("-->", start + 4);
  return end === -1 ? source.length : end + 3;
}

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

function isExecutableScriptType(rawType: string | undefined): boolean {
  if (rawType === undefined) return true;
  const mime = String(rawType.split(";")[0]).trim().toLowerCase();
  return JS_MIME_TYPES.has(mime);
}

function hasModulePreload(rel: string | undefined): boolean {
  if (rel === undefined) return false;
  return rel.toLowerCase().split(/\s/u).includes("modulepreload");
}

function findScriptClose(
  source: string,
  from: number,
): { readonly body: string; readonly nextPos: number } {
  SCRIPT_CLOSE_RE.lastIndex = from;
  const match = SCRIPT_CLOSE_RE.exec(source);
  if (match === null) return { body: source.slice(from), nextPos: source.length };
  return { body: source.slice(from, match.index), nextPos: SCRIPT_CLOSE_RE.lastIndex };
}

interface ScanAcc {
  readonly inlineBodies: string[];
  readonly externalRefs: { readonly line: number; readonly target: string }[];
  hasIsland: boolean;
}

function handleScriptTag(
  source: string,
  tagEnd: number,
  line: number,
  attrs: ReadonlyMap<string, string>,
  acc: ScanAcc,
): number {
  const { body, nextPos } = findScriptClose(source, tagEnd);
  if (!isExecutableScriptType(attrs.get("type"))) return nextPos;
  const src = attrs.get("src");
  if (src !== undefined) {
    acc.externalRefs.push({ line, target: src });
    return nextPos;
  }
  if (body.trim() !== "") acc.inlineBodies.push(body);
  return nextPos;
}

function handleLinkTag(line: number, attrs: ReadonlyMap<string, string>, acc: ScanAcc): void {
  if (!hasModulePreload(attrs.get("rel"))) return;
  const href = attrs.get("href");
  if (href !== undefined) acc.externalRefs.push({ line, target: href });
}

function visitTag(
  source: string,
  lt: number,
  tag: string,
  attrText: string,
  tagEnd: number,
  acc: ScanAcc,
): number {
  if (tag === "astro-island") acc.hasIsland = true;
  const line = lineAt(source, lt);
  const attrs = parseAttributes(attrText);
  if (tag === "script") return handleScriptTag(source, tagEnd, line, attrs, acc);
  if (tag === "link") handleLinkTag(line, attrs, acc);
  return tagEnd;
}

function scanNext(source: string, lt: number, acc: ScanAcc): number {
  if (source.startsWith("<!--", lt)) return skipComment(source, lt);
  const tagEnd = findTagEnd(source, lt);
  const header = /^\s*([a-zA-Z][a-zA-Z0-9-]*)\b([\s\S]*)/u.exec(source.slice(lt + 1, tagEnd));
  if (header === null) return tagEnd;
  return visitTag(source, lt, String(header[1]).toLowerCase(), String(header[2]), tagEnd, acc);
}

/** Extracts inline JS script bodies, external `<script src>`, `<link rel="modulepreload">`, and island presence. */
export function extractPageScripts(source: string): PageScripts {
  const acc: ScanAcc = { inlineBodies: [], externalRefs: [], hasIsland: false };
  let lt = source.indexOf("<");
  while (lt !== -1) {
    lt = source.indexOf("<", scanNext(source, lt, acc));
  }
  return acc;
}
