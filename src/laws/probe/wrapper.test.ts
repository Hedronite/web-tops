import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemp, put, tempDir } from "./testkit.ts";
import { defaultConfig, wrapperName, wrapperSource, writeWrapper } from "./wrapper.ts";

afterAll(cleanTemp);

/** R109: the twins' type-aware rules read the scratch tsconfig, whatever project the adopter's config names. */

describe("the wrapper config", () => {
  it("imports the project's config and adds one block, for the twins, that points the parser at the scratch tsconfig", () => {
    const text = wrapperSource("/p/eslint.config.js", "/p/.web-tops/out/laws-probe", "/p");
    expect(text).toContain(
      `await import(${JSON.stringify(pathToFileURL("/p/eslint.config.js").href)})`,
    );
    expect(text).toContain("export default [...(Array.isArray(base) ? base : [base]), twins];");
    expect(text).toContain('files: [".web-tops/out/laws-probe/**/*.{ts,tsx,mts,cts,astro}"]');
    expect(text).toContain(
      'parserOptions: {"projectService":false,"project":["/p/.web-tops/out/laws-probe/tsconfig.json"],"tsconfigRootDir":"/p/.web-tops/out/laws-probe"}',
    );
  });

  it("is written beside the scratch directory, not in it, so the probe does not lint it", () => {
    const cwd = tempDir();
    const scratch = join(cwd, ".web-tops", "out", "laws-probe");
    mkdirSync(scratch, { recursive: true });
    const path = writeWrapper(join(cwd, "eslint.config.js"), scratch, cwd);
    expect(path).toBe(join(cwd, ".web-tops", "out", wrapperName()));
    expect(readFileSync(path, "utf8")).toContain("await import(");
    expect(existsSync(join(scratch, wrapperName()))).toBe(false);
  });
});

describe("the config ESLint finds for a project", () => {
  it("is the first of its names in the directory, js before mjs", () => {
    const cwd = tempDir();
    put(cwd, {
      "eslint.config.mjs": "export default [];\n",
      "eslint.config.js": "export default [];\n",
    });
    expect(defaultConfig(cwd)).toBe(join(cwd, "eslint.config.js"));
  });

  it("is the nearest one above when the directory has none, and none when no directory has one", () => {
    const cwd = tempDir();
    put(cwd, { "eslint.config.cts": "export default [];\n", "a/b/x.txt": "x\n" });
    expect(defaultConfig(join(cwd, "a", "b"))).toBe(join(cwd, "eslint.config.cts"));
    expect(defaultConfig("/")).toBeUndefined();
  });
});
