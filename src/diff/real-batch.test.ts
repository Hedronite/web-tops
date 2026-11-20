import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";
import { realProject } from "../layers/tests/testkit.ts";
import { commit, git, write } from "./test-support.ts";

// With the real Vitest: the changed test files run together give the scope that a run of each alone gives, and the
// same verdict when one of them cannot run. Both scopes are taken in a child process, so that these runs are not
// part of what the mutation layer re-runs for every mutant of the diff step.

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const KIT = join(import.meta.dirname, "../..");

const SCRIPT = `
const [kit, cwd, token] = process.argv.slice(2);
const { diffScope } = await import(kit + "/src/diff/scope.ts");
const { vitestCoverageOf } = await import(kit + "/src/diff/coverage.ts");
const { realExec } = await import(kit + "/src/gate/exec.ts");
const alone = (file) => vitestCoverageOf(file, { cwd, exec: realExec });
const copyToken = () => token;
const before = await diffScope({ copyToken, cwd, base: "main", coverageOf: alone });
const after = await diffScope({ copyToken, cwd, base: "main" });
const scope = after.scope;
console.log(JSON.stringify({ before, after, keys: scope ? scope.coveredFunctions.map((ref) => ref.key) : [], mutate: scope ? scope.mutate : [] }));
`;

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
const BREAKS =
  'import { it } from "vitest";\nit("breaks", () => {\n  throw new Error("no");\n});\n';

function branch(files: Readonly<Record<string, string>>): string {
  const { project } = realProject({ ".gitignore": "node_modules\n.web-tops\n", ...files });
  dirs.push(project.dir);
  git(project.dir, "init", "-q", "-b", "main");
  commit(project.dir, "base");
  git(project.dir, "switch", "-q", "-c", "work");
  return project.dir;
}

interface Scopes {
  readonly before: unknown;
  readonly after: unknown;
  readonly keys: readonly unknown[];
  readonly mutate: readonly unknown[];
}

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Both scopes of the project, as the child process took them: each file alone, and the files together. */
function scopes(cwd: string): Scopes {
  const dir = mkdtempSync(join(tmpdir(), "wt-real-batch-"));
  dirs.push(dir);
  const script = join(dir, "scopes.mjs");
  writeFileSync(script, SCRIPT);
  const run = spawnSync("bun", [script, KIT, cwd, "tok"], { encoding: "utf8", cwd });
  expect(run.status, run.stderr).toBe(0);
  const parsed: unknown = JSON.parse(run.stdout);
  const field = (name: string): unknown => Reflect.get(Object(parsed), name);
  return {
    before: field("before"),
    after: field("after"),
    keys: listOf(field("keys")),
    mutate: listOf(field("mutate")),
  };
}

describe("the real run of changed test files together", () => {
  it(
    "is the scope of a run of each alone: added, weakened and unchanged-source tests",
    () => {
      const cwd = branch({ "src/m.ts": M, "src/weak.test.ts": test("f(1) + g(1)") });
      write(cwd, {
        "src/weak.test.ts": test("f(1)"),
        "src/a.test.ts": test("g(2)"),
        "src/b.test.ts": test("f(3)"),
      });
      commit(cwd, "work");
      const { before, after, keys, mutate } = scopes(cwd);
      expect(after).toEqual(before);
      expect(keys).toEqual(["src/m.ts::f", "src/m.ts::g"]);
      expect(mutate).toEqual(["src/m.ts:1-6"]);
    },
    REAL_TOOL_TIMEOUT * 3,
  );

  it(
    "fails as a run of each alone fails, naming the first file that cannot run",
    () => {
      const cwd = branch({ "src/m.ts": M });
      write(cwd, {
        "src/a.test.ts": test("f(1)"),
        "src/b.test.ts": BREAKS,
        "src/c.test.ts": BREAKS,
      });
      commit(cwd, "work");
      const { before, after } = scopes(cwd);
      expect(after).toEqual(before);
      expect(after).toEqual({
        outcome: "fail",
        reason: "could not run src/b.test.ts to find the functions it covers",
      });
    },
    REAL_TOOL_TIMEOUT * 3,
  );
});
