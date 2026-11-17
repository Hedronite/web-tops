import { rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { madeDirs, put, tempDir } from "../init/test-support.ts";
import { compareVersions, installedVersion } from "./installed.ts";

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

describe("installedVersion", () => {
  it("reads the version from node_modules/<tool>/package.json, scoped names included", () => {
    const dir = tempDir();
    put(dir, "node_modules/typescript/package.json", '{"version":"6.0.3"}');
    put(dir, "node_modules/@vitest/coverage-v8/package.json", '{"version":"5.1.0"}');
    expect(installedVersion(dir, "typescript")).toBe("6.0.3");
    expect(installedVersion(dir, "@vitest/coverage-v8")).toBe("5.1.0");
  });

  it.each([
    ["is not installed", undefined],
    ["is not JSON", "{nope"],
    ["is not an object", "[1]"],
    ["has no version", "{}"],
    ["has a version that is not text", '{"version":6}'],
    ["has an empty version", '{"version":""}'],
  ])("is undefined when the package %s", (_name, text) => {
    const dir = tempDir();
    if (text !== undefined) put(dir, "node_modules/typescript/package.json", text);
    expect(installedVersion(dir, "typescript")).toBeUndefined();
  });
});

describe("compareVersions", () => {
  it.each([
    ["1.4.4", "1.4.0", 1],
    ["1.4.0", "1.4.4", -1],
    ["1.4.4", "1.4.4", 0],
    ["2.0.0", "1.99.99", 1],
    ["22.23.4", "22.9.0", 1],
    ["v24.15.0", "24.15.0", 0],
    ["1.4", "1.4.0", 0],
    ["1.4.4-beta.1", "1.4.4", 0],
  ])("%s against %s has sign %i", (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign);
  });
});
