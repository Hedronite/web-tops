import { rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { madeDirs, put, tempDir } from "../init/test-support.ts";
import { field, lockedNodeRange, readConfigDoc, readLockFile } from "./config.ts";

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

describe("field", () => {
  it("reads a key path, and is undefined at the first missing step", () => {
    const doc = { a: { b: { c: 1 } }, n: null };
    expect(field(doc, "a", "b", "c")).toBe(1);
    expect(field(doc, "a", "x", "c")).toBeUndefined();
    expect(field(doc, "n", "c")).toBeUndefined();
    expect(field(undefined, "a")).toBeUndefined();
    expect(field(doc)).toBe(doc);
  });
});

describe("readConfigDoc", () => {
  it("is absent without a web-tops.yaml", () => {
    expect(readConfigDoc(tempDir())).toEqual({ state: "absent" });
  });

  it("reads the bare document, whatever the schema says", () => {
    const dir = tempDir();
    put(dir, "web-tops.yaml", "class: web-app\nsurprise: true\n");
    expect(readConfigDoc(dir)).toEqual({ state: "ok", doc: { class: "web-app", surprise: true } });
  });

  it.each(["a: [unclosed\n", "a: 1\na: 2\n"])("is invalid for %j, with a message", (text) => {
    const dir = tempDir();
    put(dir, "web-tops.yaml", text);
    const read = readConfigDoc(dir);
    expect(read.state).toBe("invalid");
    if (read.state === "invalid") expect(read.error).not.toBe("");
  });
});

describe("readLockFile", () => {
  it("is absent without a lock", () => {
    expect(readLockFile(tempDir())).toEqual({ state: "absent" });
  });

  it("reads a lock", () => {
    const dir = tempDir();
    put(dir, "web-tops.lock", "typescript: 6.0.3\n");
    expect(readLockFile(dir)).toEqual({ state: "ok", lock: { typescript: "6.0.3" } });
  });

  it("names the reason for a lock that does not parse", () => {
    const dir = tempDir();
    put(dir, "web-tops.lock", "typescript: ^6\n");
    const read = readLockFile(dir);
    expect(read.state).toBe("invalid");
    if (read.state === "invalid") expect(read.error).toContain("typescript");
  });
});

describe("lockedNodeRange", () => {
  it("is no range when there is no lock at all", () => {
    expect(lockedNodeRange(tempDir())).toEqual({ range: undefined });
  });

  it("is an error naming the fix when the lock records no node range", () => {
    const dir = tempDir();
    put(dir, "web-tops.lock", "typescript: 6.0.3\n");
    expect(lockedNodeRange(dir)).toEqual({
      error: "web-tops.lock has no node range; run webtops lock --update",
    });
  });

  it("is the range the lock records", () => {
    const dir = tempDir();
    put(dir, "web-tops.lock", 'node: ">=26"\n');
    expect(lockedNodeRange(dir)).toEqual({ range: ">=26" });
  });

  it("is an error for a lock that does not parse", () => {
    const dir = tempDir();
    put(dir, "web-tops.lock", "node: latest\n");
    const result = lockedNodeRange(dir);
    expect("error" in result && result.error).toContain("node");
  });
});
