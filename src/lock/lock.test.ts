import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { parseLock, serializeLock } from "./format.ts";
import { NODE_RANGE, TOOL_PINS } from "./pins.ts";

const fixture = (name: string): string =>
  readFileSync(resolve(import.meta.dirname, "../../fixtures/lock", name), "utf8");

describe("web-tops.lock format", () => {
  it("parses a map of tool to exact version", () => {
    const result = parseLock(fixture("valid.lock"));
    expect(result).toEqual({
      ok: true,
      lock: { eslint: "9.39.5", typescript: "6.0.3", webtops: "0.0.0" },
    });
  });

  it.each([
    ["range.lock", "eslint"],
    ["not-a-map.lock", "map"],
    ["empty.lock", "empty"],
  ])("rejects %s and says why", (name, word) => {
    const result = parseLock(fixture(name));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(word);
  });

  it.each(["6.0", "^6.0.3", "latest", "6.0.3 ", ""])("rejects the version %j", (version) => {
    expect(parseLock(`typescript: "${version}"\n`).ok).toBe(false);
  });

  it("rejects a version written as a bare YAML number", () => {
    expect(parseLock("typescript: 6.0\n").ok).toBe(false);
  });

  it("reads node as a range, the one entry that is not an exact version", () => {
    expect(parseLock('node: "^22.23.4 || ^24.15.0 || >=26"\nwebtops: "0.0.0"\n')).toEqual({
      ok: true,
      lock: { node: "^22.23.4 || ^24.15.0 || >=26", webtops: "0.0.0" },
    });
  });

  it.each(["24.15.0", "latest", "~24.15.0", "^24", ""])("rejects the node value %j", (value) => {
    const result = parseLock(`node: "${value}"\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("node");
  });

  it("still holds every other tool to an exact version when node is present", () => {
    expect(parseLock('node: ">=26"\ntypescript: "^6.0.3"\n').ok).toBe(false);
  });

  it("rejects text that is not YAML", () => {
    expect(parseLock("a: [unclosed\n").ok).toBe(false);
  });

  it("serializes sorted, with a header comment and a final newline", () => {
    const text = serializeLock({ webtops: "0.0.0", typescript: "6.0.3", "@eslint/js": "9.39.5" });
    expect(text.startsWith("# web-tops.lock")).toBe(true);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
    const keys = text
      .split("\n")
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => line.split(":")[0]?.replaceAll('"', ""));
    expect(keys).toEqual(["@eslint/js", "typescript", "webtops"]);
  });

  it("round-trips the node range", () => {
    const lock = { node: NODE_RANGE, typescript: "6.0.3", webtops: "0.0.0" };
    expect(parseLock(serializeLock(lock))).toEqual({ ok: true, lock });
  });

  it("round-trips through parse", () => {
    const lock = { "@vitest/coverage-v8": "5.1.0", typescript: "6.0.3", webtops: "0.0.0" };
    expect(parseLock(serializeLock(lock))).toEqual({ ok: true, lock });
  });

  it("serializes the same map to the same bytes whatever the key order", () => {
    expect(serializeLock({ b: "1.0.0", a: "2.0.0" })).toBe(
      serializeLock({ a: "2.0.0", b: "1.0.0" }),
    );
  });
});

describe("tool pins", () => {
  it("are all exact versions, not ranges", () => {
    for (const [tool, version] of Object.entries(TOOL_PINS)) {
      expect(version, tool).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("agree with the kit's own exact pins in package.json", () => {
    const own: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [tool, version] of Object.entries(TOOL_PINS)) {
      const installed = own[tool];
      if (installed !== undefined) expect(installed, tool).toBe(version);
    }
  });

  it("cover the section 2 tools the M1 gates run", () => {
    for (const tool of [
      "typescript",
      "eslint",
      "typescript-eslint",
      "vitest",
      "@vitest/coverage-v8",
    ]) {
      expect(TOOL_PINS, tool).toHaveProperty(tool);
    }
  });
});
