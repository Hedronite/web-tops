import type { Problem } from "../config/types.ts";
import type { SurvivorKey } from "./key.ts";

/** One accepted survivor: the six key fields beside why, who and until when (WEB_TOPS.md 6.4). */
export interface LedgerEntry {
  readonly key: SurvivorKey;
  readonly reason: string;
  readonly owner: string;
  /** `YYYY-MM-DD`, UTC, valid through that day; none means it does not expire. */
  readonly expires: string | undefined;
}

export type LedgerParse =
  | { readonly ok: true; readonly entries: readonly LedgerEntry[] }
  | { readonly ok: false; readonly problems: readonly Problem[] };

/** The ledger as a file: its entries and the text they came from (none when the file does not exist yet). */
export type LedgerRead =
  | {
      readonly ok: true;
      readonly entries: readonly LedgerEntry[];
      readonly text: string | undefined;
    }
  | { readonly ok: false; readonly problems: readonly Problem[] };

/** How a ledger and a set of survivors stand to each other on one day. */
export interface Judgment {
  /** Survivors a live entry accepts. */
  readonly explained: readonly SurvivorKey[];
  /** Survivors no live entry accepts: the ones that count against `unexplained_survivors_max`. */
  readonly unexplained: readonly SurvivorKey[];
  /** Entries past their `expires`, whether or not their survivor still exists: each one fails. */
  readonly expired: readonly LedgerEntry[];
  /** Live entries whose survivor is not in the set: listed, never failing. */
  readonly stale: readonly LedgerEntry[];
}
