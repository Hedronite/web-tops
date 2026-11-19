import { describe, expect, it } from "vitest";
import { parseFlags } from "./flags.ts";

const spec = { values: ["--class", "--reason"], switches: ["--json", "--check"] };

/** The parse as plain data, or the problem text. */
function parsed(argv: readonly string[]): unknown {
  const flags = parseFlags(argv, spec);
  if (typeof flags === "string") return flags;
  return {
    positionals: flags.positionals,
    values: Object.fromEntries(flags.values),
    switches: [...flags.switches],
  };
}

describe("parseFlags", () => {
  it("splits words, options with values and switches", () => {
    expect(parsed(["W-01", "--json", "--class", "web-app", "W-02"])).toEqual({
      positionals: ["W-01", "W-02"],
      values: { "--class": "web-app" },
      switches: ["--json"],
    });
  });

  it("reads --name=value as --name value, keeping any further = in the value", () => {
    expect(parsed(["--class=web-app", "--reason=a=b"])).toEqual({
      positionals: [],
      values: { "--class": "web-app", "--reason": "a=b" },
      switches: [],
    });
  });

  it("splits only for an option that starts with two dashes, and at its first =", () => {
    expect(parsed(["--=x"])).toBe("unknown option --");
    expect(parsed(["a=b"])).toEqual({ positionals: ["a=b"], values: {}, switches: [] });
    expect(parsed(["=x"])).toEqual({ positionals: ["=x"], values: {}, switches: [] });
    expect(parsed(["--json=x"])).toEqual({ positionals: ["x"], values: {}, switches: ["--json"] });
  });

  it("says which option is unknown, and which needs a value", () => {
    expect(parsed(["--nope"])).toBe("unknown option --nope");
    expect(parsed(["--class"])).toBe("--class needs a value");
    expect(parsed(["--json", "--reason"])).toBe("--reason needs a value");
  });

  it("takes the word after a value option as its value, even when it looks like an option", () => {
    expect(parsed(["--reason", "--json"])).toEqual({
      positionals: [],
      values: { "--reason": "--json" },
      switches: [],
    });
  });

  it("is empty for no arguments", () => {
    expect(parsed([])).toEqual({ positionals: [], values: {}, switches: [] });
  });

  it("stops at the first problem", () => {
    expect(parsed(["--nope", "--also"])).toBe("unknown option --nope");
  });

  it("takes a spec with no value options: every option that is not a switch is unknown", () => {
    expect(parseFlags(["--class", "x"], { switches: ["--json"] })).toBe("unknown option --class");
    const flags = parseFlags(["--json"], { switches: ["--json"] });
    expect(typeof flags === "string" ? flags : [...flags.switches]).toEqual(["--json"]);
  });
});
