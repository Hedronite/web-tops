import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { realExec } from "../gate/exec.ts";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";
import { realProject } from "../layers/tests/testkit.ts";
import { vitestCoverageOf } from "./coverage.ts";
import { diffScope } from "./scope.ts";
import { commit, git, write } from "./test-support.ts";

// With the real Vitest: the changed test files run together give the scope that a run of each alone gives, and the
// same verdict when one of them cannot run.

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
  "export function h(a: number): number {",
  "  return a - 1;",
  "}",
  "",
].join("\n");
const test = (calls: string): string =>
  `import { expect, it } from "vitest";\nimport { f, g, h } from "./m.ts";\nit("runs", () => {\n  expect(${calls}).toBeTypeOf("number");\n});\n`;

function branch(files: Readonly<Record<string, string>>): string {
  const { project } = realProject({ ".gitignore": "node_modules\n.web-tops\n", ...files });
  dirs.push(project.dir);
  git(project.dir, "init", "-q", "-b", "main");
  commit(project.dir, "base");
  git(project.dir, "switch", "-q", "-c", "work");
  return project.dir;
}

describe("the real run of changed test files together", () => {
  it(
    "is the scope of a run of each alone: added, weakened and unchanged-source tests",
    async () => {
      const cwd = branch({
        "src/m.ts": M,
        "src/weak.test.ts": test("f(1) + g(1)"),
      });
      write(cwd, {
        "src/weak.test.ts": test("f(1)"),
        "src/a.test.ts": test("g(2)"),
        "src/b.test.ts": test("f(3)"),
      });
      commit(cwd, "work");
      const alone = (file: string) => vitestCoverageOf(file, { cwd, exec: realExec });
      const before = await diffScope({
        copyToken: () => "tok",
        cwd,
        base: "main",
        coverageOf: alone,
      });
      const after = await diffScope({ copyToken: () => "tok", cwd, base: "main" });
      expect(after).toEqual(before);
      expect(after.outcome).toBe("scope");
      if (after.outcome !== "scope") return;
      expect(after.scope.coveredFunctions.map((ref) => ref.key)).toEqual([
        "src/m.ts::f",
        "src/m.ts::g",
      ]);
      expect(after.scope.mutate).toEqual(["src/m.ts:1-6"]);
    },
    REAL_TOOL_TIMEOUT * 3,
  );

  it(
    "fails as a run of each alone fails, naming the first file that cannot run",
    async () => {
      const cwd = branch({ "src/m.ts": M });
      write(cwd, {
        "src/a.test.ts": test("f(1)"),
        "src/b.test.ts":
          'import { it } from "vitest";\nit("breaks", () => {\n  throw new Error("no");\n});\n',
        "src/c.test.ts":
          'import { it } from "vitest";\nit("breaks", () => {\n  throw new Error("no");\n});\n',
      });
      commit(cwd, "work");
      const alone = (file: string) => vitestCoverageOf(file, { cwd, exec: realExec });
      const before = await diffScope({ cwd, base: "main", coverageOf: alone });
      const after = await diffScope({ cwd, base: "main" });
      expect(after).toEqual(before);
      expect(after).toEqual({
        outcome: "fail",
        reason: "could not run src/b.test.ts to find the functions it covers",
      });
    },
    REAL_TOOL_TIMEOUT * 3,
  );
});
