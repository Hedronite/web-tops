import { rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { madeDirs, put, tempDir } from "../init/test-support.ts";
import { candidateTools } from "./candidates.ts";
import { parseLock } from "./format.ts";
import { chromiumState } from "./environment.ts";
import { compareVersions } from "./installed.ts";
import { TOOL_PINS } from "./pins.ts";

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

describe("candidateTools: the order the lock lists its tools in", () => {
  it("is the pins in code-unit order, so pins.ts is kept sorted", () => {
    const pinned = Object.keys(TOOL_PINS);
    expect(pinned).toEqual([...pinned].sort());
    expect(candidateTools(tempDir())).toEqual({ ok: true, names: pinned });
  });

  it("keeps that order for the tools a package.json declares", () => {
    const dir = tempDir();
    put(
      dir,
      "package.json",
      JSON.stringify({ devDependencies: { vitest: "5.1.0", eslint: "10.15.0" }, name: "x" }),
    );
    expect(candidateTools(dir)).toEqual({ ok: true, names: ["eslint", "vitest"] });
  });
});

describe("parseLock: the messages", () => {
  it("says an empty map is empty", () => {
    expect(parseLock("{}\n")).toEqual({ ok: false, error: "web-tops.lock is empty" });
  });

  it("says a lock that is not YAML is not valid YAML, with why", () => {
    const parsed = parseLock("a: [unclosed\n");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.startsWith("web-tops.lock is not valid YAML: ")).toBe(true);
  });
});

describe("compareVersions: the longer version decides when the shorter is a prefix of it", () => {
  it.each([
    ["1.4", "1.4.1", -1],
    ["1.4.1", "1.4", 1],
    ["1.4", "1.4.0", 0],
  ])("%s against %s has the sign %i", (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign);
  });
});

describe("chromiumState: no browsers.json", () => {
  it("is missing, even when a directory named for no revision is there", () => {
    const cwd = tempDir();
    put(cwd, "node_modules/@playwright/test/package.json", JSON.stringify({ version: "1.65.1" }));
    const browsers = tempDir();
    put(browsers, "chromium-undefined/INSTALLATION_COMPLETE", "");
    const env = { PLAYWRIGHT_BROWSERS_PATH: browsers };
    expect(chromiumState(cwd, env, "linux", tempDir())).toBe("missing");
  });
});

describe("compareVersions: what is read from the text", () => {
  it.each([
    ["a leading v", "v1.2", "1.2", 0],
    ["a v that is not leading", "1.v2.3", "1.0.3", 0],
    ["a prerelease tag", "1.2.3-beta.4", "1.2.3", 0],
    ["a tag that runs to the end of a line only", "1.2-3.4\n5", "1.2.4", 0],
  ])("%s", (_, a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign);
  });
});
