import { lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { serializeLock } from "../lock/format.ts";
import { NODE_RANGE, TOOL_PINS } from "../lock/pins.ts";
import pkg from "../../package.json" with { type: "json" };
import type { AgentsMerge } from "./agents.ts";
import { mergeAgentsSection } from "./agents.ts";
import type { Profile } from "../config/profiles.ts";
import { mapsStep } from "../config/profiles.ts";
import { readProject } from "../config/project.ts";
import type { Subject } from "./render.ts";
import { readPackageMeta } from "./meta.ts";
import type { DropIn } from "./profile.ts";
import { LAUNCH_CLASSES, loadProfile } from "./profile.ts";
import type { AstroCheck } from "./render.ts";
import { agentsSection, eslintConfig, readTemplate, webTopsYaml, workflow } from "./render.ts";

export interface InitOptions {
  readonly className: string | undefined;
  readonly dir: string;
  readonly force: boolean;
}

/** `0` written, `2` bad class, `3` environment (directory or write), `4` refused by policy (WEB_TOPS.md section 12). */
export interface InitOutcome {
  readonly code: 0 | 2 | 3 | 4;
  readonly written: readonly string[];
  /** Why the run did not write, one line each. */
  readonly problems: readonly string[];
  /** `name@version` for each tool the class's lock pins, for the install line. */
  readonly install: readonly string[];
}

/** What `astro check` needs, locked only where the step runs. */
const ASTRO_TOOLS = ["@astrojs/check", "astro"];

/** What a run decided to write, before it touches the disk. */
interface Plan {
  readonly files: ReadonlyMap<string, string>;
  readonly install: readonly string[];
  /** The AGENTS.md block holds text other than what `init` writes. */
  readonly agentsDiffers: boolean;
}

interface Target {
  readonly profile: DropIn;
  readonly table: Profile;
  readonly dir: string;
}

function refuse(code: 2 | 3 | 4, ...problems: string[]): InitOutcome {
  return { code, written: [], problems, install: [] };
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The class and the directory, or the refusal when either is unusable. */
function resolveTarget(options: InitOptions): Target | InitOutcome {
  const loaded = loadProfile(options.className);
  if (!loaded.ok) {
    return refuse(2, `${loaded.error}; the launch classes are ${LAUNCH_CLASSES.join(", ")}`);
  }
  if (!isDirectory(options.dir)) return refuse(3, `${options.dir} is not a directory`);
  return { profile: loaded.profile, table: loaded.table, dir: options.dir };
}

/** Whether `astro check` runs for this project, and the reason it is written off when it does not. */
function astroCheckFor(table: Profile, dir: string): AstroCheck {
  const mapped = mapsStep(table, "astro_check", readProject(dir));
  const unlisted = table.conditionalSteps.includes("astro_check");
  return {
    mapped,
    reason: unlisted
      ? "not mapped for class: this project lists no astro dependency"
      : "not mapped for class: only Astro projects run astro check",
  };
}

/** The lock's tool pins and the install line for them (web-tops first, for the presets the importers name), or the tool that has no pin. */
function pinTools(
  profile: DropIn,
  astro: boolean,
): { lock: Record<string, string>; install: string[] } | string {
  const lock: Record<string, string> = { webtops: pkg.version, node: NODE_RANGE };
  const install: string[] = [`web-tops@${pkg.version}`];
  for (const tool of [...profile.tools, ...(astro ? ASTRO_TOOLS : [])]) {
    const version: unknown = Reflect.get(TOOL_PINS, tool);
    if (typeof version !== "string")
      return `profiles/${profile.class}.yaml pins ${tool}, which has no exact version`;
    lock[tool] = version;
    install.push(`${tool}@${version}`);
  }
  return { lock, install };
}

/** What init does with an AGENTS.md block that holds text: write it, or leave it when it is already right. */
function agentsEffect(merged: Exclude<AgentsMerge, { kind: "malformed" }>): {
  text: string | undefined;
  differs: boolean;
} {
  if (merged.kind !== "replace") return { text: merged.text, differs: false };
  return {
    text: merged.previous === "same" ? undefined : merged.text,
    differs: merged.previous === "different",
  };
}

function readIfPresent(path: string): string | undefined {
  return exists(path) ? readFileSync(path, "utf8") : undefined;
}

/** Renders every file and merges AGENTS.md; refuses a lock tool with no pin and a malformed AGENTS.md. */
function planFiles(target: Target): Plan | InitOutcome {
  const { profile, table, dir } = target;
  const subject: Subject = readPackageMeta(dir);
  const astroCheck = astroCheckFor(table, dir);
  const pinned = pinTools(profile, astroCheck.mapped);
  if (typeof pinned === "string") return refuse(3, pinned);
  const merged = mergeAgentsSection(
    readIfPresent(join(dir, "AGENTS.md")),
    agentsSection(profile, subject, astroCheck),
  );
  if (merged.kind === "malformed") return refuse(4, merged.reason);
  const effect = agentsEffect(merged);
  const files = new Map<string, string>([
    ["web-tops.yaml", webTopsYaml(profile, subject, astroCheck)],
    ["web-tops.lock", serializeLock(pinned.lock)],
    ["tsconfig.strict.json", readTemplate("tsconfig.strict.json.template")],
    ["eslint.config.js", eslintConfig(profile)],
    ["stylelint.config.js", readTemplate("stylelint.config.js.template")],
    [".dependency-cruiser.cjs", readTemplate("dependency-cruiser.cjs.template")],
    [".github/workflows/web-tops.yml", workflow(profile)],
  ]);
  const withAgents = effect.text === undefined ? files : files.set("AGENTS.md", effect.text);
  return { files: withAgents, install: pinned.install, agentsDiffers: effect.differs };
}

/** Every file the run would overwrite, named for the refusal. */
function conflictsOf(plan: Plan, dir: string): string[] {
  const clashes = [...plan.files.keys()].filter(
    (path) => path !== "AGENTS.md" && exists(join(dir, path)),
  );
  return plan.agentsDiffers ? [...clashes, "AGENTS.md (the marked block differs)"] : clashes;
}

/** Writes the plan; the failure text when a write fails, else undefined. */
function writeAll(plan: Plan, dir: string): string | undefined {
  try {
    for (const [path, text] of plan.files) {
      const target = join(dir, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
    }
    return undefined;
  } catch (error) {
    return `could not write: ${String(error)}`;
  }
}

/** Refuses to overwrite without `--force`, then writes: all of the plan, or none of it. */
function applyPlan(plan: Plan, options: InitOptions): InitOutcome {
  const conflicts = conflictsOf(plan, options.dir);
  if (conflicts.length > 0 && !options.force) {
    return refuse(
      4,
      ...conflicts.map((path) => `${path} already exists; rerun with --force to overwrite`),
    );
  }
  const failure = writeAll(plan, options.dir);
  if (failure !== undefined) return refuse(3, failure);
  return { code: 0, written: [...plan.files.keys()].sort(), problems: [], install: plan.install };
}

/** Writes the section 4 drop-in set into `dir`: all of it, or nothing. Never writes a baseline or a Stryker config. */
export function runInit(options: InitOptions): InitOutcome {
  const target = resolveTarget(options);
  if ("code" in target) return target;
  const plan = planFiles(target);
  if ("code" in plan) return plan;
  return applyPlan(plan, options);
}
