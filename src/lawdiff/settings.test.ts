import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/validate.ts";
import type { WebTopsConfig } from "../config/types.ts";
import { at, notCompared, settingsOf } from "./settings.ts";

const HEAD = 'protocol: "0.3.0"\nversion: "1"\npackage: fixture\nclass: ts-library\n';

function config(extra = ""): WebTopsConfig {
  const read = parseConfig(`${HEAD}${extra}`);
  if (!read.ok) {
    throw new Error(JSON.stringify(read.problems));
  }
  return read.value;
}

const shown = (extra: string, key: string): string | undefined =>
  settingsOf(config(extra)).values.get(key)?.shown;

const rank = (extra: string, key: string): number | undefined =>
  settingsOf(config(extra)).values.get(key)?.rank;

describe("the value at a dotted path of the config", () => {
  it("is what is there, and undefined where the path leaves the config or meets a list", () => {
    const value = { a: { b: 1 }, list: [1] };
    expect(at(value, "a.b")).toBe(1);
    expect(at(value, "a.c")).toBeUndefined();
    expect(at(value, "x.y")).toBeUndefined();
    expect(at(value, "list.0")).toBeUndefined();
    expect(at(undefined, "a")).toBeUndefined();
    expect(at({ a: null }, "a.b")).toBeUndefined();
  });
});

describe("every setting of a default config", () => {
  it("is listed by name with what it is and how tight it holds", () => {
    const rows = [...settingsOf(config()).values.entries()].map(([key, value]) => [
      key,
      value.shown,
      value.rank,
    ]);
    expect(rows).toEqual([
      ["gates.hygiene", "on", 1],
      ["gates.hygiene.install", "on", 1],
      ["gates.hygiene.tsc", "on", 1],
      ["gates.hygiene.eslint", "on", 1],
      ["gates.hygiene.format", "on", 1],
      ["gates.hygiene.dependency_cruiser", "on", 1],
      ["gates.hygiene.audit", "on", 1],
      ["gates.tests", "on", 1],
      ["gates.coverage", "on", 1],
      ["gates.crap", "on", 1],
      ["gates.mutation", "on", 1],
      ["layers.size_limit", "on", 1],
      ["layers.package_exports", "on", 1],
      ["layers.html_validate", "on", 1],
      ["layers.axe", "on", 1],
      ["layers.rendered", "on", 1],
      ["layers.themes", "on", 1],
      ["laws", "on", 1],
      ["gates.coverage.lines_floor", "85", 85],
      ["gates.crap.cap", "4", -4],
      ["gates.mutation.unexplained_survivors_max", "0", -0],
      ["enforce", "ratchet", 1],
      ["gates.crap.scope", "diff", 0],
      ["gates.mutation.scope", "diff", 0],
      ["gates.hygiene.audit.fail_on", "high", 1],
      ["laws.select", "default", 0],
      ["exemption", "none", 1],
      ["gates.tests.shuffle", "on", 1],
      ["baseline", ".web-tops/baseline.json", 0],
      ["gates.mutation.ledger", "unset", 0],
      ["laws.ack_ledger", "unset", 0],
      ["build.dir", "dist", 0],
      ["build.command", "unset", 0],
      ["budgets.class_js_ceiling", "51200", -51200],
    ]);
  });
});

describe("the switches of a config", () => {
  it("are on unless the file says off, and a gate or layer turned off is weaker", () => {
    expect(shown("", "gates.crap")).toBe("on");
    const off = 'gates:\n  crap: { enabled: false, reason: "later" }\n';
    expect(shown(off, "gates.crap")).toBe("off");
    expect(rank(off, "gates.crap")).toBe(0);
    expect(rank("", "gates.crap")).toBe(1);
    const step = 'gates:\n  hygiene:\n    audit: { enabled: false, reason: "offline" }\n';
    expect(shown(step, "gates.hygiene.audit")).toBe("off");
    expect(shown(step, "gates.hygiene")).toBe("on");
    expect(shown('layers:\n  axe: { enabled: false, reason: "later" }\n', "layers.axe")).toBe(
      "off",
    );
    expect(shown('laws: { enabled: false, reason: "later" }\n', "laws")).toBe("off");
  });
});

describe("the floors and caps of a config", () => {
  it("come from the file, else from the class's profile, and a lower floor or a higher cap is weaker", () => {
    expect(shown("", "gates.coverage.lines_floor")).toBe("85");
    expect(shown("gates:\n  coverage: { lines_floor: 70 }\n", "gates.coverage.lines_floor")).toBe(
      "70",
    );
    expect(rank("gates:\n  coverage: { lines_floor: 70 }\n", "gates.coverage.lines_floor")).toBe(
      70,
    );
    expect(shown("", "gates.crap.cap")).toBe("4");
    expect(rank("gates:\n  crap: { cap: 6 }\n", "gates.crap.cap")).toBe(-6);
    expect(shown("", "gates.mutation.unexplained_survivors_max")).toBe("0");
    expect(
      rank(
        "gates:\n  mutation: { unexplained_survivors_max: 2 }\n",
        "gates.mutation.unexplained_survivors_max",
      ),
    ).toBe(-2);
  });
});

describe("the modes of a config", () => {
  it("rank enforce, scopes, the audit threshold and the law selection, the stricter higher", () => {
    expect(rank("enforce: hard\n", "enforce")).toBe(2);
    expect(rank("enforce: ratchet\nbaseline: .web-tops/baseline.json\n", "enforce")).toBe(1);
    expect(rank("enforce: advisory\n", "enforce")).toBe(0);
    expect(shown("", "gates.crap.scope")).toBe("diff");
    expect(rank("gates:\n  crap: { scope: all }\n", "gates.crap.scope")).toBe(1);
    expect(rank("gates:\n  mutation: { scope: all }\n", "gates.mutation.scope")).toBe(1);
    expect(shown("", "gates.hygiene.audit.fail_on")).toBe("high");
    expect(
      rank("gates:\n  hygiene:\n    audit: { fail_on: low }\n", "gates.hygiene.audit.fail_on"),
    ).toBe(3);
    expect(
      rank("gates:\n  hygiene:\n    audit: { fail_on: critical }\n", "gates.hygiene.audit.fail_on"),
    ).toBe(0);
    expect(shown("", "laws.select")).toBe("default");
    expect(rank("laws: { select: all }\n", "laws.select")).toBe(1);
  });
});

describe("what a config grants", () => {
  it("makes an exemption weaker than none, and a later end weaker than an earlier one", () => {
    const granted = 'exemption: { until: "2027-01-01", reason: "legacy" }\n';
    expect(shown(granted, "exemption")).toBe("granted until 2027-01-01");
    expect(rank(granted, "exemption")).toBe(-Date.parse("2027-01-01"));
    expect(shown("", "exemption")).toBe("none");
    expect(rank("", "exemption")).toBe(1);
    const later = 'exemption: { until: "2027-06-01", reason: "legacy" }\n';
    expect(Number(rank(later, "exemption"))).toBeLessThan(Number(rank(granted, "exemption")));
  });

  it("lists every coverage exclusion by its glob, and none when there is none", () => {
    expect(settingsOf(config()).globs).toEqual([]);
    const excluded =
      'gates:\n  coverage:\n    exclude:\n      - { glob: "src/gen/**", reason: "generated" }\n      - { glob: "src/legacy/**", reason: "old" }\n';
    expect(settingsOf(config(excluded)).globs).toEqual(["src/gen/**", "src/legacy/**"]);
  });

  it("makes not shuffling the tests weaker, and takes a moved ledger or baseline for review, not for better or worse", () => {
    expect(rank("gates:\n  tests: { shuffle: false }\n", "gates.tests.shuffle")).toBe(0);
    expect(shown("gates:\n  tests: { shuffle: false }\n", "gates.tests.shuffle")).toBe("off");
    const moved =
      "baseline: other/baseline.json\ngates:\n  mutation: { ledger: .web-tops/ledger.yaml }\nlaws: { ack_ledger: acks.yaml }\n";
    const values = settingsOf(config(moved)).values;
    expect(values.get("baseline")).toEqual({ shown: "other/baseline.json", rank: 0, review: true });
    expect(values.get("gates.mutation.ledger")).toEqual({
      shown: ".web-tops/ledger.yaml",
      rank: 0,
      review: true,
    });
    expect(values.get("laws.ack_ledger")).toEqual({ shown: "acks.yaml", rank: 0, review: true });
  });

  it("compares effective byte budgets and leaves them out of what it does not compare", () => {
    expect(notCompared()).toContain("not compared: gates.tests.runner");
    expect(notCompared()).not.toContain("size budgets");
    expect(settingsOf(config()).values.get("budgets.class_js_ceiling")?.shown).toBe("51200");
    expect(notCompared()).toContain(
      "an .eslintignore file, which ESLint 10 does not read (flat config only)",
    );
  });
});
