import { isExpired } from "../survivors/dates.ts";
import type { Finding } from "../config/report.ts";
import type { LedgerAck } from "./ledger.ts";
import type { SeverityOf } from "./severity.ts";

/** An acknowledgement of one law, from a source comment (with its line) or from the ledger. */
export interface Ack {
  readonly source: "comment" | "ledger";
  readonly law: string;
  readonly file: string;
  readonly line?: number;
  readonly reason: string;
  readonly expires?: string;
}

export const fromLedger = (entry: LedgerAck): Ack => ({
  source: "ledger",
  law: entry.law,
  file: entry.file,
  reason: entry.reason,
  ...(entry.expires === undefined ? {} : { expires: entry.expires }),
});

/** A comment covers a finding on its own line or the line below it. */
const nearLine = (ack: Ack, line: number | undefined): boolean =>
  line !== undefined && (ack.line === line || ack.line === line - 1);

/** Whether the ack covers a finding of `law` in `file` at `line`: a comment, on the line or just above it; a ledger entry, anywhere in the file. */
const covers = (ack: Ack, law: string, file: string, line: number | undefined): boolean =>
  ack.law === law && ack.file === file && (ack.source === "ledger" || nearLine(ack, line));

/**
 * The acknowledgement that turns a soft-law finding from `ack-missing` into `pass` (WEB_TOPS.md section 3.3), as
 * the `ack` the report carries, or undefined. A ledger entry past its `expires` acknowledges nothing, and neither does
 * any ack of a law that `lawProblem` rejects (a hard law, an id that is no law): a caller that does not filter them
 * out still gets no acknowledgement.
 */
export function ackFor(
  acks: readonly Ack[],
  law: string,
  file: string,
  line: number | undefined,
  today: string,
  severity: SeverityOf,
): Finding["ack"] | undefined {
  if (lawProblem(law, severity) !== undefined) return undefined;
  const found = acks.find((ack) => covers(ack, law, file, line) && !isExpired(ack.expires, today));
  return found === undefined ? undefined : { source: found.source, reason: found.reason };
}

/** What an ack of a law needs to be, from the law's severity: only a soft law (`A`) takes one. */
export function lawProblem(
  law: string,
  severityOf: SeverityOf,
): { readonly rule: string; readonly message: string } | undefined {
  const severity = severityOf(law);
  if (severity === undefined) return { rule: "ack-unknown-law", message: `${law} is not a law` };
  return severity === "A"
    ? undefined
    : {
        rule: "ack-not-needed",
        message: `${law} is a hard law: a break is refused, and no acknowledgement turns it into a pass`,
      };
}
