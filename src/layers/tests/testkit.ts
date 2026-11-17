import { mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { cfg, tempProject, type TempProject } from "../../gate/testkit.ts";
import type {
  CoverageSettings,
  Exec,
  GateConfig,
  LayerContext,
  LayerResult,
  TestsSettings,
} from "../../gate/types.ts";
import { testsLayer } from "./index.ts";

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");

export interface Project {
  readonly project: TempProject;
  readonly outDir: string;
}

/**
 * A temp project that can run the real Vitest: the kit's `node_modules` is linked in, so `vitest` and the
 * coverage provider resolve. Files are written as given; the out directory is made.
 */
/**
 * How a project gets its tools: `linked` is a hoisted install (every package reachable from the project's
 * `node_modules`), `isolated` is a Bun workspace or any isolated install (only what the project declares is
 * there, and `vite` is reachable only from beside `vitest`), `none` has no `node_modules` at all.
 */
export type Install = "linked" | "isolated" | "none";

/** Only `vitest` and its coverage provider, each a link to the real package: no `vite` next to them. */
function isolatedModules(dir: string): void {
  const modules = join(dir, "node_modules");
  mkdirSync(join(modules, "@vitest"), { recursive: true });
  symlinkSync(join(REPO_ROOT, "node_modules", "vitest"), join(modules, "vitest"));
  symlinkSync(
    join(REPO_ROOT, "node_modules", "@vitest", "coverage-v8"),
    join(modules, "@vitest", "coverage-v8"),
  );
}

/** What the tools cache under node_modules; a project must write its own, never the kit's. */
const CACHE_ENTRIES = new Set([".vitest-cache", ".vite", ".vite-temp"]);

/**
 * A hoisted install: a node_modules of its own that links every package of the kit's, but none of the
 * caches. Vitest keeps its module cache in <workspace root>/node_modules/.vitest-cache and clears it when
 * the lockfile hash differs, so a project that shared the kit's directory would clear the cache that the
 * outer run reads.
 */
function linkedModules(dir: string): void {
  const kit = join(REPO_ROOT, "node_modules");
  const modules = join(dir, "node_modules");
  mkdirSync(modules);
  for (const entry of readdirSync(kit).filter((name) => !CACHE_ENTRIES.has(name))) {
    symlinkSync(join(kit, entry), join(modules, entry));
  }
}

function installModules(dir: string, install: Install): void {
  if (install === "linked") {
    linkedModules(dir);
  } else if (install === "isolated") {
    isolatedModules(dir);
  }
}

export function realProject(
  files: Readonly<Record<string, string>>,
  install: Install = "linked",
): Project {
  const project = tempProject();
  installModules(project.dir, install);
  writeFileSync(join(project.dir, "package.json"), '{ "name": "fixture", "type": "module" }\n');
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(project.dir, name)), { recursive: true });
    writeFileSync(join(project.dir, name), text);
  }
  const outDir = join(project.dir, ".web-tops", "out");
  mkdirSync(outDir, { recursive: true });
  return { project, outDir };
}

export const SOURCE = "export const add = (a: number, b: number): number => a + b;\n";

export function testFile(body: string): string {
  return `import { expect, it, describe } from "vitest";\nimport { add } from "./a.ts";\n${body}\n`;
}

export interface Options {
  readonly tests?: Partial<TestsSettings>;
  readonly coverage?: Partial<CoverageSettings>;
  readonly enforce?: GateConfig["enforce"];
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export function contextFor(item: Project, exec: Exec, options: Options = {}): LayerContext {
  return {
    cwd: item.project.dir,
    config: cfg({
      tests: { shuffle: true, ...options.tests },
      coverage: { linesFloor: 85, exclude: [], ...options.coverage },
    }),
    base: "origin/main",
    enforce: options.enforce ?? "hard",
    env: options.env ?? { PATH: process.env["PATH"] },
    exec,
    outDir: item.outDir,
    artifacts: new Map(),
  };
}

export function runTests(item: Project, exec: Exec, options: Options = {}): Promise<LayerResult> {
  return testsLayer.run(contextFor(item, exec, options));
}

export function rulesOf(result: LayerResult): string[] {
  return result.findings
    .filter((finding) => finding.verdict === "Refuse")
    .map((finding) => finding.rule);
}
