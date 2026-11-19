import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanTemp, put, tempDir } from "./testkit.ts";

describe("G3 testkit: temporary directories a test makes", () => {
  it("makes a directory named for the probe, writes files under it, and cleanTemp removes it and what is in it", () => {
    const dir = tempDir();
    expect(basename(dir).startsWith("wt-probe-")).toBe(true);
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
});
