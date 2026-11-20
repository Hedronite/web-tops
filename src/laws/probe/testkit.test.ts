import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanTemp, put, tempDir } from "./testkit.ts";

describe("G3 testkit: temporary directories a test makes", () => {
  it("makes a directory named for the probe, writes files under it, and cleanTemp removes it and what is in it", () => {
    const dir = tempDir();
    expect(basename(dirname(dir)).startsWith("wt-probe-")).toBe(true);
    expect(basename(dir).startsWith("d-")).toBe(true);
    put(dir, { "a/b/c.txt": "text" });
    expect(readFileSync(join(dir, "a/b/c.txt"), "utf8")).toBe("text");
    cleanTemp();
    expect(existsSync(dir)).toBe(false);
  });

  it("removes every directory made, once, and has nothing to do the second time", () => {
    const first = tempDir();
    const second = tempDir();
    put(second, { "x.txt": "x" });
    cleanTemp();
    expect([existsSync(first), existsSync(second)]).toEqual([false, false]);
    expect(() => {
      cleanTemp();
    }).not.toThrow();
  });

  it("each call makes a new directory", () => {
    const one = tempDir();
    const two = tempDir();
    expect(one).not.toBe(two);
    cleanTemp();
  });

  it("keeps every directory of a run under one parent, and removes that parent", () => {
    const one = tempDir();
    const two = tempDir();
    expect(dirname(one)).toBe(dirname(two));
    cleanTemp();
    expect(existsSync(dirname(one))).toBe(false);
  });

  it("does not fail when a test removed the directory itself first, and starts a new parent after a clean", () => {
    const dir = tempDir();
    rmSync(dirname(dir), { recursive: true });
    expect(() => {
      cleanTemp();
    }).not.toThrow();
    const again = tempDir();
    expect(existsSync(again)).toBe(true);
    expect(dirname(again)).not.toBe(dirname(dir));
    cleanTemp();
  });
});
