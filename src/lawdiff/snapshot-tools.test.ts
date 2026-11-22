import { afterAll, describe, expect, it } from "vitest";
import { cleanTemp, put, tempDir } from "../laws/probe/testkit.ts";
import { toolParts } from "./snapshot.ts";
import type { Part } from "./types.ts";

afterAll(cleanTemp);

const stateOf = (part: Part<unknown> | undefined): string | undefined => part?.state;

describe("the scanner's and knip's config in a snapshot", () => {
  it("are left out for a project that keeps neither, which runs on the tools' defaults", () => {
    const found = toolParts(tempDir(), ["src/a.ts"]);
    expect("secretlint" in found).toBe(false);
    expect("knip" in found).toBe(false);
  });

  it("are read when the project keeps them: the scanner's config or ignore file, knip's file or key", () => {
    const dir = tempDir();
    put(dir, { ".secretlintrc.json": '{ "rules": [] }', "knip.json": "{}" });
    const found = toolParts(dir, [".secretlintrc.json", "knip.json"]);
    expect(stateOf(found.secretlint)).toBe("ok");
    expect(stateOf(found.knip)).toBe("ok");
    const ignored = tempDir();
    put(ignored, { ".secretlintignore": "x\n" });
    const ignore = toolParts(ignored, [".secretlintignore"]);
    expect(stateOf(ignore.secretlint)).toBe("ok");
    expect("knip" in ignore).toBe(false);
    const keyed = tempDir();
    put(keyed, { "package.json": '{ "knip": { "ignore": ["a"] } }' });
    const key = toolParts(keyed, []);
    expect(stateOf(key.knip)).toBe("ok");
    expect("secretlint" in key).toBe(false);
  });

  it("say why they cannot be read, as a part that is an error, and the scanner's when the files could not be listed", () => {
    const dir = tempDir();
    put(dir, { ".secretlintrc.json": "{ nope", "knip.json": "{ nope" });
    const found = toolParts(dir, []);
    expect(stateOf(found.secretlint)).toBe("error");
    expect(stateOf(found.knip)).toBe("error");
    expect(stateOf(toolParts(tempDir(), "git ls-files exited 128").secretlint)).toBe("error");
  });
});
