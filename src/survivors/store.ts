import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { isScalar, isSeq, parseDocument } from "yaml";
import type { Document, YAMLMap } from "yaml";
import { keyString } from "./key.ts";
import { LEDGER_VERSION, parseLedger } from "./ledger.ts";
import { resolveLedgerPath } from "./path.ts";
import type { LedgerEntry, LedgerRead } from "./types.ts";

/** Said at the top of a ledger this kit creates, so a person reading it knows what a key is (WEB_TOPS.md 6.4). */
const HEADER = [
  "# .web-tops/survivors.yaml: mutants a test does not kill and a person has accepted (WEB_TOPS.md 6.4).",
  "# An entry is keyed by file, function, mutator, original, replacement and occurrence, never by a line.",
  "# `original` is the exact source text the mutator replaced, as written, so editing that text makes a",
  "# new key and the old entry stops matching. Add entries with `webtops survivors explain`; every entry",
  "# needs a reason and an owner, and may carry `expires` (YYYY-MM-DD, UTC, valid through that day).",
  "",
].join("\n");

const refused = (message: string): LedgerRead => ({
  ok: false,
  problems: [{ pointer: "", message }],
});

/** Reads the ledger the config names. No file is an empty ledger; a link, a directory or a bad path is refused. */
export function readLedger(directory: string, path: string): LedgerRead {
  const located = resolveLedgerPath(directory, path);
  if (!located.ok) return refused(located.message);
  if (!existsSync(located.path)) return { ok: true, entries: [], text: undefined };
  const text = readFileSync(located.path, "utf8");
  const parsed = parseLedger(text);
  return parsed.ok ? { ok: true, entries: parsed.entries, text } : parsed;
}

/** One entry as the plain map the file holds, its fields in the order a person reads them. */
function plain(entry: LedgerEntry): Record<string, string | number> {
  const { key } = entry;
  const fields: Record<string, string | number> = {
    file: key.file,
    function: key.function,
    mutator: key.mutator,
    original: key.original,
    replacement: key.replacement,
    occurrence: key.occurrence,
    reason: entry.reason,
    owner: entry.owner,
  };
  if (entry.expires !== undefined) fields["expires"] = entry.expires;
  return fields;
}

const order = (entry: LedgerEntry): string => {
  const { key } = entry;
  const nth = String(key.occurrence).padStart(9, "0");
  return JSON.stringify([key.file, key.function, key.mutator, key.original, key.replacement, nth]);
};

const before = (a: LedgerEntry, b: LedgerEntry): boolean => order(a) < order(b);

/** Where a new entry goes: before the first entry that sorts after it, else last. */
function slotFor(entry: LedgerEntry, existing: readonly LedgerEntry[]): number {
  const index = existing.findIndex((other) => before(entry, other));
  return index < 0 ? existing.length : index;
}

/** The fields written as double-quoted text, so what a mutant replaced reads back exactly as written. */
const ALWAYS_QUOTED = ["original", "replacement"];

function quote(node: YAMLMap, name: string): void {
  const value = node.get(name, true);
  if (isScalar(value)) value.type = "QUOTE_DOUBLE";
}

/**
 * One entry as a YAML map, its original and replacement as double-quoted scalars. A reason or owner with a
 * line break is quoted too: a plain or block scalar can lose a space before the break.
 */
function entryNode(doc: Document, entry: LedgerEntry) {
  const node = doc.createNode(plain(entry));
  ALWAYS_QUOTED.forEach((name) => {
    quote(node, name);
  });
  if (entry.reason.includes("\n")) quote(node, "reason");
  if (entry.owner.includes("\n")) quote(node, "owner");
  return node;
}

function blockList(doc: Document, entries: readonly LedgerEntry[]) {
  const list = doc.createNode(entries.map((entry) => entryNode(doc, entry)));
  list.flow = false;
  return list;
}

/** The text of a ledger that did not exist: the header, the version and the one entry. */
const fresh = (entry: LedgerEntry): string => {
  const doc = parseDocument("");
  doc.set("version", LEDGER_VERSION);
  doc.set("survivors", blockList(doc, [entry]));
  return `${HEADER}${String(doc)}`;
};

/** The existing text with the entry added in its place, or put over the entry that has its key. */
function amended(text: string, entry: LedgerEntry, existing: readonly LedgerEntry[]): string {
  const doc = parseDocument(text, { uniqueKeys: true, merge: false });
  const list = doc.get("survivors", true);
  const at = existing.findIndex((other) => keyString(other.key) === keyString(entry.key));
  if (!isSeq(list) || list.items.length === 0) doc.set("survivors", blockList(doc, [entry]));
  else if (at >= 0) list.items[at] = entryNode(doc, entry);
  else list.items.splice(slotFor(entry, existing), 0, entryNode(doc, entry));
  return String(doc);
}

export type Recorded =
  | { readonly ok: true; readonly replaced: boolean }
  | { readonly ok: false; readonly message: string };

/** Writes next to the target and renames over it, so a failed write leaves the ledger as it was. */
function writeAtomically(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${String(process.pid)}.tmp`);
  try {
    writeFileSync(temporary, text, { flag: "w" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

const sameKey = (a: LedgerEntry, b: LedgerEntry): boolean => keyString(a.key) === keyString(b.key);

/** The text the ledger holds after the entry is recorded. */
function nextText(
  read: { readonly entries: readonly LedgerEntry[]; readonly text: string | undefined },
  entry: LedgerEntry,
): string {
  const { text } = read;
  return text === undefined || text.trim() === ""
    ? fresh(entry)
    : amended(text, entry, read.entries);
}

/** The reason the file could not be written, or undefined once it is. */
function tryWrite(path: string, text: string): string | undefined {
  try {
    writeAtomically(path, text);
    return undefined;
  } catch (error) {
    const why = error instanceof Error ? error.message : "unknown error";
    return `could not write ${path}: ${why}`;
  }
}

/**
 * Records one entry: adds it in sorted place, or replaces the entry that has the same key (reason, owner
 * and expiry change; the key never does). Nothing is written unless the ledger as it stands is valid and
 * the path is allowed; the other entries and the comments are kept. A write that fails is reported, and
 * leaves the ledger as it was.
 */
export function recordEntry(directory: string, path: string, entry: LedgerEntry): Recorded {
  const located = resolveLedgerPath(directory, path);
  if (!located.ok) return { ok: false, message: located.message };
  const read = readLedger(directory, path);
  if (!read.ok)
    return { ok: false, message: read.problems.map((found) => found.message).join("; ") };
  const failed = tryWrite(located.path, nextText(read, entry));
  if (failed !== undefined) return { ok: false, message: failed };
  return { ok: true, replaced: read.entries.some((other) => sameKey(other, entry)) };
}
