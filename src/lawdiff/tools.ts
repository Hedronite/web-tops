import { TOOL_PINS } from "../lock/pins.ts";
import type { Change, Item } from "./types.ts";

function exact(): RegExp {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
}

/** A version that names one release: no range, no tag, no path. */
export const isExact = (version: string): boolean => exact().test(version);

/** The key of a dependency that is not one of the kit's tools. */
const OTHER = "other: ";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function fieldOf(manifest: unknown, field: string): [string, string][] {
  const group = isRecord(manifest) ? manifest[field] : undefined;
  if (!isRecord(group)) return [];
  return Object.entries(group).flatMap(([name, version]): [string, string][] =>
    typeof version === "string" ? [[name, version]] : [],
  );
}

/** What `package.json` declares: runtime, development and peer dependencies. */
function declared(manifest: unknown): [string, string][] {
  return ["dependencies", "devDependencies", "peerDependencies"].flatMap((field) =>
    fieldOf(manifest, field),
  );
}

/** The tools the kit pins, `webtops` itself, and whatever the lock names. */
function kitNames(lock: ReadonlyMap<string, string>): Set<string> {
  return new Set([...Object.keys(TOOL_PINS), "webtops", ...lock.keys()]);
}

/** Where a dependency of `package.json` is listed: with the kit's tools when it is one, else as `other`. */
const keyOf = (kit: ReadonlySet<string>, name: string): string =>
  kit.has(name) ? `package.json: ${name}` : `${OTHER}${name}`;

/**
 * The tools a project names, each by the file that names it: everything in `web-tops.lock`, and of the dependencies
 * of `package.json` those that are the kit's tools. The project's own dependencies are kept apart, as `other`.
 */
export function toolsOf(
  manifest: unknown,
  lock: ReadonlyMap<string, string> = new Map(),
): Map<string, string> {
  const kit = kitNames(lock);
  return new Map<string, string>([
    ...[...lock].map(([name, version]): [string, string] => [`lock: ${name}`, version]),
    ...declared(manifest).map(([name, version]): [string, string] => [keyOf(kit, name), version]),
  ]);
}

const lost = (before: string, after: string): boolean => isExact(before) && !isExact(after);

const gained = (before: string, after: string): boolean => !isExact(before) && isExact(after);

function moved(before: string, after: string): Change {
  if (lost(before, after)) return "weakened";
  return gained(before, after) ? "strengthened" : "changed";
}

function newOne(after: string): Change {
  return isExact(after) ? "strengthened" : "weakened";
}

const kept = (before: string, after: string): Change =>
  before === after ? "unchanged" : moved(before, after);

/** How a kit tool moved: removed or unpinned is weaker, a new pinned tool or a new pin is stronger, a new version is for review. */
function changeOf(before: string | undefined, after: string | undefined): Change {
  if (before === undefined) return after === undefined ? "unchanged" : newOne(after);
  return after === undefined ? "weakened" : kept(before, after);
}

/** A dependency that is not the kit's: only a difference is listed, and it is for review, never weaker. */
const otherChange = (before: string | undefined, after: string | undefined): Change =>
  before === after ? "unchanged" : "changed";

const changeFor = (name: string, before: string | undefined, after: string | undefined): Change =>
  name.startsWith(OTHER) ? otherChange(before, after) : changeOf(before, after);

/** Every kit tool compared, in name order, each with its version at each ref, and the other dependencies that changed. */
export function compareTools(
  base: ReadonlyMap<string, string>,
  head: ReadonlyMap<string, string>,
): Item[] {
  const names = [...new Set([...base.keys(), ...head.keys()])].sort();
  return names
    .map((what) => {
      const before = base.get(what);
      const after = head.get(what);
      return {
        what,
        change: changeFor(what, before, after),
        before: before ?? "absent",
        after: after ?? "removed",
      };
    })
    .filter((item) => !(item.what.startsWith(OTHER) && item.change === "unchanged"));
}
