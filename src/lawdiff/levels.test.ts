import { describe, expect, it } from "vitest";
import { comparedOf, compareLevels, type Renames } from "./levels.ts";
import type { Rules } from "./types.ts";

const none: Renames = new Map();

type Table = Record<string, Record<string, number | [number, string]>>;

const rules = (table: Table): Rules =>
  new Map(
    Object.entries(table).map(([file, settings]) => [
      file,
      new Map(
        Object.entries(settings).map(([rule, value]) => [
          rule,
          typeof value === "number"
            ? { level: value, options: "[]" }
            : { level: value[0], options: value[1] },
        ]),
      ),
    ]),
  );

const diff = (base: Table, head: Table, tracked: string[] = Object.keys(head)) =>
  compareLevels(rules(base), rules(head), none, tracked);

describe("the ESLint levels that moved", () => {
  it("names a rule whose level fell, with the file and what it was and is", () => {
    expect(diff({ "src/a.ts": { r: 2, w: 1 } }, { "src/a.ts": { r: 0, w: 1 } })).toEqual([
      { what: "r", change: "weakened", before: "error", after: "off", where: "src/a.ts" },
    ]);
    expect(diff({ "src/a.ts": { r: 2 } }, { "src/a.ts": { r: 1 } })[0]).toMatchObject({
      before: "error",
      after: "warn",
    });
  });

  it("counts a rule that is no longer set as off, and one that is newly set as stronger", () => {
    expect(diff({ "src/a.ts": { r: 2 } }, { "src/a.ts": {} })[0]).toMatchObject({
      what: "r",
      change: "weakened",
      after: "off",
    });
    expect(diff({ "src/a.ts": {} }, { "src/a.ts": { r: 2 } })).toEqual([
      { what: "r", change: "strengthened", before: "off", after: "error", where: "src/a.ts" },
    ]);
  });

  it("says how many more files moved, lists weaker before stronger, and each rule once in name order", () => {
    const base = { "a.ts": { z: 2, y: 0 }, "b.ts": { z: 2, y: 0 }, "c.ts": { z: 2, y: 0 } };
    const head = { "a.ts": { z: 0, y: 2 }, "b.ts": { z: 0, y: 2 }, "c.ts": { z: 1, y: 2 } };
    expect(diff(base, head)).toEqual([
      { what: "z", change: "weakened", before: "error", after: "off", where: "a.ts and 2 more" },
      {
        what: "y",
        change: "strengthened",
        before: "off",
        after: "error",
        where: "a.ts and 2 more",
      },
    ]);
    const two = diff({ "a.ts": { zed: 2, alpha: 2 } }, { "a.ts": { zed: 0, alpha: 0 } });
    expect(two.map((item) => item.what)).toEqual(["alpha", "zed"]);
  });
});

describe("the options of a rule that is on", () => {
  it("are for review when they differ at the same level, and shown beside the level", () => {
    const items = diff(
      { "a.ts": { "no-restricted-imports": [2, '[{"paths":["a"]}]'] } },
      { "a.ts": { "no-restricted-imports": [2, '[{"paths":["a","b"]}]'] } },
    );
    expect(items).toEqual([
      {
        what: "no-restricted-imports",
        change: "changed",
        before: 'error [{"paths":["a"]}]',
        after: 'error [{"paths":["a","b"]}]',
        where: "a.ts",
      },
    ]);
  });

  it("are weaker when the number a ceiling rule allows rose, by a number or by its max", () => {
    expect(
      diff({ "a.ts": { complexity: [2, "[4]"] } }, { "a.ts": { complexity: [2, "[20]"] } })[0],
    ).toMatchObject({
      change: "weakened",
      before: "error [4]",
      after: "error [20]",
    });
    const byMax = diff(
      { "a.ts": { "max-lines": [2, '[{"max":300}]'] } },
      { "a.ts": { "max-lines": [2, '[{"max":900}]'] } },
    );
    expect(byMax[0]?.change).toBe("weakened");
    for (const rule of ["max-depth", "max-params", "max-statements", "max-nested-callbacks"]) {
      const moved = diff({ "a.ts": { [rule]: [2, "[3]"] } }, { "a.ts": { [rule]: [2, "[4]"] } });
      expect(moved[0]?.change, rule).toBe("weakened");
    }
  });

  it("are for review, not weaker, when a ceiling fell, stayed the same, or cannot be read as a number", () => {
    const change = (before: string, after: string): string | undefined =>
      diff({ "a.ts": { complexity: [2, before] } }, { "a.ts": { complexity: [2, after] } })[0]
        ?.change;
    expect(change("[20]", "[4]")).toBe("changed");
    expect(change("[4]", '[{"max":4}]')).toBe("changed");
    expect(change("[4]", '[{"variant":"x"}]')).toBe("changed");
    expect(change("[4]", "[]")).toBe("changed");
    expect(change("[]", "[4]")).toBe("changed");
    expect(change("[4]", "not json")).toBe("changed");
    expect(change("[4]", "[4]")).toBeUndefined();
  });

  it("are not compared for a rule that is off in either ref, and a rule that is not a ceiling is not weaker for a bigger number", () => {
    expect(
      diff({ "a.ts": { complexity: [0, "[4]"] } }, { "a.ts": { complexity: [0, "[20]"] } }),
    ).toEqual([]);
    const other = diff(
      { "a.ts": { "no-magic-numbers": [2, "[4]"] } },
      { "a.ts": { "no-magic-numbers": [2, "[20]"] } },
    );
    expect(other[0]?.change).toBe("changed");
  });

  it("lists a level that fell before an option that changed, and an option change only when the level held", () => {
    const items = diff(
      { "a.ts": { complexity: [2, "[4]"], r: 2 } },
      { "a.ts": { complexity: [1, "[20]"], r: 0 } },
    );
    expect(items.map((item) => [item.what, item.change])).toEqual([
      ["complexity", "weakened"],
      ["r", "weakened"],
    ]);
  });
});

describe("a file ESLint no longer reaches", () => {
  it("is weaker for every rule the base held on, where the head tracks it, and says it is no longer linted", () => {
    const base = { "src/a.ts": { r: 2, w: 1, off: 0 } };
    const items = compareLevels(rules(base), rules({}), none, ["src/a.ts"]);
    expect(items).toEqual([
      {
        what: "r",
        change: "weakened",
        before: "error",
        after: "no longer linted",
        where: "src/a.ts",
      },
      {
        what: "w",
        change: "weakened",
        before: "warn",
        after: "no longer linted",
        where: "src/a.ts",
      },
    ]);
  });

  it("is weaker whether an ignore dropped the file or a narrower files glob did, and says how many", () => {
    const base = { "src/a.ts": { r: 2 }, "src/b.ts": { r: 2 }, "lib/c.ts": { r: 2 } };
    const items = compareLevels(rules(base), rules({ "lib/c.ts": { r: 2 } }), none, [
      "src/a.ts",
      "src/b.ts",
      "lib/c.ts",
    ]);
    expect(items).toEqual([
      {
        what: "r",
        change: "weakened",
        before: "error",
        after: "no longer linted",
        where: "src/a.ts and 1 more",
      },
    ]);
  });

  it("is not weaker when the head no longer has the file, and a file the base did not lint is not compared", () => {
    const base = { "src/gone.ts": { r: 2 } };
    expect(compareLevels(rules(base), rules({}), none, [])).toEqual([]);
    expect(compareLevels(rules({}), rules({}), none, ["src/new.ts"])).toEqual([]);
  });

  it("follows a rename: the old path's rules are held for the path it moved to", () => {
    const renames: Renames = new Map([["src/renamed.ts", "src/old.ts"]]);
    const items = compareLevels(rules({ "src/old.ts": { r: 2 } }), rules({}), renames, [
      "src/renamed.ts",
    ]);
    expect(items).toEqual([
      {
        what: "r",
        change: "weakened",
        before: "error",
        after: "no longer linted",
        where: "src/renamed.ts",
      },
    ]);
  });
});

describe("the files of the head", () => {
  it("are held to what the base's config said of their path, new files included, ignoring files the base does not lint", () => {
    const base = rules({ "src/new.ts": { r: 2 }, "src/other.ts": { r: 2 } });
    const head = rules({
      "src/new.ts": { r: 0 },
      "src/other.ts": { r: 2 },
      "src/unlinted.ts": { r: 0 },
    });
    expect(compareLevels(base, head, none, [])).toEqual([
      { what: "r", change: "weakened", before: "error", after: "off", where: "src/new.ts" },
    ]);
  });

  it("are held to the path a renamed file came from, and a deleted file is not compared", () => {
    const base = rules({ "src/old.ts": { r: 2 }, "src/gone.ts": { r: 2 } });
    const head = rules({ "src/renamed.ts": { r: 0 } });
    const renames: Renames = new Map([["src/renamed.ts", "src/old.ts"]]);
    expect(compareLevels(base, head, renames, [])[0]).toMatchObject({
      change: "weakened",
      where: "src/renamed.ts",
    });
    expect(compareLevels(base, head, none, [])).toEqual([]);
  });

  it("are counted, files and distinct rules, when the base has settings for them", () => {
    const base = rules({ "a.ts": { r: 2, s: 2 }, "b.ts": { r: 2 } });
    const head = rules({ "a.ts": { r: 2, t: 1 }, "c.ts": { r: 2 } });
    expect(comparedOf(base, head, none, ["b.ts"])).toEqual({ files: 2, rules: 3 });
    expect(comparedOf(base, rules({}), none, [])).toEqual({ files: 0, rules: 0 });
    const renames: Renames = new Map([["c.ts", "a.ts"]]);
    expect(comparedOf(base, head, renames, [])).toEqual({ files: 2, rules: 3 });
  });
});
