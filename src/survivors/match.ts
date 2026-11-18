import { isExpired } from "./dates.ts";
import { keyString } from "./key.ts";
import type { SurvivorKey } from "./key.ts";
import type { Judgment, LedgerEntry } from "./types.ts";

/**
 * Sets the ledger against the survivors of a run, on `today` (UTC, `YYYY-MM-DD`). An entry accepts a
 * survivor only when all six key fields are equal and the entry has not expired. An expired entry stops
 * accepting, and fails itself (listed in `expired`) whether or not its survivor still exists, so the file
 * is cleaned. A live entry whose survivor is gone is `stale`: listed, not failing.
 */
export function judge(
  entries: readonly LedgerEntry[],
  survivors: readonly SurvivorKey[],
  today: string,
): Judgment {
  const live = entries.filter((entry) => !isExpired(entry.expires, today));
  const accepted = new Set(live.map((entry) => keyString(entry.key)));
  const present = new Set(survivors.map(keyString));
  return {
    explained: survivors.filter((survivor) => accepted.has(keyString(survivor))),
    unexplained: survivors.filter((survivor) => !accepted.has(keyString(survivor))),
    expired: entries.filter((entry) => isExpired(entry.expires, today)),
    stale: live.filter((entry) => !present.has(keyString(entry.key))),
  };
}
