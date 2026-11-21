import { compareSnapshots } from "./compare.ts";
import type { Renames } from "./levels.ts";
import type { DiffReport, Snapshot } from "./types.ts";

export interface Checkout {
  readonly dir: string;
  readonly cleanup: () => Promise<void>;
}

/** What the diff needs of the world: the merge base, a checkout of a ref, and the snapshot of a checkout. */
export interface Deps {
  readonly mergeBase: (base: string, head: string) => Promise<string | { readonly error: string }>;
  readonly checkout: (ref: string) => Promise<Checkout>;
  readonly snapshot: (dir: string, extra: readonly string[]) => Promise<Snapshot>;
  /** The files the PR renamed, by their new path, and the path each had. */
  readonly renames: (base: string, head: string) => Promise<Renames | { readonly error: string }>;
}

export type DiffOutcome =
  | { readonly ok: true; readonly report: DiffReport }
  | { readonly ok: false; readonly message: string };

async function snapshotAt(deps: Deps, ref: string, extra: readonly string[]): Promise<Snapshot> {
  const made = await deps.checkout(ref);
  try {
    return await deps.snapshot(made.dir, extra);
  } finally {
    await made.cleanup();
  }
}

/**
 * The diff of `head` against its merge base with `base`: both refs are checked out, each surface is read at each,
 * and every surface is compared. The merge base is what the PR changed from, not whatever `base` has moved to since.
 * The head is read first: its files are what the base's ESLint is then asked about, so a file the PR adds is held to
 * what the base said of its path.
 */
export async function lawDiff(deps: Deps, base: string, head: string): Promise<DiffOutcome> {
  const merged = await deps.mergeBase(base, head);
  if (typeof merged !== "string") return { ok: false, message: merged.error };
  const renames = await deps.renames(merged, head);
  if ("error" in renames) return { ok: false, message: renames.error };
  const after = await snapshotAt(deps, head, []);
  const before = await snapshotAt(deps, merged, after.tracked);
  return {
    ok: true,
    report: { base, head, mergeBase: merged, surfaces: compareSnapshots(before, after, renames) },
  };
}
