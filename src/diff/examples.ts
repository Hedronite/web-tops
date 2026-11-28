/**
 * An example that gates itself: a project under the top-level `examples/` that tracks its own `web-tops.yaml`. The diff
 * (WEB_TOPS.md section 6.4) and W-04's compiler file set (section 6.5) both leave such a project out, by this one rule,
 * so the two cannot drift.
 */

/** The folder `examples/<name>` of a file under it: one level under the top-level `examples/`, and nowhere else. */
const EXAMPLE = /^(examples\/[^/]+)\//u;

/** Whether the folder `examples/<name>` is a project that gates itself. */
export type OwnsConfig = (folder: string) => boolean;

/** It is when its `web-tops.yaml` is a tracked file: one that only lies in the work tree exempts nothing. */
export const ownsTrackedConfig =
  (tracked: ReadonlySet<string>): OwnsConfig =>
  (folder) =>
    tracked.has(`${folder}/web-tops.yaml`);

/** The example that gates itself and holds this path, if one does. */
export function selfGatedExample(path: string, owns: OwnsConfig): string | undefined {
  const folder = EXAMPLE.exec(path)?.[1];
  return folder !== undefined && owns(folder) ? folder : undefined;
}
