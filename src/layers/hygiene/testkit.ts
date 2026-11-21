import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
  mapsStep,
  profileFor,
  type ClassName,
  type Profile,
  type Project,
} from "../../config/profiles.ts";
import { cfg, off, tempProject, type TempProject } from "../../gate/testkit.ts";
import {
  HYGIENE_STEPS,
  type Exec,
  type ExecResult,
  type HygieneSettings,
  type HygieneStep,
  type LayerContext,
  type LayerResult,
  type Toggle,
} from "../../gate/types.ts";
import { hygieneLayer } from "./index.ts";
import { tools } from "./tooling.ts";

/** Test support for gate 1: a fake process runner with a clean answer for every tool, and a project to run it in. */

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");
export const FIXTURES = join(REPO_ROOT, "fixtures", "hygiene");

export function recorded(name: string): string {
  return readFileSync(join(FIXTURES, "recorded", name), "utf8");
}

export interface Call {
  readonly tool: string;
  readonly args: readonly string[];
}

export type Handler = (args: readonly string[], project: string) => ExecResult;

const OK: ExecResult = { code: 0, stdout: "", stderr: "" };

/** `bun install`, `bun audit` and `bun pm pack` are different tools that share a binary. */
export function toolKey(command: string, args: readonly string[]): string {
  return command === "bun" ? `bun ${args[0] ?? ""}` : command;
}

function writeAt(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function valueAfter(args: readonly string[], flag: string): string {
  const at = args.indexOf(flag);
  if (at === -1) {
    throw new Error(`the fake tool was called without ${flag}`);
  }
  return args[at + 1] ?? "";
}

/** What each tool does when the project is clean. */
export function cleanHandlers(): Record<string, Handler> {
  return {
    "bun install": () => OK,
    tsc: () => OK,
    astro: () => OK,
    eslint: (args) => {
      writeAt(valueAfter(args, "--output-file"), "[]\n");
      return OK;
    },
    stylelint: (args) => {
      writeAt(valueAfter(args, "--output-file"), "[]\n");
      return OK;
    },
    prettier: () => OK,
    biome: () => OK,
    depcruise: () => ({
      code: 0,
      stdout: JSON.stringify({
        modules: [],
        summary: { violations: [], error: 0, warn: 0, info: 0, ignore: 0 },
      }),
      stderr: "",
    }),
    "bun audit": () => ({ code: 0, stdout: recorded("audit-clean.json"), stderr: "" }),
    "bun pm": (args) => {
      writeAt(join(valueAfter(args, "--destination"), "pkg-1.0.0.tgz"), "tarball");
      return OK;
    },
    publint: () => ({ code: 0, stdout: recorded("publint-clean.txt"), stderr: "" }),
    attw: () => OK,
  };
}

export interface Fake {
  readonly exec: Exec;
  readonly calls: Call[];
  readonly count: (tool: string) => number;
}

/** The tool whose installed package holds `entry`, so a run under `node` is recorded as the tool's own. */
function toolOfEntry(project: string, entry: string | undefined): string | undefined {
  if (entry === undefined) {
    return undefined;
  }
  for (const [name, spec] of tools()) {
    if (entry.startsWith(join(project, "node_modules", spec.package) + sep)) {
      return name;
    }
  }
  return undefined;
}

/** What the layer asked for: the tool a `node <entry>` run stands for, or the runtime itself (`bun`). */
function callOf(
  project: string,
  command: string,
  args: readonly string[],
): { tool: string; rest: readonly string[] } {
  const tool = command === "node" ? toolOfEntry(project, args[0]) : undefined;
  return tool === undefined ? { tool: command, rest: args } : { tool, rest: args.slice(1) };
}

/** A process runner that records every call and answers from `handlers`, with `overrides` winning. */
export function fakeExec(project: string, overrides: Record<string, Handler> = {}): Fake {
  const handlers = { ...cleanHandlers(), ...overrides };
  const calls: Call[] = [];
  const exec: Exec = (command, args) => {
    const { tool, rest } = callOf(project, command, args);
    calls.push({ tool, args: rest });
    const handler = handlers[toolKey(tool, rest)];
    return Promise.resolve(
      handler === undefined
        ? { code: null, stdout: "", stderr: "", failure: "tool-missing" }
        : handler(rest, project),
    );
  };
  return {
    exec,
    calls,
    count: (tool) => calls.filter((call) => toolKey(call.tool, call.args) === tool).length,
  };
}

export interface Prepared {
  readonly project: TempProject;
  readonly outDir: string;
}

/** The fake package a tool resolves to: a manifest with a `bin` field and the file it names. */
function installTool(dir: string, name: string, packageName: string): void {
  const root = join(dir, "node_modules", packageName);
  writeAt(
    join(root, "package.json"),
    JSON.stringify({ name: packageName, bin: { [name]: `bin/${name}.js` } }),
  );
  writeAt(join(root, "bin", `${name}.js`), "#!/usr/bin/env node\n");
}

export interface PrepareOptions {
  /** Tools to leave out of `node_modules`, by name (`tsc`, `eslint`, ...). */
  readonly without?: readonly string[];
  /** Link this repo's own `node_modules` instead of writing fake tool packages, for tests that run a real tool. */
  readonly real?: boolean;
}

/** A fake package for each tool, except the ones left out. */
function installFakeTools(dir: string, without: readonly string[]): void {
  for (const [name, spec] of tools()) {
    if (!without.includes(name)) {
      installTool(dir, name, spec.package);
    }
  }
}

/** Puts the tools in the project's `node_modules`: the real ones by link, or a fake package for each. */
function installTools(dir: string, options: PrepareOptions): void {
  if (options.real === true) {
    symlinkSync(join(REPO_ROOT, "node_modules"), join(dir, "node_modules"));
  } else {
    installFakeTools(dir, options.without ?? []);
  }
}

/**
 * A temp project holding `files`, with `.web-tops/out` made and every tool installed in `node_modules`
 * (unless `without` leaves it out). A Prettier config is there unless `files` says otherwise.
 */
export function prepare(
  files: Readonly<Record<string, string>> = {},
  options: PrepareOptions = {},
): Prepared {
  const project = tempProject();
  const all = { "prettier.config.js": "export default {};\n", ...files };
  for (const [name, text] of Object.entries(all)) {
    writeAt(join(project.dir, name), text);
  }
  installTools(project.dir, options);
  const outDir = join(project.dir, ".web-tops", "out");
  mkdirSync(outDir, { recursive: true });
  return { project, outDir };
}

function isMapped(profile: Profile | undefined, step: HygieneStep, project: Project): boolean {
  if (profile === undefined) {
    return false;
  }
  return step === "package_exports"
    ? profile.layers.includes(step)
    : mapsStep(profile, step, project);
}

function reasonFor(className: ClassName, profile: Profile | undefined, step: HygieneStep): string {
  const conditional = profile?.conditionalSteps.some((name) => name === step) ?? false;
  return conditional
    ? `class ${className} maps ${step} only when package.json lists astro`
    : `class ${className} does not map ${step}`;
}

/** Switches that turn off every step the class does not map, each with a reason that names the class. */
export function classSteps(
  className: ClassName,
  project: Project = { dependsOnAstro: false },
): Partial<Record<HygieneStep, Toggle>> {
  const profile = profileFor(className);
  return Object.fromEntries(
    HYGIENE_STEPS.filter((step) => !isMapped(profile, step, project)).map((step) => [
      step,
      off(reasonFor(className, profile, step)),
    ]),
  );
}

export interface RunOptions {
  readonly className?: ClassName;
  /** The project's package.json lists astro, so conditional steps map. */
  readonly dependsOnAstro?: boolean;
  /** Switches on top of the class's own. */
  readonly steps?: Partial<Record<HygieneStep, Toggle>>;
  readonly settings?: Partial<HygieneSettings>;
  /** The mode, `hard` unless said. */
  readonly enforce?: LayerContext["enforce"];
  /** The baseline the config names, for a ratchet run. */
  readonly baselinePath?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

interface RunDefaults {
  readonly className: ClassName;
  readonly dependsOnAstro: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
}

const RUN_DEFAULTS: RunDefaults = {
  className: "ts-library",
  dependsOnAstro: false,
  env: { PATH: "/usr/bin" },
};

/** What the layer is given for a run: the project, the class's steps with the options on top, and the process runner. */
export function contextOf(prepared: Prepared, exec: Exec, options: RunOptions = {}): LayerContext {
  const full = { ...RUN_DEFAULTS, ...options };
  return {
    cwd: prepared.project.dir,
    config: cfg({
      class: full.className,
      ...(options.baselinePath === undefined ? {} : { baselinePath: options.baselinePath }),
      hygiene: {
        auditFailOn: "high",
        ...options.settings,
        steps: {
          ...classSteps(full.className, { dependsOnAstro: full.dependsOnAstro }),
          ...options.steps,
        },
      },
    }),
    base: "origin/main",
    enforce: options.enforce ?? "hard",
    env: full.env,
    exec,
    outDir: prepared.outDir,
    artifacts: new Map(),
  };
}

export function runHygiene(
  prepared: Prepared,
  exec: Exec,
  options: RunOptions = {},
): Promise<LayerResult> {
  return hygieneLayer.run(contextOf(prepared, exec, options));
}

/** The findings that make a layer fail, as `rule: message` strings. */
export function failures(result: LayerResult): string[] {
  return result.findings
    .filter((finding) => finding.verdict !== "pass" && finding.verdict !== "skip")
    .map((finding) => finding.rule);
}
