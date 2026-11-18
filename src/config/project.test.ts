import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readProject } from "./project.ts";

const made: string[] = [];

function dirWith(manifest?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-project-"));
  made.push(dir);
  if (manifest !== undefined) writeFileSync(join(dir, "package.json"), manifest);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("readProject: a project depends on Astro when package.json lists astro", () => {
  it.each([
    ["dependencies", '{"dependencies":{"astro":"7.4.0"}}', true],
    ["devDependencies", '{"devDependencies":{"astro":"^7"}}', true],
    ["both", '{"dependencies":{"astro":"7"},"devDependencies":{"astro":"7"}}', true],
    ["peerDependencies only", '{"peerDependencies":{"astro":"7"}}', true],
    [
      "peerDependencies of a package that only starts with astro",
      '{"peerDependencies":{"astro-icon":"1"}}',
      false,
    ],
    ["optionalDependencies only", '{"optionalDependencies":{"astro":"7"}}', false],
    ["a package that only starts with astro", '{"dependencies":{"astro-icon":"1"}}', false],
    ["other dependencies", '{"dependencies":{"react":"19"}}', false],
    ["no dependency tables", '{"name":"x"}', false],
    ["dependencies that are not an object", '{"dependencies":"astro"}', false],
    ["dependencies that are null", '{"dependencies":null,"devDependencies":null}', false],
    ["dependencies that are a list", '{"dependencies":["astro"]}', false],
    ["a manifest that is not an object", "[1, 2]", false],
    ["a manifest that is null", "null", false],
    ["an empty file", "", false],
    ["a file that is not JSON", '{ "name": ', false],
  ])("%s", (_label, manifest, expected) => {
    expect(readProject(dirWith(manifest))).toMatchObject({ dependsOnAstro: expected });
  });

  it("a missing package.json is not Astro", () => {
    expect(readProject(dirWith())).toEqual({ dependsOnAstro: false });
  });

  it("a directory that does not exist is not Astro", () => {
    expect(readProject(join(dirWith(), "no-such-dir"))).toEqual({ dependsOnAstro: false });
  });
});
