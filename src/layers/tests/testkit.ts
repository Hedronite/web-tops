import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
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
export function realProject(files: Readonly<Record<string, string>>, link = true): Project {
  const project = tempProject();
  if (link) {
    symlinkSync(join(REPO_ROOT, "node_modules"), join(project.dir, "node_modules"));
  }
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
