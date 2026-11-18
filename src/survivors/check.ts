import type { Problem } from "../config/types.ts";
import { readLedger } from "./store.ts";

/** The ledger path the config names when it names none. */
export const DEFAULT_LEDGER = ".web-tops/survivors.yaml";

/**
 * What `webtops check` says about the survivor ledger: nothing when the file is absent, empty or valid,
 * else each problem at a JSON pointer into the ledger file (a missing or blank `reason` or `owner`, a bad
 * `occurrence` or `expires`, a duplicate or unknown field, a path the kit refuses).
 */
export function checkLedger(directory: string, path: string = DEFAULT_LEDGER): Problem[] {
  const read = readLedger(directory, path);
  return read.ok ? [] : [...read.problems];
}
