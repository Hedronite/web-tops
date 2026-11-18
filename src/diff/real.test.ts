import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { realExec } from "../gate/exec.ts";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";
import { realProject } from "../layers/tests/testkit.ts";
import { vitestCoverageOf } from "./coverage.ts";
import { diffScope } from "./scope.ts";
import { commit, git, write } from "./test-support.ts";

/**
 * G6-2 and G6-3 with the real Vitest: the per-file coverage run uses the gate's own config (the project's with its
 * coverage thresholds removed) and the gate's include and exclude, whatever the project says.
 */

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const M = [
  "export function f(a: number): number {",
  "  return a + 1;",
  "}",
  "export function g(a: number): number {",
  "  return a * 2;",
  "}",
  "",
].join("\n");
const STRONG =
  'import { expect, it } from "vitest";\nimport { f, g } from "./m.ts";\nit("f", () => {\n  expect(f(1)).toBe(2);\n});\nit("g", () => {\n  expect(g(2)).toBe(4);\n});\n';
const WEAK =
  'import { expect, it } from "vitest";\nimport { f } from "./m.ts";\nit("f", () => {\n  expect(f(1)).toBe(2);\n});\n';
const F_ONLY =
  'import { expect, it } from "vitest";\nimport { f } from "./m.ts";\nit("f", () => {\n  expect(f(1)).toBe(2);\n});\n';

function project(files: Readonly<Record<string, string>>): string {
  const { project: made } = realProject(files);
  dirs.push(made.dir);
  return made.dir;
}

function ran(map: Awaited<ReturnType<typeof vitestCoverageOf>>): { ran: number; idle: number } {
  const hits = map?.get("src/m.ts") ?? [];
  return {
    ran: hits.filter((hit) => hit.hits > 0).length,
    idle: hits.filter((hit) => hit.hits === 0).length,
  };
}

describe("G6-2: the per-file coverage run is the gate's, not the project's", () => {
  it(
    "is not failed by coverage thresholds in the project's config (a one-file run cannot meet them)",
    async () => {
      const cwd = project({
        "vitest.config.ts":
          "export default { test: { coverage: { provider: 'v8', thresholds: { lines: 100, functions: 100 } } } };\n",
        "src/m.ts": M,
        "src/m.test.ts": F_ONLY,
      });
      const map = await vitestCoverageOf("src/m.test.ts", { cwd, exec: realExec });
      expect(ran(map)).toEqual({ ran: 1, idle: 1 });
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "is not narrowed by a coverage include that leaves the sources out",
    async () => {
      const cwd = project({
        "vitest.config.ts":
          "export default { test: { coverage: { provider: 'v8', include: ['lib/**'] } } };\n",
        "src/m.ts": M,
        "src/m.test.ts": F_ONLY,
      });
      const map = await vitestCoverageOf("src/m.test.ts", { cwd, exec: realExec });
      expect(ran(map)).toEqual({ ran: 1, idle: 1 });
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "works with no config at all",
    async () => {
      const cwd = project({ "src/m.ts": M, "src/m.test.ts": F_ONLY });
      expect(ran(await vitestCoverageOf("src/m.test.ts", { cwd, exec: realExec })).ran).toBe(1);
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "takes the gate's exclusions: a source file the config excludes is left out of the map",
    async () => {
      const cwd = project({ "src/m.ts": M, "src/m.test.ts": F_ONLY });
      const map = await vitestCoverageOf("src/m.test.ts", {
        cwd,
        exec: realExec,
        exclude: ["src/m.ts"],
      });
      expect(map?.has("src/m.ts") ?? false).toBe(false);
    },
    REAL_TOOL_TIMEOUT,
  );
});

describe("G6-3: a test that dropped a call keeps that function in scope, through the real run", () => {
  it(
    "lists f and g when the head test no longer calls g, and mutates both",
    async () => {
      const cwd = project({
        ".gitignore": "node_modules\n.web-tops\n",
        "src/m.ts": M,
        "src/m.test.ts": STRONG,
      });
      git(cwd, "init", "-q", "-b", "main");
      commit(cwd, "base");
      git(cwd, "switch", "-q", "-c", "weaken");
      write(cwd, { "src/m.test.ts": WEAK });
      commit(cwd, "weaken");
      const result = await diffScope({ cwd, base: "main" });
      expect(result.outcome).toBe("scope");
      if (result.outcome === "fail") return;
      expect(result.scope.coveredFunctions.map((ref) => ref.key)).toEqual([
        "src/m.ts::f",
        "src/m.ts::g",
      ]);
      expect(result.scope.mutate).toEqual(["src/m.ts:1-6"]);
    },
    REAL_TOOL_TIMEOUT,
  );
});
