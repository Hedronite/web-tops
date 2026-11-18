import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { toGateConfig } from "../gate/adapter.ts";
import { readProject } from "./project.ts";
import { containing, get, objectLike } from "./test-support.ts";
import { checkConfigFile, parseConfig } from "./validate.ts";

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const HEAD = 'protocol: "0.3.0"\nversion: "1"\npackage: p\nclass: ts-library\nenforce: hard\n';
const SKIP = "layers:\n  package_exports:\n    skip_private: the package is never published\n";
const OFF = 'layers:\n  package_exports: { enabled: false, reason: "not needed" }\n';

function project(manifest: string | undefined, yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-private-"));
  made.push(dir);
  mkdirSync(dir, { recursive: true });
  if (manifest !== undefined) writeFileSync(join(dir, "package.json"), manifest);
  writeFileSync(join(dir, "web-tops.yaml"), yaml);
  return join(dir, "web-tops.yaml");
}

const POINTER = "/layers/package_exports/skip_private";

describe("G3c: package_exports may be skipped for a private package, with a reason", () => {
  it("passes check when package.json beside the config says private: true", () => {
    expect(checkConfigFile(project('{"private": true}', HEAD + SKIP)).ok).toBe(true);
  });

  it.each([
    ["private: false", '{"private": false}'],
    ["no private field", "{}"],
    ["a string, not a boolean", '{"private": "true"}'],
    ["a package.json that does not parse", "{ not json"],
    ["no package.json", undefined],
  ])("exits 2 at the key when the package is not private: %s", (_what, manifest) => {
    const result = checkConfigFile(project(manifest, HEAD + SKIP));
    expect(get(result, "problems")).toEqual([
      { pointer: POINTER, message: containing('"private": true') },
    ]);
  });

  it("still refuses enabled: false under hard, with or without a private package", () => {
    const result = checkConfigFile(project('{"private": true}', HEAD + OFF));
    expect(get(result, "problems")).toEqual([
      { pointer: "/layers/package_exports/enabled", message: containing("cannot be switched off") },
    ]);
  });

  it("refuses a blank reason and the key on any other layer", () => {
    const blank = parseConfig(`${HEAD}layers:\n  package_exports:\n    skip_private: "  "\n`);
    expect(get(blank, "problems")).toContainEqual(objectLike({ pointer: POINTER }));
    const other = parseConfig(`${HEAD}layers:\n  size_limit:\n    skip_private: why\n`);
    expect(get(other, "problems")).toContainEqual(
      objectLike({ pointer: "/layers/size_limit/skip_private" }),
    );
  });

  it("is read by the project reader: only a boolean true is private", () => {
    expect(readProject(join(project('{"private": true}', ""), "..")).isPrivate).toBe(true);
    expect(readProject(join(project('{"private": "true"}', ""), "..")).isPrivate).toBe(false);
    expect(readProject(join(project(undefined, ""), "..")).isPrivate).toBeUndefined();
  });

  it("makes the runner skip the step with the stated reason, and only for a private package", () => {
    const parsed = parseConfig(HEAD + SKIP);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const steps = (isPrivate: boolean): unknown =>
      get(
        get(toGateConfig(parsed.value, { dependsOnAstro: false, isPrivate }), "hygiene"),
        "steps",
      );
    expect(get(steps(true), "package_exports")).toEqual({
      enabled: false,
      reason: "the package is never published",
    });
    expect(get(steps(false), "package_exports")).toBeUndefined();
  });
});
