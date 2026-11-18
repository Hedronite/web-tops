import { readBaseline } from "./read.ts";

/** What a layer knows of the run: the mode, the project, and the baseline the config names. */
export interface RatchetContext {
  readonly enforce: string;
  readonly cwd: string;
  readonly config: { readonly baselinePath?: string };
}

/**
 * Whether the run is held to a baseline: `ratchet`, with a baseline that can be read. Then the ratchet decides what
 * is above it, and a layer reports what it measured without its absolute floor or cap (WEB_TOPS.md section 6.7).
 * With no baseline yet, a `ratchet` run is judged as a `hard` run is: that is how the first baseline is measured.
 */
export function ratchetHeld(context: RatchetContext): boolean {
  const path = context.config.baselinePath;
  return context.enforce === "ratchet" && path !== undefined && readBaseline(context.cwd, path).ok;
}

/**
 * A finding a baseline counts and a held ratchet may hold: a tool's own, with a place in a file. A failure of the
 * gate's own (a tool that cannot run, a config error, a step that failed) is not one, and a finding with no file
 * has nothing to count it by.
 */
export function isCountable(finding: {
  readonly tool: string;
  readonly file?: string | null | undefined;
}): boolean {
  return finding.tool !== "webtops" && finding.file !== undefined && finding.file !== null;
}
