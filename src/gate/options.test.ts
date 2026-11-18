import { describe, expect, it } from "vitest";
import { parseGateArgs } from "./options.ts";

/** G4c: the usage errors of `webtops gate`'s flags. */

describe("G4c gate flags that take a value", () => {
  it.each([
    [["--only", "tests", "--only", "coverage"], "--only is given once"],
    [["--only"], "--only takes a layer id"],
    [["--only="], "--only takes a layer id"],
    [["--base"], "--base takes a git ref"],
    [["--max-tier", "9"], "--max-tier takes 0, 1, 2 or 3, got 9"],
    [["--no-such-flag"], 'unknown option "--no-such-flag"'],
    [["stray"], 'unexpected argument "stray"'],
  ])("%j is refused: %s", (argv, error) => {
    expect(parseGateArgs(argv)).toEqual({ ok: false, error });
  });

  it("reads --flag=value and --flag value alike", () => {
    expect(parseGateArgs(["--only=tests", "--base", "develop"])).toMatchObject({
      ok: true,
      options: { only: "tests", base: "develop" },
    });
  });
});
