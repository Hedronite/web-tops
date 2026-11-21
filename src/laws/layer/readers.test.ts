import { describe, expect, it } from "vitest";
import { artifactOf, defaultReaders, optionalArtifacts } from "./readers.ts";

describe("G4 the artifact each tool's reader reads", () => {
  it("is the JSON of attw, dependency-cruiser and publint, by the tool", () => {
    expect(artifactOf({ tool: "attw", name: "profile" })).toBe("attw-json");
    expect(artifactOf({ tool: "dependency-cruiser", name: "no-circular" })).toBe(
      "dependency-cruiser-json",
    );
    expect(artifactOf({ tool: "publint", name: "pack" })).toBe("publint-json");
  });

  it("follows the rule for bun, which runs two checks", () => {
    expect(artifactOf({ tool: "bun", name: "audit" })).toBe("audit-json");
    expect(artifactOf({ tool: "bun", name: "install --frozen-lockfile" })).toBe("install-json");
    expect(artifactOf({ tool: "bun", name: "pack" })).toBeUndefined();
  });

  it("is none for a rule read from gate 1's ESLint or compiler output, and for a rule of bun's by another tool's name", () => {
    expect(artifactOf({ tool: "eslint", name: "no-explicit-any" })).toBeUndefined();
    expect(artifactOf({ tool: "tsc", name: "strict" })).toBeUndefined();
    expect(artifactOf({ tool: "eslint", name: "audit" })).toBeUndefined();
    expect(artifactOf({ tool: "knip", name: "install --frozen-lockfile" })).toBeUndefined();
  });

  it("lists every optional artifact once, in name order", () => {
    expect(optionalArtifacts()).toEqual([
      "attw-json",
      "audit-json",
      "dependency-cruiser-json",
      "install-json",
      "publint-json",
    ]);
  });

  it("registers the reader of each tool the catalog's laws name that one reads, and no other", () => {
    expect([...defaultReaders().keys()]).toEqual([
      "attw",
      "bun",
      "dependency-cruiser",
      "eslint",
      "publint",
      "tsc",
    ]);
  });
});
