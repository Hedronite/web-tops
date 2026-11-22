import { describe, expect, it } from "vitest";
import {
  compareToolConfig,
  isRecord,
  listOf,
  parseJsonc,
  recordOf,
  reviewed,
  switched,
} from "./toolconfig.ts";
import type { Ranked, ToolConfig, ToolSet } from "./types.ts";

const config = (values: [string, Ranked][] = [], sets: ToolSet[] = []): ToolConfig => ({
  values: new Map(values),
  sets,
});

const on: Ranked = { shown: "on", rank: 1 };
const off: Ranked = { shown: "off", rank: 0 };

describe("the pieces of a tool's config", () => {
  it("a record is an object that is not a list and not null", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
  });

  it("a record of a value is the value when it is one, and an empty one when it is not", () => {
    expect(recordOf({ a: 1 })).toEqual({ a: 1 });
    expect(recordOf([1])).toEqual({});
    expect(recordOf(5)).toEqual({});
    expect(recordOf(null)).toEqual({});
  });

  it("a list is the strings of a list, a string alone, the JSON of an entry that is not one, and nothing else", () => {
    expect(listOf(["a", "b"])).toEqual(["a", "b"]);
    expect(listOf("a")).toEqual(["a"]);
    expect(listOf(["a", ["b", "c"], 1])).toEqual(["a", '["b","c"]', "1"]);
    expect(listOf(undefined)).toEqual([]);
    expect(listOf({ a: 1 })).toEqual([]);
  });

  it("reads JSON with comments, and says why it cannot read anything else", () => {
    expect(parseJsonc("c.json", '{ /* c */ "a": 1, // d\n "b": [2] }')).toEqual({
      ok: true,
      value: { a: 1, b: [2] },
    });
    const bad = parseJsonc("c.json", "{ nope");
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.message.length > 0).toBe(true);
    for (const root of ["[]", "5", "null", '"x"']) {
      const notObject = parseJsonc("c.json", root);
      expect(!notObject.ok && notObject.message.includes("must be an object")).toBe(true);
    }
    expect(parseJsonc("c.json", "")).toEqual({ ok: true, value: {} });
  });

  it("a value for review has no rank and says what it holds as JSON, null when it holds nothing", () => {
    expect(reviewed({ a: 1 })).toEqual({ shown: '{"a":1}', rank: 0, review: true });
    expect(reviewed(undefined)).toEqual({ shown: "null", rank: 0, review: true });
  });

  it("a switch holds more when it is on", () => {
    expect(switched(true, ["on", "off"])).toEqual(on);
    expect(switched(false, ["on", "off"])).toEqual(off);
    expect(switched(false, ["reported", "ignored"])).toEqual({ shown: "ignored", rank: 0 });
  });
});

describe("what moved in a tool's config", () => {
  it("a value that fell is weaker, one that rose or appeared is stronger, one for review that differs is changed", () => {
    const review = reviewed({ a: 1 });
    const base = config([
      ["fell", on],
      ["rose", off],
      ["note", review],
    ]);
    const head = config([
      ["fell", off],
      ["rose", on],
      ["note", reviewed({ a: 2 })],
      ["new", on],
    ]);
    const moved = compareToolConfig(base, head).items.map((item) => [item.what, item.change]);
    expect(moved).toEqual([
      ["fell", "weakened"],
      ["new", "strengthened"],
      ["note", "changed"],
      ["rose", "strengthened"],
    ]);
  });

  it("an entry added to a list that loosens by gaining one is weaker, and one taken out is stronger", () => {
    const set = (entries: string[]): ToolSet => ({ name: "ignore", loosens: "added", entries });
    const items = compareToolConfig(
      config([], [set(["a", "b"])]),
      config([], [set(["b", "c"])]),
    ).items;
    expect(items).toEqual([
      { what: "ignore", change: "weakened", before: "not listed", after: "listed", where: "c" },
      { what: "ignore", change: "strengthened", before: "listed", after: "not listed", where: "a" },
    ]);
  });

  it("an entry taken out of a list that loosens by losing one is weaker, and one added is stronger", () => {
    const set = (entries: string[]): ToolSet => ({ name: "project", loosens: "removed", entries });
    const items = compareToolConfig(config([], [set(["a"])]), config([], [set(["b"])])).items;
    expect(items.map((item) => [item.where, item.change])).toEqual([
      ["b", "strengthened"],
      ["a", "weakened"],
    ]);
  });

  it("a list that only one side has is all added or all removed, by the way it loosens", () => {
    const set: ToolSet = { name: "ignore", loosens: "added", entries: ["a"] };
    expect(compareToolConfig(config(), config([], [set])).items.map((item) => item.change)).toEqual(
      ["weakened"],
    );
    expect(compareToolConfig(config([], [set]), config()).items.map((item) => item.change)).toEqual(
      ["strengthened"],
    );
  });

  it("lists of one name from two places are one list", () => {
    const one: ToolSet = { name: "ignore", loosens: "added", entries: ["a"] };
    const two: ToolSet = { name: "ignore", loosens: "added", entries: ["b"] };
    const items = compareToolConfig(config([], [one, two]), config([], [one])).items;
    expect(items.map((item) => [item.where, item.change])).toEqual([["b", "strengthened"]]);
  });

  it("counts the values of both sides once, and each entry of each list once", () => {
    const base = config([["a", on]], [{ name: "x", loosens: "added", entries: ["a", "b"] }]);
    const head = config(
      [
        ["a", on],
        ["b", on],
      ],
      [{ name: "x", loosens: "added", entries: ["b", "c"] }],
    );
    expect(compareToolConfig(base, head).compared).toBe(5);
    expect(compareToolConfig(config(), config()).compared).toBe(0);
  });

  it("an entry of one list is not the same entry of another", () => {
    const base = config([], [{ name: "x", loosens: "added", entries: ["a"] }]);
    const head = config([], [{ name: "y", loosens: "added", entries: ["a"] }]);
    expect(compareToolConfig(base, head).compared).toBe(2);
  });

  it("a name only one side has is held against the default the other stands for, when there is one", () => {
    const fallback = (key: string): Ranked | undefined => (key === "kept" ? on : undefined);
    const base = config([
      ["kept", on],
      ["lost", on],
    ]);
    const head = config([]);
    expect(
      compareToolConfig(base, head, fallback).items.map((item) => [item.what, item.change]),
    ).toEqual([["lost", "weakened"]]);
    expect(
      compareToolConfig(head, base, fallback).items.map((item) => [item.what, item.change]),
    ).toEqual([["lost", "strengthened"]]);
    const lowered = config([["kept", off]]);
    expect(
      compareToolConfig(config(), lowered, fallback).items.map((item) => [item.what, item.change]),
    ).toEqual([["kept", "weakened"]]);
    expect(compareToolConfig(lowered, config(), fallback).items.map((item) => item.change)).toEqual(
      ["strengthened"],
    );
  });
});
