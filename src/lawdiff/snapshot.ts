import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hasEslintConfig, type Runner } from "../census/eslint.ts";
import { profileFor } from "../config/profiles.ts";
import type { WebTopsConfig } from "../config/types.ts";
import { loadConfig } from "../config/validate.ts";
import { CATALOG_DIR, loadCatalog } from "../laws/catalog/index.ts";
import { parseLock } from "../lock/format.ts";
import { trackedSource } from "../laws/readers/files.ts";
import { readProjects } from "../laws/readers/tsc-projects.ts";
import { factsOf } from "./catalog.ts";
import { flagsOf } from "./flags.ts";
import { askRules } from "./rules.ts";
import { settingsOf } from "./settings.ts";
import { toolsOf } from "./tools.ts";
import type { LawFacts, Part, Profile, Snapshot } from "./types.ts";

const absent: Part<never> = { state: "absent" };

const failed = (message: string): Part<never> => ({ state: "error", message });

function mapPart<T, U>(part: Part<T>, use: (value: T) => U): Part<U> {
  return part.state === "ok" ? { state: "ok", value: use(part.value) } : part;
}

/** The tracked files of a checkout, from git. */
async function tracked(runner: Runner): Promise<string[] | string> {
  const listed = await runner.exec("git", ["ls-files", "-z"], { cwd: runner.cwd, env: runner.env });
  return listed.code === 0
    ? listed.stdout.split("\0")
    : `git ls-files exited ${String(listed.code)}`;
}

/** The files ESLint was asked about, and the effective level of every rule for each. */
export interface Read {
  readonly tracked: readonly string[];
  readonly levels: Snapshot["levels"];
}

/**
 * The effective level of every rule for every tracked source file, read with the checkout's own ESLint, and for the
 * files `extra` adds: ESLint reads no file to say which config block reaches its path, so a path this checkout does not
 * have can be asked about all the same.
 */
export async function levelsPart(runner: Runner, extra: readonly string[]): Promise<Read> {
  if (!hasEslintConfig(runner.cwd)) return { tracked: [], levels: absent };
  const files = await tracked(runner);
  if (typeof files === "string") return { tracked: [], levels: failed(files) };
  const own = trackedSource(files);
  const read = await askRules(runner, [...new Set([...own, ...trackedSource(extra)])]);
  return {
    tracked: own,
    levels: read.ok ? { state: "ok", value: read.value } : failed(read.message),
  };
}

function flagsPart(dir: string): Snapshot["flags"] {
  if (!existsSync(join(dir, "tsconfig.json"))) return absent;
  const read = readProjects(dir);
  return read.ok ? { state: "ok", value: flagsOf(read.projects) } : failed(read.message);
}

function configPart(dir: string): Part<WebTopsConfig> {
  const path = join(dir, "web-tops.yaml");
  if (!existsSync(path)) return absent;
  const read = loadConfig(path);
  return read.ok
    ? { state: "ok", value: read.value }
    : failed(read.problems.map((problem) => `${problem.pointer}: ${problem.message}`).join("; "));
}

/** The laws of the checkout's `laws/` folder; a project without one has none to compare. */
function lawsPart(dir: string): Snapshot["laws"] {
  const folder = join(dir, "laws");
  if (!existsSync(folder)) return absent;
  const read = loadCatalog(folder);
  return read.ok
    ? { state: "ok", value: factsOf(read.laws) }
    : failed(read.problems.map((problem) => `${problem.file}: ${problem.message}`).join("; "));
}

/** The laws a class requires: mapped to it and judged. An adopter has no catalog of its own, so the kit's stands. */
function requiredBy(className: string, laws: ReadonlyMap<string, LawFacts>): Set<string> {
  return new Set(
    [...laws]
      .filter(([, law]) => law.classes.includes(className) && law.judged !== "no")
      .map(([id]) => id),
  );
}

function kitLaws(): ReadonlyMap<string, LawFacts> {
  const read = loadCatalog(CATALOG_DIR);
  return read.ok ? factsOf(read.laws) : new Map();
}

/** What a class requires: the laws mapped to it and the layers and steps its profile maps. */
export function profileOf(className: string, laws: Snapshot["laws"]): Profile {
  const profile = profileFor(className);
  return {
    className,
    required: requiredBy(className, laws.state === "ok" ? laws.value : kitLaws()),
    layers: profile === undefined ? new Set() : new Set([...profile.layers, ...profile.steps]),
  };
}

function manifestPart(dir: string): Part<unknown> {
  const path = join(dir, "package.json");
  if (!existsSync(path)) return absent;
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return { state: "ok", value };
  } catch (error) {
    return failed(`package.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

type LockParser = typeof parseLock;

function lockPart(dir: string, parse: LockParser): Part<ReadonlyMap<string, string>> {
  const path = join(dir, "web-tops.lock");
  if (!existsSync(path)) return absent;
  const read = parse(readFileSync(path, "utf8"));
  return read.ok
    ? { state: "ok", value: new Map(Object.entries(read.lock)) }
    : failed(`web-tops.lock: ${read.error}`);
}

const valueOf = <T>(part: Part<T>): T | undefined => (part.state === "ok" ? part.value : undefined);

const brokenOf = (part: Part<unknown>): Part<never> | undefined =>
  part.state === "error" ? part : undefined;

function bothTools(
  manifest: Part<unknown>,
  lock: Part<ReadonlyMap<string, string>>,
): Snapshot["tools"] {
  if (manifest.state === "absent" && lock.state === "absent") return absent;
  return { state: "ok", value: toolsOf(valueOf(manifest), valueOf(lock)) };
}

/** The tools of a checkout, by the file that names them: `package.json` and `web-tops.lock`. */
export function toolsPart(dir: string, parse: LockParser = parseLock): Snapshot["tools"] {
  const manifest = manifestPart(dir);
  const lock = lockPart(dir, parse);
  return brokenOf(manifest) ?? brokenOf(lock) ?? bothTools(manifest, lock);
}

/** Every surface of the diff, read from one checkout; `extra` is the files of the other ref ESLint is also asked about. */
export async function snapshotOf(runner: Runner, extra: readonly string[]): Promise<Snapshot> {
  const dir = runner.cwd;
  const config = configPart(dir);
  const laws = lawsPart(dir);
  const read = await levelsPart(runner, extra);
  return {
    tracked: read.tracked,
    levels: read.levels,
    tools: toolsPart(dir),
    flags: flagsPart(dir),
    settings: mapPart(config, settingsOf),
    laws,
    profile: mapPart(config, (value) => profileOf(value.class, laws)),
  };
}
