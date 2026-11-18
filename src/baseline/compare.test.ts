import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { at, get } from "../config/test-support.ts";
import { PROFILES } from "../config/profiles.ts";
import { ratchetBreaches } from "./compare.ts";
import type { Baseline } from "./types.ts";

const FP = (digit: string): string => `fp1:${digit.repeat(16)}`;

const BASE: Baseline = {
  report_version: "2.0.0",
  subject: { package: "p", root: "." },
  crap: {
    "src/a.ts::f": { complexity: 3, coverage: 1, crap: 3 },
    "src/a.ts::g": { complexity: 4, coverage: 1, crap: 4 },
  },
  coverage: { p: { lines_found: 10, lines_hit: 8 } },
  findings: { "no-console": { "src/a.ts": 2 } },
  fingerprints: [FP("a"), FP("b")],
  census: { "v8-ignore": { count: 1, fingerprints: [FP("c")] } },
  pages: { "/": 1000 },
};

function rules(current: Baseline, cap = 4): string[] {
  return ratchetBreaches(BASE, current, cap).map((breach) => breach.rule);
}

function edit(patch: Partial<Baseline>): Baseline {
  return { ...BASE, ...patch };
}

describe("G9b: a rise in any tracked count fails; nothing else does", () => {
  it("has no breach for a baseline against itself", () => {
    expect(rules(BASE)).toEqual([]);
  });

  it.each([
    [
      "CRAP of an existing function up",
      edit({ crap: { ...BASE.crap, "src/a.ts::f": { complexity: 3, coverage: 1, crap: 3.5 } } }),
      ["ratchet-crap-up"],
    ],
    ["CRAP equal", edit({ crap: { ...BASE.crap } }), []],
    [
      "CRAP down",
      edit({ crap: { ...BASE.crap, "src/a.ts::f": { complexity: 2, coverage: 1, crap: 2 } } }),
      [],
    ],
    [
      "a new function at the cap",
      edit({ crap: { ...BASE.crap, "src/b.ts::h": { complexity: 4, coverage: 1, crap: 4 } } }),
      [],
    ],
    [
      "a new function above the cap",
      edit({ crap: { ...BASE.crap, "src/b.ts::h": { complexity: 5, coverage: 1, crap: 5 } } }),
      ["ratchet-crap-new"],
    ],
    [
      "a function removed",
      edit({
        crap: {
          "src/a.ts::f": BASE.crap["src/a.ts::f"] ?? { complexity: 0, coverage: 0, crap: 0 },
        },
      }),
      [],
    ],
    ["coverage up", edit({ coverage: { p: { lines_found: 10, lines_hit: 9 } } }), []],
    [
      "coverage equal at another size",
      edit({ coverage: { p: { lines_found: 20, lines_hit: 16 } } }),
      [],
    ],
    [
      "coverage down by one line",
      edit({ coverage: { p: { lines_found: 10, lines_hit: 7 } } }),
      ["ratchet-coverage-down"],
    ],
    [
      "coverage down because lines were added untested",
      edit({ coverage: { p: { lines_found: 11, lines_hit: 8 } } }),
      ["ratchet-coverage-down"],
    ],
    [
      "no files in the package",
      edit({ coverage: { p: { lines_found: 0, lines_hit: 0 } } }),
      ["ratchet-coverage-down"],
    ],
    [
      "a finding count up",
      edit({ findings: { "no-console": { "src/a.ts": 3 } } }),
      ["ratchet-findings-up"],
    ],
    ["a finding count down", edit({ findings: { "no-console": { "src/a.ts": 1 } } }), []],
    [
      "a finding in a new file",
      edit({ findings: { "no-console": { "src/a.ts": 2, "src/b.ts": 1 } } }),
      ["ratchet-findings-up"],
    ],
    [
      "a finding of a new rule",
      edit({ findings: { ...BASE.findings, "no-var": { "src/a.ts": 1 } } }),
      ["ratchet-findings-up"],
    ],
    ["a file's findings removed", edit({ findings: {} }), []],
    [
      "a census count up",
      edit({ census: { "v8-ignore": { count: 2, fingerprints: [FP("c"), FP("d")] } } }),
      ["ratchet-census-up"],
    ],
    [
      "a census kind that is new",
      edit({ census: { ...BASE.census, "c8-ignore": { count: 1, fingerprints: [FP("d")] } } }),
      ["ratchet-census-up"],
    ],
    ["a census count down", edit({ census: {} }), []],
    ["a page over its baseline", edit({ pages: { "/": 1001 } }), ["ratchet-pages-up"]],
    ["a page under it", edit({ pages: { "/": 900 } }), []],
  ])("%s", (_what, current, expected) => {
    expect(rules(current)).toEqual(expected);
  });

  it("holds a new function to the cap of its class, whatever it is", () => {
    for (const profile of PROFILES) {
      const over = edit({
        crap: {
          ...BASE.crap,
          "src/b.ts::h": { complexity: 9, coverage: 1, crap: profile.crapCap + 0.5 },
        },
      });
      expect(rules(over, profile.crapCap), profile.class).toEqual(["ratchet-crap-new"]);
    }
  });

  it("names the file, the function or rule, and for a census rise the new fingerprint", () => {
    const [crap] = ratchetBreaches(
      BASE,
      edit({ crap: { ...BASE.crap, "src/a.ts::f": { complexity: 3, coverage: 1, crap: 9 } } }),
      4,
    );
    expect(crap).toMatchObject({ layer: "crap", file: "src/a.ts" });
    expect(crap?.message).toContain("src/a.ts::f");
    const [census] = ratchetBreaches(
      BASE,
      edit({ census: { "v8-ignore": { count: 2, fingerprints: [FP("c"), FP("d")] } } }),
      4,
    );
    expect(census).toMatchObject({ layer: "coverage" });
    expect(census?.message).toContain(FP("d"));
    expect(census?.message).not.toContain(FP("c"));
  });

  it("keeps a census count that only moved lines: the same fingerprint is not a new directive", () => {
    expect(rules(edit({ census: { "v8-ignore": { count: 1, fingerprints: [FP("c")] } } }))).toEqual(
      [],
    );
  });

  it("reports a breach for each tracked value that is worse, exactly when it is worse (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 5 }),
        (crap, hit, found, census) => {
          const current = edit({
            crap: { "src/a.ts::f": { complexity: 1, coverage: 1, crap } },
            coverage: { p: { lines_found: 10, lines_hit: hit % 11 } },
            findings: { "no-console": { "src/a.ts": found } },
            census: {
              "v8-ignore": {
                count: census,
                fingerprints: Array.from({ length: census }, (_, index) => FP(String(index))),
              },
            },
          });
          const worse = [crap > 3, hit % 11 < 8, found > 2, census > 1].filter(Boolean).length;
          expect(
            rules(current).filter((rule) => rule !== "ratchet-census-up" || census > 1),
          ).toHaveLength(worse);
        },
      ),
    );
  });
});

describe("R60: the probe's E3 is caught by the census and the ratchet", () => {
  const expected: unknown = parse(
    readFileSync(join(import.meta.dirname, "../../fixtures/probe/EXPECTED.yaml"), "utf8"),
  );
  const cases: unknown = get(expected, "cases");
  const e3: unknown = (Array.isArray(cases) ? cases : []).find(
    (entry) => get(entry, "id") === "e3-v8-ignore",
  );

  it("states the case: one v8-ignore hint, a baseline count of 0, and a ratchet that fails", () => {
    expect(at(e3, ["outcome", "census", "v8-ignore"])).toBe(1);
    expect(at(e3, ["outcome", "ratchet", "baseline_count"])).toBe(0);
    expect(at(e3, ["outcome", "ratchet", "verdict"])).toBe("fail");
  });

  it("fails the ratchet for that count, and passes once the baseline holds the hint", () => {
    const current = edit({
      census: {
        "v8-ignore": {
          count: Number(at(e3, ["outcome", "census", "v8-ignore"])),
          fingerprints: [FP("e")],
        },
      },
    });
    const empty: Baseline = {
      ...BASE,
      census: {
        "v8-ignore": {
          count: Number(at(e3, ["outcome", "ratchet", "baseline_count"])),
          fingerprints: [],
        },
      },
    };
    expect(ratchetBreaches(empty, current, 4).map((breach) => breach.rule)).toEqual([
      "ratchet-census-up",
    ]);
    expect(ratchetBreaches(current, current, 4)).toEqual([]);
  });
});
