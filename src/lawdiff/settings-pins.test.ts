import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/validate.ts";
import type { WebTopsConfig } from "../config/types.ts";
import { settingsOf } from "./settings.ts";

const HEAD = 'protocol: "0.3.0"\nversion: "1"\npackage: fixture\nclass: ts-library\n';

function config(extra = ""): WebTopsConfig {
  const read = parseConfig(`${HEAD}${extra}`);
  if (!read.ok) throw new Error(JSON.stringify(read.problems));
  return read.value;
}

const rank = (extra: string, key: string): number =>
  Number(settingsOf(config(extra)).values.get(key)?.rank);

describe("the coverage exclusions", () => {
  it("are none for a config with none, and one glob for each entry that has a glob", () => {
    expect(settingsOf(config()).globs).toEqual([]);
    const some =
      'gates:\n  coverage:\n    exclude:\n      - { glob: "a/**", reason: "r" }\n      - { glob: "b/**", reason: "r" }\n';
    expect(settingsOf(config(some)).globs).toEqual(["a/**", "b/**"]);
  });

  it("are none when the config says nothing of coverage at all, not a list with something in it", () => {
    expect(settingsOf({ ...config(), gates: {} }).globs).toEqual([]);
  });

  it("skip an entry with no glob, or a glob that is not a string, and keep the rest", () => {
    const odd = config();
    Reflect.set(odd, "gates", {
      coverage: { exclude: [{ reason: "r" }, { glob: 3 }, { glob: "a/**" }, null] },
    });
    expect(settingsOf(odd).globs).toEqual(["a/**"]);
  });
});

describe("the audit threshold", () => {
  it("is ranked critical, high, moderate, low, the lower threshold the stricter", () => {
    const at = (level: string): number =>
      rank(`gates:\n  hygiene:\n    audit: { fail_on: ${level} }\n`, "gates.hygiene.audit.fail_on");
    expect([at("critical"), at("high"), at("moderate"), at("low")]).toEqual([0, 1, 2, 3]);
  });
});
