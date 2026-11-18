import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateBaseline } from "./schema.ts";
import type { Baseline } from "./types.ts";

export type ReadResult =
  | { readonly ok: true; readonly baseline: Baseline }
  | { readonly ok: false; readonly reason: string };

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

/** Reads the baseline at `path` (relative to `cwd`); a file that is missing is a reason, not an empty baseline. */
export function readBaseline(cwd: string, path: string): ReadResult {
  try {
    return parseBaseline(readFileSync(resolve(cwd, path), "utf8"), path);
  } catch {
    return { ok: false, reason: `${path} cannot be read: the baseline is missing` };
  }
}
