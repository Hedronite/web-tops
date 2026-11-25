import { describe, expect, it } from "vitest";
import { parseGateArgs } from "./options.ts";

describe("webtops gate --join <dir> parsing and conflict checks", () => {
  it("accepts --join <dir> and --join=<dir> and omits join when absent", () => {
    const spaced = parseGateArgs(["--join", "shards"]);
    expect(spaced).toMatchObject({ ok: true, options: { join: "shards" } });
    const eq = parseGateArgs(["--join=out/shards"]);
    expect(eq).toMatchObject({ ok: true, options: { join: "out/shards" } });
    const absent = parseGateArgs([]);
    expect(absent.ok).toBe(true);
    if (absent.ok) expect("join" in absent.options).toBe(false);
  });

  it.each([
    [["--join"], "--join takes a directory"],
    [["--join="], "--join takes a directory"],
    [["--join", "a", "--join", "b"], "--join is given once"],
    [["--join", "a", "--shard", "1/2"], "--join and --shard cannot be used together"],
    [["--shard", "1/2", "--join", "a"], "--join and --shard cannot be used together"],
    [["--join", "a", "--only", "mutation"], "--join and --only cannot be used together"],
  ])("refuses %j: %s", (argv, error) => {
    expect(parseGateArgs(argv)).toEqual({ ok: false, error });
  });
});
