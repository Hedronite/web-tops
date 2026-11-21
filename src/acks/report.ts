import { fromLedgerFile, lawProblems } from "./collect.ts";
import { readAckLedger } from "./ledger.ts";
import type { SeverityOf } from "./severity.ts";

/**
 * The problems of the ack ledger `named`, headed with its path, for `webtops check`: a ledger that cannot be read, and an
 * entry for a law that is hard or is not one. None when the ledger is absent or sound. The severity of the laws is
 * asked for only when the ledger has entries.
 */
export function ackLedgerReport(
  directory: string,
  named: string,
  severity: () => SeverityOf,
): string | undefined {
  const found = fromLedgerFile(readAckLedger(directory, named), named);
  const wrong = found.acks.length === 0 ? [] : lawProblems(found.acks, severity(), named);
  const lines = [...found.problems, ...wrong].map(
    (problem) => `  ${problem.rule}: ${problem.message}\n`,
  );
  return lines.length === 0 ? undefined : `${named}: invalid\n${lines.join("")}`;
}
