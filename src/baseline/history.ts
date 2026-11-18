import { realExec } from "../gate/exec.ts";
import type { Exec } from "../gate/types.ts";
import { mergeBaseOf, showAt } from "../diff/git.ts";
import { ratchetBreaches } from "./compare.ts";
import { parseBaseline, readBaseline, type ReadResult } from "./read.ts";

export type HistoryResult =
  { readonly ok: true } | { readonly ok: false; readonly reasons: readonly string[] };

export interface HistoryOptions {
  readonly cwd: string;
  /** The baseline's path, relative to `cwd`. */
  readonly baselinePath: string;
  /** The ref the run is judged against, such as `origin/main`. */
  readonly base: string;
  readonly cap: number;
  readonly exec?: Exec;
}

const fail = (...reasons: string[]): HistoryResult => ({ ok: false, reasons });

/** The baseline at the merge base, or undefined when there was none (the first baseline). */
async function atMergeBase(
  exec: Exec,
  options: HistoryOptions,
  mergeBase: string,
): Promise<ReadResult | undefined> {
  const before = await showAt(exec, options.cwd, mergeBase, `./${options.baselinePath}`);
  return before.ok
    ? parseBaseline(before.value, `${options.baselinePath} at the merge base`)
    : undefined;
}

function compared(options: HistoryOptions, then: ReadResult): HistoryResult {
  if (!then.ok) return fail(then.reason);
  const now = readBaseline(options.cwd, options.baselinePath);
  if (!now.ok)
    return fail(`the baseline is gone or invalid: ${now.reason}; deleting it is not a reset`);
  const breaches = ratchetBreaches(then.baseline, now.baseline, options.cap);
  return breaches.length === 0
    ? { ok: true }
    : fail(...breaches.map((breach) => `the baseline rose: ${breach.message}`));
}

/**
 * The baseline across a change (WEB_TOPS.md section 6.7): it may be tightened and never loosened, so a change
 * that regenerates it with a higher count, a worse function, lower coverage or more suppressions fails against the
 * merge base's copy, and deleting it is not a reset. The first baseline, with none at the merge base, is
 * accepted: legacy findings stay in it. A shallow clone or a missing base is a failure, as it is for the diff.
 */
export async function baselineHistory(options: HistoryOptions): Promise<HistoryResult> {
  const exec = options.exec ?? realExec;
  const base = await mergeBaseOf(exec, options.cwd, options.base);
  if (!base.ok) return fail(base.reason);
  const then = await atMergeBase(exec, options, base.value);
  return then === undefined ? { ok: true } : compared(options, then);
}
