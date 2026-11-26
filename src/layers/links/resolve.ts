import { posix } from "node:path";
import type { DistInventory } from "../build/index.ts";
import type { HtmlReference, ParsedHtml } from "./parse.ts";

/** One broken link, fragment anchor, or local asset finding before formatting. */
export interface BrokenReference {
  readonly file: string;
  readonly line: number;
  readonly attr: HtmlReference["attr"];
  readonly target: string;
  readonly reason: string;
}

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u;

function isExternalTarget(trimmed: string): boolean {
  return trimmed.startsWith("//") || SCHEME_RE.test(trimmed);
}

function decodePart(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

interface SplitTarget {
  readonly rawPath: string;
  readonly fragment: string | undefined;
}

function stripQuery(text: string): string {
  const q = text.indexOf("?");
  return q === -1 ? text : text.slice(0, q);
}

function splitTarget(trimmed: string): SplitTarget | undefined {
  const hash = trimmed.indexOf("#");
  if (hash === -1) return { rawPath: stripQuery(trimmed), fragment: undefined };
  const fragment = decodePart(trimmed.slice(hash + 1));
  return fragment === undefined
    ? undefined
    : { rawPath: stripQuery(trimmed.slice(0, hash)), fragment };
}

function resolveDistPath(sourceFile: string, decodedPath: string): string {
  const joined = decodedPath.startsWith("/")
    ? decodedPath
    : posix.join(posix.dirname(sourceFile), decodedPath);
  return posix.normalize(joined).replace(/^\//u, "");
}

function pushExtensionless(candidates: string[], cleanPath: string, stripped: string): void {
  if (!cleanPath.endsWith("/") && posix.extname(stripped) === "") {
    candidates.push(`${stripped}.html`);
  }
}

function matchCandidates(cleanPath: string): string[] {
  const stripped = cleanPath.replace(/\/$/u, "");
  if (stripped === "" || stripped === ".") return ["index.html"];
  const candidates = [cleanPath, `${stripped}/index.html`];
  pushExtensionless(candidates, cleanPath, stripped);
  return candidates;
}

function matchTargetFile(cleanPath: string, files: ReadonlySet<string>): string | undefined {
  return matchCandidates(cleanPath).find((candidate) => files.has(candidate));
}

function hasAnchor(
  targetFile: string,
  fragment: string,
  pageAnchors: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  return pageAnchors.get(targetFile)?.has(fragment) === true;
}

function checkAnchor(
  ref: HtmlReference,
  sourceFile: string,
  targetFile: string,
  fragment: string | undefined,
  pageAnchors: ReadonlyMap<string, ReadonlySet<string>>,
): BrokenReference | undefined {
  if (fragment === undefined || fragment === "") return undefined;
  if (hasAnchor(targetFile, fragment, pageAnchors)) return undefined;
  return {
    file: sourceFile,
    line: ref.line,
    attr: ref.attr,
    target: ref.target,
    reason: `broken #${fragment} anchor in ${targetFile} (referenced as "${ref.target}")`,
  };
}

function resolveNonEmptyPath(
  ref: HtmlReference,
  sourceFile: string,
  rawPath: string,
  files: ReadonlySet<string>,
): string | BrokenReference {
  const decoded = decodePart(rawPath);
  if (decoded === undefined) {
    return {
      file: sourceFile,
      line: ref.line,
      attr: ref.attr,
      target: ref.target,
      reason: `malformed URL encoding in "${ref.target}"`,
    };
  }
  const clean = resolveDistPath(sourceFile, decoded);
  const matched = matchTargetFile(clean, files);
  if (matched !== undefined) return matched;
  return {
    file: sourceFile,
    line: ref.line,
    attr: ref.attr,
    target: ref.target,
    reason: `missing local target "${ref.target}"`,
  };
}

function checkEmptyTarget(ref: HtmlReference, sourceFile: string): BrokenReference | undefined {
  if (ref.attr === "href") return undefined;
  return {
    file: sourceFile,
    line: ref.line,
    attr: ref.attr,
    target: ref.target,
    reason: `empty ${ref.attr} asset target`,
  };
}

function evaluateSplit(
  ref: HtmlReference,
  sourceFile: string,
  parts: SplitTarget,
  inventoryFiles: ReadonlySet<string>,
  pageAnchors: ReadonlyMap<string, ReadonlySet<string>>,
): BrokenReference | undefined {
  if (parts.rawPath === "") {
    return checkAnchor(ref, sourceFile, sourceFile, parts.fragment, pageAnchors);
  }
  const target = resolveNonEmptyPath(ref, sourceFile, parts.rawPath, inventoryFiles);
  if (typeof target !== "string") return target;
  return checkAnchor(ref, sourceFile, target, parts.fragment, pageAnchors);
}

/** Validates one HTML reference against the `dist/` file set and parsed HTML anchors. */
export function checkReference(
  ref: HtmlReference,
  sourceFile: string,
  inventoryFiles: ReadonlySet<string>,
  pageAnchors: ReadonlyMap<string, ReadonlySet<string>>,
): BrokenReference | undefined {
  const trimmed = ref.target.trim();
  if (trimmed === "") return checkEmptyTarget(ref, sourceFile);
  if (isExternalTarget(trimmed)) return undefined;
  const parts = splitTarget(trimmed);
  if (parts === undefined) {
    return {
      file: sourceFile,
      line: ref.line,
      attr: ref.attr,
      target: ref.target,
      reason: `malformed fragment encoding in "${ref.target}"`,
    };
  }
  return evaluateSplit(ref, sourceFile, parts, inventoryFiles, pageAnchors);
}

export interface LinksCheckSummary {
  readonly checkedRefs: number;
  readonly broken: readonly BrokenReference[];
}

function checkPageRefs(
  refs: readonly HtmlReference[],
  sourceFile: string,
  files: ReadonlySet<string>,
  anchors: ReadonlyMap<string, ReadonlySet<string>>,
  broken: BrokenReference[],
): number {
  for (const ref of refs) {
    const issue = checkReference(ref, sourceFile, files, anchors);
    if (issue !== undefined) broken.push(issue);
  }
  return refs.length;
}

/** Validates every internal link, `#anchor`, and local asset reference across all parsed `dist/` pages. */
export function checkAllPages(
  inventory: DistInventory,
  parsedByFile: ReadonlyMap<string, ParsedHtml>,
): LinksCheckSummary {
  const files = new Set(inventory.files);
  const anchors = new Map<string, ReadonlySet<string>>();
  for (const [file, parsed] of parsedByFile) anchors.set(file, parsed.anchors);
  const broken: BrokenReference[] = [];
  let checkedRefs = 0;
  for (const page of inventory.pages) {
    const parsed = parsedByFile.get(page.file);
    if (parsed !== undefined) {
      checkedRefs += checkPageRefs(parsed.refs, page.file, files, anchors, broken);
    }
  }
  return { checkedRefs, broken };
}
