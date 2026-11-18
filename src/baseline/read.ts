import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateBaseline } from "./schema.ts";
import type { Baseline } from "./types.ts";

export type ReadResult =
  | { readonly ok: true; readonly baseline: Baseline }
  | { readonly ok: false; readonly reason: string; readonly missing?: true };

/** Parses and validates the text of a baseline; `shown` names it in the reason. */
export function parseBaseline(text: string, shown: string): ReadResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: `${shown} is not valid JSON` };
  }
  const checked = validateBaseline(value);
  if (checked.ok) return { ok: true, baseline: checked.value };
  const where = checked.problems.map(
    (problem) => `${problem.pointer || "(document)"}: ${problem.message}`,
  );
  return { ok: false, reason: `${shown} is not a valid baseline: ${where.join("; ")}` };
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT";
}

/**
 * Reads the baseline at `path` (relative to `cwd`). A file that is not there is `missing`: the state a project is in
 * before its first baseline (WEB_TOPS.md section 6.7), which is not the same as a file that cannot be read or is invalid.
 */
export function readBaseline(cwd: string, path: string): ReadResult {
  try {
    return parseBaseline(readFileSync(resolve(cwd, path), "utf8"), path);
  } catch (error) {
    const reason = `${path} cannot be read`;
    return isMissing(error)
      ? { ok: false, reason: `${reason}: the baseline is missing`, missing: true }
      : { ok: false, reason };
  }
}

/** The state before a project's first baseline: the file is not there (not a file that is there and unreadable). */
export const isMissingBaseline = (read: ReadResult): boolean => !read.ok && read.missing === true;
