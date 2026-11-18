import { describe, expect, it } from "vitest";
import { cfg } from "../../gate/testkit.ts";
import { matchesGlob } from "./glob.ts";
import { DEFAULT_COVERAGE_EXCLUDES, excludesOf, inScope } from "./scope.ts";

/** G2-1: the default excludes for output folders name the project root's folders, not any folder of that name. */

const excludes = excludesOf(cfg());

describe("G2-1 a source folder named like an output folder stays in scope", () => {
  it.each([
    "src/layers/coverage/index.ts",
    "src/layers/coverage/lcov.ts",
    "src/coverage/report.ts",
    "src/dist/build.ts",
    "src/node_modules_shim/a.ts",
    "src/deep/dist/a.tsx",
    "src/.web-tops-cache/a.ts",
  ])("%s is in scope", (file) => {
    expect(inScope(file, excludes)).toBe(true);
  });

  it.each([
    "coverage/lcov-report/prettify.ts",
    "dist/index.ts",
    ".web-tops/out/tests/a.ts",
    "node_modules/pkg/index.ts",
  ])("the project root's %s is not", (file) => {
    expect(excludes.some((glob) => matchesGlob(file, glob))).toBe(true);
  });

  it("anchors the four output folders and keeps no unanchored form of them", () => {
    for (const folder of ["coverage", "dist", ".web-tops", "node_modules"]) {
      expect(DEFAULT_COVERAGE_EXCLUDES, folder).toContain(`${folder}/**`);
      expect(DEFAULT_COVERAGE_EXCLUDES, folder).not.toContain(`**/${folder}/**`);
    }
  });

  it("still leaves out declarations, test files, generated code and config files wherever they sit", () => {
    for (const file of [
      "src/a.d.ts",
      "src/deep/b.test.ts",
      "src/__tests__/c.ts",
      "src/__generated__/d.ts",
      "src/e.generated.ts",
      "src/vitest.config.ts",
    ]) {
      expect(inScope(file, excludes), file).toBe(false);
    }
  });
});
