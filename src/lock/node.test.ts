import { describe, expect, it } from "vitest";
import { isNodeRange, satisfiesNodeRange } from "./node.ts";
import { NODE_CI, NODE_RANGE } from "./pins.ts";

describe("the Node range section 2 pins", () => {
  it("is the three clauses the pinned tools' engines share", () => {
    expect(NODE_RANGE).toBe("^22.23.4 || ^24.15.0 || >=26");
  });

  it.each([
    ["22.23.3", false],
    ["22.23.4", true],
    ["22.24.0", true],
    ["22.99.99", true],
    ["23.0.0", false],
    ["23.9.9", false],
    ["24.14.9", false],
    ["24.15.0", true],
    ["24.22.3", true],
    ["25.0.0", false],
    ["25.9.9", false],
    ["26.0.0", true],
    ["27.1.0", true],
    ["20.19.0", false],
  ])("Node %s satisfies it: %s", (version, expected) => {
    expect(satisfiesNodeRange(version, NODE_RANGE)).toBe(expected);
  });

  it("accepts a leading v, as process.version writes it", () => {
    expect(satisfiesNodeRange("v24.15.0", NODE_RANGE)).toBe(true);
    expect(satisfiesNodeRange("v25.0.0", NODE_RANGE)).toBe(false);
  });

  it.each(["", "node", "24", "24.15", "24.15.0.1", "x.y.z"])(
    "does not satisfy it for the unreadable version %j",
    (version) => {
      expect(satisfiesNodeRange(version, NODE_RANGE)).toBe(false);
    },
  );

  it("does not satisfy a range it cannot read", () => {
    expect(satisfiesNodeRange("24.15.0", "~24.15.0")).toBe(false);
    expect(satisfiesNodeRange("24.15.0", "")).toBe(false);
  });

  it("does not read a caret on a zero major, which the pinned ranges never use", () => {
    expect(satisfiesNodeRange("0.4.0", "^0.4.0")).toBe(false);
    expect(isNodeRange("^0.4.0")).toBe(false);
  });

  it("reads >=N as N.0.0 and up", () => {
    expect(satisfiesNodeRange("25.9.9", ">=26")).toBe(false);
    expect(satisfiesNodeRange("26.0.0", ">=26")).toBe(true);
    expect(satisfiesNodeRange("24.15.1", ">=24.15.1")).toBe(true);
    expect(satisfiesNodeRange("24.15.0", ">=24.15.1")).toBe(false);
  });
});

describe("isNodeRange", () => {
  it.each([NODE_RANGE, "^22.23.4", ">=26", ">=24.15.0", "^1.2.3 || >=5"])("accepts %j", (text) => {
    expect(isNodeRange(text)).toBe(true);
  });

  it.each([
    "",
    "22.23.4",
    "~22.23.4",
    "^22",
    "latest",
    "^22.23.4 ||",
    "|| >=26",
    ">=26 ||| ^1.2.3",
  ])("rejects %j", (text) => {
    expect(isNodeRange(text)).toBe(false);
  });
});

describe("the Node the generated workflow installs", () => {
  it("is one exact version", () => {
    expect(NODE_CI).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is inside the range the lock records", () => {
    expect(satisfiesNodeRange(NODE_CI, NODE_RANGE)).toBe(true);
  });

  it("is a 24.x release", () => {
    expect(NODE_CI.startsWith("24.")).toBe(true);
  });
});
