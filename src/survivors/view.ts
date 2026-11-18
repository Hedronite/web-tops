import { createHash } from "node:crypto";
import { daysLeft, isExpired } from "./dates.ts";
import { keyString } from "./key.ts";
import type { SurvivorKey } from "./key.ts";
import type { Judgment, LedgerEntry } from "./types.ts";

/** The short name `list` prints for a survivor and `explain` takes: ten hex characters of the key's hash. */
export const survivorId = (key: SurvivorKey): string =>
  createHash("sha256").update(keyString(key)).digest("hex").slice(0, 10);

export type Status = "ok" | "expired" | "stale";

export interface Row {
  readonly id: string;
  readonly status: Status;
  readonly entry: LedgerEntry;
  /** Days until `expires`: 0 on the day itself, negative once past; none without an expiry. */
  readonly daysLeft: number | undefined;
}

/** `stale` is only known when a report was read: without one, a live entry is `ok`. */
function statusOf(entry: LedgerEntry, today: string, stale: boolean): Status {
  if (isExpired(entry.expires, today)) return "expired";
  return stale ? "stale" : "ok";
}

export function rowsOf(
  entries: readonly LedgerEntry[],
  judgment: Judgment,
  today: string,
  reported: boolean,
): Row[] {
  return entries.map((entry) => ({
    id: survivorId(entry.key),
    status: statusOf(entry, today, reported && judgment.stale.includes(entry)),
    entry,
    daysLeft: daysLeft(entry.expires, today),
  }));
}

const quoted = (text: string): string => JSON.stringify(text);

/** `id  function  mutator  "original" -> "replacement" #occurrence` */
export const keyLine = (key: SurvivorKey): string =>
  `${survivorId(key)}  ${key.function}  ${key.mutator}  ${quoted(key.original)} -> ${quoted(key.replacement)} #${String(key.occurrence)}`;

export const days = (count: number): string => `${String(count)} day${count === 1 ? "" : "s"}`;

const inDays = (count: number): string => (count === 0 ? "today" : `in ${days(count)}`);

function expiryText(row: Row): string {
  const { expires } = row.entry;
  if (expires === undefined || row.daysLeft === undefined) return "no expiry";
  if (row.daysLeft < 0) return `expired ${expires} (${days(-row.daysLeft)} ago)`;
  return `expires ${expires} (${inDays(row.daysLeft)})`;
}

/** An entry as three lines: its key, who and until when, and why. */
export function rowText(row: Row): string {
  const label = row.status.padEnd(8);
  return [
    `  ${label} ${keyLine(row.entry.key)}`,
    `  ${" ".repeat(8)} owner ${row.entry.owner}; ${expiryText(row)}`,
    `  ${" ".repeat(8)} reason: ${row.entry.reason}`,
  ].join("\n");
}

/** One entry as the object `list --json` prints. */
export function rowObject(row: Row): Record<string, unknown> {
  const { key, reason, owner, expires } = row.entry;
  return {
    id: row.id,
    status: row.status,
    ...key,
    reason,
    owner,
    expires: expires ?? null,
    daysLeft: row.daysLeft ?? null,
  };
}

export const keyObject = (key: SurvivorKey): Record<string, unknown> => ({
  id: survivorId(key),
  ...key,
});
