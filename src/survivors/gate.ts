import type { RawFinding } from "../report/findings.ts";
import { isExpired } from "./dates.ts";
import { keyString } from "./key.ts";
import { readLedger } from "./store.ts";
import type { LedgerEntry } from "./types.ts";

/** What the gate takes from the survivor ledger: the keys it accepts today, and what it fails on its own. */
export interface LedgerState {
  /** The `keyString` of every survivor a live entry accepts: the mutation layer's `LayerContext.explained`. */
  readonly explained: ReadonlySet<string>;
  /** A failing finding for each problem in the file and for each entry past its date, whatever became of its survivor. */
  readonly findings: readonly RawFinding[];
}

const failure = (rule: string, message: string, file: string): RawFinding => ({
  tool: "webtops",
  rule,
  verdict: "fail",
  message,
  file,
});

const pointerOf = (pointer: string): string => (pointer === "" ? "(document)" : pointer);

function expiredFinding(entry: LedgerEntry, ledger: string): RawFinding {
  const { key } = entry;
  const what = `${key.mutator} on ${key.function}`;
  const until = `${entry.expires ?? ""}, owned by ${entry.owner}`;
  return failure(
    "ledger-expired",
    `the survivor ledger entry for ${what} expired on ${until}: kill the mutant with a test, or renew the entry with webtops survivors explain`,
    ledger,
  );
}

/**
 * Reads the ledger for a gate run on `today` (UTC, `YYYY-MM-DD`). A file that is not a valid ledger accepts
 * nothing and fails once per problem; an expired entry stops accepting and fails itself, so the file is
 * cleaned even when the survivor has gone (WEB_TOPS.md section 6.4). No file is an empty ledger.
 */
export function ledgerState(cwd: string, ledger: string, today: string): LedgerState {
  const read = readLedger(cwd, ledger);
  if (!read.ok) {
    const findings = read.problems.map((found) =>
      failure("ledger-invalid", `${pointerOf(found.pointer)}: ${found.message}`, ledger),
    );
    return { explained: new Set(), findings };
  }
  const live = read.entries.filter((entry) => !isExpired(entry.expires, today));
  const expired = read.entries.filter((entry) => isExpired(entry.expires, today));
  return {
    explained: new Set(live.map((entry) => keyString(entry.key))),
    findings: expired.map((entry) => expiredFinding(entry, ledger)),
  };
}
