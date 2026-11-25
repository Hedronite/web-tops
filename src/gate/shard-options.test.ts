import { describe, expect, it } from "vitest";
import { parseGateArgs } from "./options.ts";

describe("webtops gate --shard i/n parsing and fail-closed validation", () => {
  it.each([
    ["--shard", "1/2", { index: 1, count: 2 }],
    ["--shard=2/2", undefined, { index: 2, count: 2 }],
    ["--shard", "1/1", { index: 1, count: 1 }],
    ["--shard", "4/4", { index: 4, count: 4 }],
  ] as const)("accepts %s %s", (flag, arg, expected) => {
    const argv = arg === undefined ? [flag] : [flag, arg];
    const parsed = parseGateArgs(argv);
    expect(parsed).toMatchObject({
      ok: true,
      options: {
        maxTier: 1,
        shard: expected,
        keepGoing: false,
        json: false,
        dryRun: false,
        all: false,
      },
    });
    if (parsed.ok) {
      expect("only" in parsed.options).toBe(false);
      expect("base" in parsed.options).toBe(false);
    }
  });

  it("handles default options and --max-tier values cleanly", () => {
    for (const [arg, tier] of [
      ["0", 0],
      ["1", 1],
      ["2", 2],
      ["3", 3],
    ] as const) {
      const parsed = parseGateArgs(["--max-tier", arg]);
      expect(parsed).toMatchObject({ ok: true, options: { maxTier: tier } });
      if (parsed.ok) expect("shard" in parsed.options).toBe(false);
    }
  });

  it.each([
    [["--max-tier"], "--max-tier takes 0, 1, 2 or 3, got nothing"],
    [["--shard"], "--shard takes i/n"],
    [["--shard="], "--shard takes i/n"],
    [["--shard", "1/2", "--shard", "2/2"], "--shard is given once"],
    [["--shard", "0/2"], "--shard takes i/n (positive integers), got 0/2"],
    [["--shard", "1/0"], "--shard takes i/n (positive integers), got 1/0"],
    [["--shard", "1"], "--shard takes i/n (positive integers), got 1"],
    [["--shard", "1/2/3"], "--shard takes i/n (positive integers), got 1/2/3"],
    [["--shard", "-1/2"], "--shard takes i/n (positive integers), got -1/2"],
    [["--shard", "1.5/2"], "--shard takes i/n (positive integers), got 1.5/2"],
    [["--shard", "01/02"], "--shard takes i/n (positive integers), got 01/02"],
    [["--shard", "1a/2"], "--shard takes i/n (positive integers), got 1a/2"],
    [["--shard", "1/2a"], "--shard takes i/n (positive integers), got 1/2a"],
    [["--shard", "3/2"], "--shard index must not exceed count (1 <= i <= n), got 3/2"],
    [["--shard", "12/2"], "--shard index must not exceed count (1 <= i <= n), got 12/2"],
    [["--shard", "1/5"], "--shard supports at most 4 shards, got 1/5"],
    [["--shard", "1/12"], "--shard supports at most 4 shards, got 1/12"],
    [["--shard", "5/5"], "--shard supports at most 4 shards, got 5/5"],
  ])("refuses %j with usage error: %s", (argv, error) => {
    expect(parseGateArgs(argv)).toEqual({ ok: false, error });
  });
});
