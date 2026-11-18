import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isScriptFile, readSource, SCRIPT_EXTENSIONS, withinSource } from "./files.ts";

describe("isScriptFile", () => {
  it.each([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"])(
    "is true for %s, and for its upper case",
    (ext) => {
      expect(isScriptFile(`a${ext}`)).toBe(true);
      expect(isScriptFile(`dir/a${ext.toUpperCase()}`)).toBe(true);
    },
  );

  it.each(["a.css", "a.json", "a.md", "a.astro", "a.d", "README", "a.tsx.bak"])(
    "is false for %s",
    (file) => {
      expect(isScriptFile(file)).toBe(false);
    },
  );

  it("lists exactly the eight script extensions", () => {
    expect([...SCRIPT_EXTENSIONS].sort()).toEqual([
      ".cjs",
      ".cts",
      ".js",
      ".jsx",
      ".mjs",
      ".mts",
      ".ts",
      ".tsx",
    ]);
  });
});

describe("withinSource", () => {
  it.each([
    "node_modules/a.ts",
    "dist/a.ts",
    "coverage/a.ts",
    ".web-tops/a.ts",
    "x/.astro/a.ts",
    "pkg/dist/a.ts",
    "a/b/node_modules/c.ts",
  ])("is false for %s", (file) => {
    expect(withinSource(file)).toBe(false);
  });

  it.each([
    "src/a.ts",
    "src/dist-tools/a.ts",
    "distro/a.ts",
    "mynode_modules/a.ts",
    "src/coverage.ts",
  ])("is true for %s", (file) => {
    expect(withinSource(file)).toBe(true);
  });
});

describe("readSource", () => {
  it("reads a file, and is undefined for one that is not there or is a folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-census-files-"));
    try {
      writeFileSync(join(dir, "a.ts"), "hello");
      expect(readSource(dir, "a.ts")).toBe("hello");
      expect(readSource(dir, "missing.ts")).toBeUndefined();
      expect(readSource(dir, ".")).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
