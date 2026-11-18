import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { realExec } from "../../gate/exec.ts";
import { REPO_ROOT, SOURCE, realProject, runTests, testFile, type Project } from "./testkit.ts";
import { REAL_TOOL_TIMEOUT } from "../../gate/test-support-timeouts.ts";

const projects: Project[] = [];

afterEach(() => {
  for (const item of projects.splice(0)) item.project.cleanup();
});

function linked(files: Record<string, string> = {}): Project {
  const item = realProject(files);
  projects.push(item);
  return item;
}

const KIT_CACHE = join(REPO_ROOT, "node_modules", ".vitest-cache", "_metadata.json");

function kitCache(): string | undefined {
  return existsSync(KIT_CACHE) ? readFileSync(KIT_CACHE, "utf8") : undefined;
}

// G7-3. Vitest keeps its module cache in `<workspace root>/node_modules/.vitest-cache` and clears it
// when the lockfile hash in its metadata differs. A linked temp project that shares the kit's
// `node_modules` would write the kit's cache with an empty lockfile hash and clear it under the
// outer run, which reads it: one cold run in six failed with ENOENT.
describe("G7-3: a linked temp project keeps Vitest's caches to itself", () => {
  it("has its own node_modules directory, not a link to the kit's", () => {
    const modules = join(linked().project.dir, "node_modules");
    expect(lstatSync(modules).isDirectory()).toBe(true);
    expect(lstatSync(modules).isSymbolicLink()).toBe(false);
  });

  it.each([".vitest-cache", ".vite", ".vite-temp"])("does not link the kit's %s", (name) => {
    expect(existsSync(join(linked().project.dir, "node_modules", name))).toBe(false);
  });

  it.each(["vitest", "vite", "@vitest/coverage-v8", "typescript"])(
    "still reaches the kit's %s",
    (name) => {
      const modules = join(linked().project.dir, "node_modules");
      const kit = join(REPO_ROOT, "node_modules");
      expect(realpathSync(join(modules, name, "package.json"))).toBe(
        realpathSync(join(kit, name, "package.json")),
      );
    },
  );

  it(
    "leaves the kit's cache metadata as it was after a real run",
    async () => {
      const before = kitCache();
      const item = linked({
        "src/a.ts": SOURCE,
        "src/a.test.ts": testFile('it("adds", () => { expect(add(1, 2)).toBe(3); });'),
      });
      expect((await runTests(item, realExec)).verdict).toBe("pass");
      expect(kitCache()).toBe(before);
    },
    REAL_TOOL_TIMEOUT,
  );
});
