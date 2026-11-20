import { createHash } from "node:crypto";
import type { Finding, Tool, Verdict } from "../config/report.ts";

export { COUNTED_LAYERS, countsByRuleFile } from "../config/report.ts";

/** What a layer says about a problem; the runner completes it into a `Finding` (WEB_TOPS.md section 6.6). */
export interface RawFinding {
  readonly tool: Tool;
  readonly rule: string;
  readonly verdict: Verdict;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly law?: string;
  readonly required?: boolean;
  readonly ack?: Finding["ack"];
  readonly survivor?: Finding["survivor"];
}

/** A flagged line as an anchor: trimmed, with every run of whitespace one space. */
export function anchorOf(text: string): string {
  return text.trim().replace(/\s+/gu, " ");
}

export interface FingerprintParts {
  readonly tool: string;
  readonly rule: string;
  readonly file: string | null;
  readonly anchor: string;
  /** The 1-based order of this finding among those with the same tool, rule, file and anchor. */
  readonly occurrence: number;
}

/** `fp1:` and 16 hex characters of SHA-256 over the parts; the prefix names the algorithm. */
export function fingerprint(parts: FingerprintParts): string {
  const text = [parts.tool, parts.rule, parts.file ?? "", parts.anchor, String(parts.occurrence)];
  return `fp1:${createHash("sha256").update(text.join("\0")).digest("hex").slice(0, 16)}`;
}

type Reader = (file: string) => string | undefined;

/** The text of the line a finding points at, when it has a file and a line and the file can be read. */
function lineOf(raw: RawFinding, read: Reader): string | undefined {
  if (raw.file === undefined || raw.line === undefined) {
    return undefined;
  }
  return read(raw.file)?.split("\n")[raw.line - 1];
}

/** The flagged line, or the message when there is no readable line to anchor on. */
function anchorFor(raw: RawFinding, read: Reader): string {
  const anchor = anchorOf(lineOf(raw, read) ?? "");
  return anchor === "" ? anchorOf(raw.message) : anchor;
}

function groupKey(raw: RawFinding, anchor: string): string {
  return [raw.tool, raw.rule, raw.file ?? "", anchor].join("\0");
}

function lineAt(raws: readonly RawFinding[], index: number): number {
  return raws[index]?.line ?? 0;
}

function byLine(raws: readonly RawFinding[]): (left: number, right: number) => number {
  return (left, right) => lineAt(raws, left) - lineAt(raws, right);
}

interface Anchored {
  readonly raw: RawFinding;
  readonly anchor: string;
}

/** Each finding's order among its repeats, by line and then by the order the tool listed them. */
function occurrences(found: readonly Anchored[]): number[] {
  const raws = found.map((item) => item.raw);
  const groups = new Map<string, number[]>();
  found.forEach(({ raw, anchor }, index) => {
    const key = groupKey(raw, anchor);
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  const order = raws.map(() => 1);
  for (const members of groups.values()) {
    members.sort(byLine(raws)).forEach((index, position) => {
      order[index] = position + 1;
    });
  }
  return order;
}

function placeOf(raw: RawFinding): { file: string | null; line: number | null } {
  return { file: raw.file ?? null, line: raw.line ?? null };
}

function extrasOf(raw: RawFinding): Pick<Finding, "required" | "ack" | "survivor"> {
  return {
    ...(raw.required === undefined ? {} : { required: raw.required }),
    ...(raw.ack === undefined ? {} : { ack: raw.ack }),
    ...(raw.survivor === undefined ? {} : { survivor: raw.survivor }),
  };
}

function complete(raw: RawFinding, anchor: string, occurrence: number): Finding {
  const place = placeOf(raw);
  return {
    tool: raw.tool,
    rule: raw.rule,
    law: raw.law ?? null,
    verdict: raw.verdict,
    message: raw.message,
    ...place,
    fingerprint: fingerprint({
      tool: raw.tool,
      rule: raw.rule,
      file: place.file,
      anchor,
      occurrence,
    }),
    ...extrasOf(raw),
  };
}

/**
 * Gives every finding the one shape: `law` null until a reader maps one, a place or null, and a fingerprint
 * anchored on the flagged line (WEB_TOPS.md section 6.6). `read` returns a file's text, or undefined.
 */
export function completeFindings(raws: readonly RawFinding[], read: Reader): Finding[] {
  const found = raws.map((raw) => ({ raw, anchor: anchorFor(raw, read) }));
  const order = occurrences(found);
  return found.map(({ raw, anchor }, index) => complete(raw, anchor, order[index] ?? 1));
}
