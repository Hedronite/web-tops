import type { Problem, WebTopsConfig } from "../config/types.ts";
import { capFor } from "./cap.ts";
import { baselineHistory } from "./history.ts";

/** The ref a ratchet run is judged against when the config names none. */
export const DEFAULT_BASE = "origin/main";

const baseOf = (config: WebTopsConfig): string => config.gates?.mutation?.base ?? DEFAULT_BASE;

/** The cap a ratchet run holds a new function to; undefined for the modes that read no baseline. */
const ratchetCap = (config: WebTopsConfig): number | undefined =>
  config.enforce === "ratchet" ? capFor(config.class) : undefined;

/**
 * Under `ratchet` the baseline may only tighten across the change: it is held to the merge base's copy
 * (WEB_TOPS.md section 6.7). Other modes read no baseline. `check` and the gate both ask.
 */
export async function configHistoryProblems(
  config: WebTopsConfig,
  dir: string,
): Promise<readonly Problem[]> {
  const cap = ratchetCap(config);
  if (cap === undefined) return [];
  const history = await baselineHistory({
    cwd: dir,
    baselinePath: config.baseline,
    base: baseOf(config),
    cap,
  });
  return history.ok ? [] : history.reasons.map((message) => ({ pointer: "/baseline", message }));
}
