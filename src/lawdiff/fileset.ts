import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { loadTypeScript } from "../complexity/index.ts";
import type { Ts } from "../complexity/index.ts";
import type { Item, ProjectSets } from "./types.ts";
import { compareSets } from "./sets.ts";

export type FileSetsRead =
  | { readonly ok: true; readonly projects: ReadonlyMap<string, ProjectSets> }
  | { readonly ok: false; readonly message: string };

/** TypeScript's "No inputs were found": a solution config that only references other projects has none. */
const NO_INPUTS = 18003;

const stringsOf = (value: unknown): string[] =>
  [value].flat().flatMap((entry: unknown) => (typeof entry === "string" ? [entry] : []));

/** The strings a raw config holds under a key: a list of them, or one; none when the key is missing. */
const listOf = (raw: unknown, key: string): string[] => stringsOf(Reflect.get(Object(raw), key));

interface Walked {
  readonly projects: Map<string, ProjectSets>;
  readonly seen: Set<string>;
}

function parse(ts: Ts, path: string): ReturnType<Ts["parseJsonSourceFileConfigFileContent"]> {
  const source = ts.readJsonConfigFile(path, (file) => ts.sys.readFile(file));
  return ts.parseJsonSourceFileConfigFileContent(source, ts.sys, dirname(path), undefined, path);
}

function setsOf(
  ts: Ts,
  cwd: string,
  path: string,
): { sets: ProjectSets; references: string[]; errors: string[] } {
  const found = parse(ts, path);
  const raw: unknown = found.raw;
  return {
    sets: {
      include: listOf(raw, "include"),
      exclude: listOf(raw, "exclude"),
      files: listOf(raw, "files"),
      references: (found.projectReferences ?? []).map((reference) =>
        relative(cwd, ts.resolveProjectReferencePath(reference)),
      ),
      program: new Set(found.fileNames.map((file) => relative(cwd, file))),
    },
    references: (found.projectReferences ?? []).map((reference) =>
      ts.resolveProjectReferencePath(reference),
    ),
    errors: found.errors
      .filter((error) => error.code !== NO_INPUTS)
      .map((error) => ts.flattenDiagnosticMessageText(error.messageText, ts.sys.newLine)),
  };
}

/** Each project reached from the config through `references`, once, the config first; the first problem, if any. */
function walk(ts: Ts, cwd: string, path: string, into: Walked): string | undefined {
  if (into.seen.has(path)) return undefined;
  into.seen.add(path);
  const found = setsOf(ts, cwd, path);
  if (found.errors.length > 0) return `${relative(cwd, path)}: ${found.errors.join("; ")}`;
  into.projects.set(relative(cwd, path), found.sets);
  return found.references
    .map((reference) => walk(ts, cwd, reference, into))
    .find((message) => message !== undefined);
}

/**
 * For each tsconfig project the gate checks (`tsconfig.json` and what it references, transitively), what it selects:
 * its `include`, `exclude`, `files` and `references` as the config says them after `extends`, and the files that come
 * of them, read with the project's own TypeScript.
 */
export function readFileSets(cwd: string): FileSetsRead {
  const root = join(cwd, "tsconfig.json");
  if (!existsSync(root)) return { ok: false, message: "tsconfig.json is missing" };
  try {
    return load(cwd, root);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function load(cwd: string, root: string): FileSetsRead {
  const into: Walked = { projects: new Map(), seen: new Set() };
  const message = walk(loadTypeScript(cwd), cwd, root, into);
  return message === undefined ? { ok: true, projects: into.projects } : { ok: false, message };
}

const gone = (config: string, was: string): Item => ({
  what: `tsconfig project ${config}`,
  change: "weakened",
  before: was,
  after: "no longer checked",
});

/** The files of a base project that the head project no longer holds, where the head still has the file (or its rename). */
function dropped(
  config: string,
  base: ProjectSets,
  head: ProjectSets,
  moved: ReadonlyMap<string, string>,
  tracked: ReadonlySet<string>,
): Item[] {
  return [...base.program]
    .map((file) => moved.get(file) ?? file)
    .filter((now) => tracked.has(now) && !head.program.has(now))
    .map((now) => ({
      what: `${config}: program`,
      change: "weakened" as const,
      before: "in the project",
      after: "no longer in the project",
      where: now,
    }));
}

function projectItems(
  config: string,
  base: ProjectSets,
  head: ProjectSets,
  moved: ReadonlyMap<string, string>,
  tracked: ReadonlySet<string>,
): Item[] {
  return [
    ...compareSets(`${config}: include`, base.include, head.include, "removed"),
    ...compareSets(`${config}: files`, base.files, head.files, "removed"),
    ...compareSets(`${config}: exclude`, base.exclude, head.exclude, "added"),
    ...compareSets(`${config}: references`, base.references, head.references, "removed"),
    ...dropped(config, base, head, moved, tracked),
  ];
}

/** How many parts of the projects were compared: each entry of each set, and each file of each program. */
function sizeOf(sets: ProjectSets): number {
  return (
    sets.include.length +
    sets.files.length +
    sets.exclude.length +
    sets.references.length +
    sets.program.size
  );
}

/**
 * The file set of every checked project that moved: an include or file entry removed, an exclude added, a reference
 * removed, a project no longer checked, or a file of a project that the head still tracks and the project no longer
 * holds, where a renamed file counts at its new path and a deleted file is not compared.
 */
export function compareFileSets(
  base: ReadonlyMap<string, ProjectSets>,
  head: ReadonlyMap<string, ProjectSets>,
  renames: ReadonlyMap<string, string>,
  tracked: readonly string[],
): { readonly items: Item[]; readonly compared: number } {
  const moved = new Map([...renames].map(([now, was]) => [was, now]));
  const present = new Set(tracked);
  const items: Item[] = [];
  let compared = 0;
  for (const [config, before] of base) {
    const after = head.get(config);
    compared += sizeOf(before);
    items.push(
      ...(after === undefined
        ? [gone(config, "checked")]
        : projectItems(config, before, after, moved, present)),
    );
  }
  return { items, compared };
}
