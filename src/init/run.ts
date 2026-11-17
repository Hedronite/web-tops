import { lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { serializeLock } from "../lock/format";
import { TOOL_PINS } from "../lock/pins";
import pkg from "../../package.json" with { type: "json" };
import { mergeAgentsSection } from "./agents";
import { readPackageMeta } from "./meta";
import { LAUNCH_CLASSES, loadProfile } from "./profile";
import { agentsSection, eslintConfig, readTemplate, webTopsYaml, workflow } from "./render";

export interface InitOptions {
  readonly className: string | undefined;
  readonly dir: string;
  readonly force: boolean;
}

/** `0` written, `2` bad class, `3` environment (directory or write), `4` refused by policy (WEB_TOPS.md section 12). */
export interface InitOutcome {
  readonly code: 0 | 2 | 3 | 4;
  readonly written: readonly string[];
  /** Files section 4 lists that M1 does not write, with the milestone that does. */
  readonly deferred: readonly string[];
  /** Why the run did not write, one line each. */
  readonly problems: readonly string[];
  /** `name@version` for each tool the class's lock pins, for the install line. */
  readonly install: readonly string[];
}

const DEFERRED = ["stryker.config.json"];

function refuse(code: 2 | 3 | 4, ...problems: string[]): InitOutcome {
  return { code, written: [], deferred: [], problems, install: [] };
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

/** Writes the section 4 drop-in set into `dir`: all of it, or nothing. Never writes a baseline. */
export function runInit(options: InitOptions): InitOutcome {
  const { className, dir, force } = options;
  if (className === undefined || className === "") {
    return refuse(2, `no class given; the launch classes are ${LAUNCH_CLASSES.join(", ")}`);
  }
  const loaded = loadProfile(className);
  if (!loaded.ok) return refuse(2, `${loaded.error}; the launch classes are ${LAUNCH_CLASSES.join(", ")}`);
  if (!isDirectory(dir)) return refuse(3, `${dir} is not a directory`);

  const { profile } = loaded;
  const subject = readPackageMeta(dir);
  const lock: Record<string, string> = { webtops: pkg.version };
  const install: string[] = [];
  for (const tool of profile.tools) {
    const version: unknown = Reflect.get(TOOL_PINS, tool);
    if (typeof version !== "string") return refuse(3, `profiles/${className}.yaml pins ${tool}, which has no exact version`);
    lock[tool] = version;
    install.push(`${tool}@${version}`);
  }

  const planned = new Map<string, string>([
    ["web-tops.yaml", webTopsYaml(profile, subject)],
    ["web-tops.lock", serializeLock(lock)],
    ["tsconfig.strict.json", readTemplate("tsconfig.strict.json.template")],
    ["eslint.config.js", eslintConfig(profile)],
    ["stylelint.config.js", readTemplate("stylelint.config.js.template")],
    [".dependency-cruiser.cjs", readTemplate("dependency-cruiser.cjs.template")],
    [".github/workflows/web-tops.yml", workflow(profile)],
  ]);
  const conflicts = [...planned.keys()].filter((path) => exists(join(dir, path)));

  const agentsPath = join(dir, "AGENTS.md");
  const existing = exists(agentsPath) ? readFileSync(agentsPath, "utf8") : undefined;
  const merged = mergeAgentsSection(existing, agentsSection(profile, subject));
  if (merged.kind === "malformed") return refuse(4, merged.reason);
  if (merged.kind === "replace" && merged.text !== existing) conflicts.push("AGENTS.md (the marked block differs)");
  if (merged.kind !== "replace" || merged.text !== existing) planned.set("AGENTS.md", merged.text);

  if (conflicts.length > 0 && !force) {
    return refuse(4, ...conflicts.map((path) => `${path} already exists; rerun with --force to overwrite`));
  }
  try {
    for (const [path, text] of planned) {
      const target = join(dir, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
    }
  } catch (error) {
    return refuse(3, `could not write: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  return { code: 0, written: [...planned.keys()].sort(), deferred: DEFERRED, problems: [], install };
}
