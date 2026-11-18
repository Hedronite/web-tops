import { rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { madeDirs, put, tempDir } from "../init/test-support.ts";
import { candidateTools, declaredNames } from "./candidates.ts";
import { TOOL_PINS } from "./pins.ts";

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

const withPackage = (doc: unknown): string => {
  const dir = tempDir();
  put(dir, "package.json", JSON.stringify(doc));
  return dir;
};

const namesIn = (dir: string): string[] => {
  const found = candidateTools(dir);
  return found.ok ? found.names : [];
};

describe("declaredNames", () => {
  it("reads dependencies and devDependencies, whatever the version spec", () => {
    const doc = {
      dependencies: { a: "1.0.0" },
      devDependencies: { b: "^2.0.0", c: "workspace:*" },
    };
    expect([...declaredNames(doc)].sort()).toEqual(["a", "b", "c"]);
  });

  it.each([
    [null],
    [undefined],
    ["text"],
    [[]],
    [{}],
    [{ dependencies: "x" }],
    [{ dependencies: null }],
  ])("reads nothing from %j", (doc) => {
    expect(declaredNames(doc).size).toBe(0);
  });

  it("ignores peer and optional dependencies", () => {
    expect(
      declaredNames({ peerDependencies: { p: "1" }, optionalDependencies: { o: "1" } }).size,
    ).toBe(0);
  });
});

describe("candidateTools", () => {
  it("is every tool pins.ts pins, sorted, when the project has no package.json", () => {
    expect(candidateTools(tempDir())).toEqual({ ok: true, names: Object.keys(TOOL_PINS).sort() });
  });

  it("keeps the pinned tools the package.json declares, and drops the pinned ones it does not", () => {
    const dir = withPackage({ devDependencies: { vitest: "5.1.0", "fast-check": "4.10.2" } });
    expect(namesIn(dir)).toEqual(["fast-check", "vitest"]);
  });

  it("never offers a library section 2 does not pin, declared or not", () => {
    const dir = withPackage({
      dependencies: { ajv: "8.20.0", react: "19.0.0" },
      devDependencies: { vitest: "5.1.0" },
    });
    expect(namesIn(dir)).toEqual(["vitest"]);
  });

  it("never offers webtops or node, which the lock handles itself", () => {
    const dir = withPackage({ dependencies: { webtops: "0.2.0", node: "24.0.0" } });
    expect(namesIn(dir)).toEqual([]);
  });

  it("holds the section 2 law readers when they are declared, fast-check included", () => {
    const dir = withPackage({
      devDependencies: { "fast-check": "4.10.2", "@vitest/eslint-plugin": "1.6.28" },
    });
    expect(namesIn(dir)).toEqual(["@vitest/eslint-plugin", "fast-check"]);
  });

  it("fails on a package.json that is not valid JSON, naming the file", () => {
    const dir = tempDir();
    put(dir, "package.json", "{ not json");
    const found = candidateTools(dir);
    expect(found.ok).toBe(false);
    expect(!found.ok && found.error).toContain("package.json");
  });
});
