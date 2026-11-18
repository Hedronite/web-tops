import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import type * as Fs from "node:fs";
import { TOOL_PINS } from "../lock/pins.ts";
import { runInit } from "./run.ts";
import { madeDirs, put, tempDir } from "./test-support.ts";

/** G4c: the ways `webtops init` refuses to write, each with its exit code and a reason. */

const unreadable = vi.hoisted(() => ({ on: false }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>();
  return {
    ...actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      if (unreadable.on && String(args[0]).endsWith("ts-library.yaml")) {
        throw new Error("EACCES: permission denied");
      }
      return actual.readFileSync(...args);
    },
  };
});

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  unreadable.on = false;
});

describe("G4c init refuses, and says why", () => {
  it("exits 3 when a lock tool has no exact version pinned", () => {
    const saved = Reflect.get(TOOL_PINS, "eslint");
    Reflect.deleteProperty(TOOL_PINS, "eslint");
    try {
      const out = runInit({ className: "ts-library", dir: tempDir(), force: false });
      expect(out.code).toBe(3);
      expect(out.problems.join("\n")).toContain("eslint, which has no exact version");
    } finally {
      Reflect.set(TOOL_PINS, "eslint", saved);
    }
  });

  it("exits 3 when a file cannot be written, and names the failure", () => {
    const dir = tempDir();
    put(dir, ".github", "a file where the workflow directory goes\n");
    const out = runInit({ className: "ts-library", dir, force: false });
    expect(out.code).toBe(3);
    expect(out.problems.join("\n")).toContain("could not write");
  });

  it("exits 2 when the class's profile file cannot be read", () => {
    unreadable.on = true;
    const out = runInit({ className: "ts-library", dir: tempDir(), force: false });
    expect(out.code).toBe(2);
    expect(out.problems.join("\n")).toContain("profiles/ts-library.yaml is unreadable");
  });
});
