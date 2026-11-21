import { field, readConfigDoc } from "../lock/config.ts";
import { isExpired } from "../survivors/dates.ts";
import { fromLedgerFile } from "./collect.ts";
import { readAckLedger } from "./ledger.ts";

const DEFAULT_LEDGER = ".web-tops/acks.yaml";

/** The ledger the config file names (`laws.ack_ledger`), else the default path. */
export function ledgerPath(cwd: string): string {
  const read = readConfigDoc(cwd);
  const named = read.state === "ok" ? field(read.doc, "laws", "ack_ledger") : undefined;
  return typeof named === "string" ? named : DEFAULT_LEDGER;
}

/** The files a law has a valid ledger entry for, or the problem that keeps the ledger from being read. */
export type AckedFiles =
  | { readonly ok: true; readonly files: readonly string[] }
  | {
      readonly ok: false;
      readonly rule: "ack-ledger-unreadable";
      readonly file: string;
      readonly message: string;
    };

/**
 * The files whose ledger entry for `law` is valid on `today` (`YYYY-MM-DD`, UTC): an entry covers its whole file,
 * and one past its `expires` covers nothing. A ledger that cannot be read is not an empty one: the caller gets the
 * `ack-ledger-unreadable` problem to report, not a list that would pass the files it could not check.
 */
export function ackedFiles(cwd: string, law: string, today: string): AckedFiles {
  const ledger = ledgerPath(cwd);
  const { acks, problems } = fromLedgerFile(readAckLedger(cwd, ledger), ledger);
  const unreadable = problems[0];
  if (unreadable !== undefined) {
    return { ok: false, rule: "ack-ledger-unreadable", file: ledger, message: unreadable.message };
  }
  const files = acks
    .filter((ack) => ack.law === law && !isExpired(ack.expires, today))
    .map((ack) => ack.file);
  return { ok: true, files: files.sort() };
}
