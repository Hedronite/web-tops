import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/validate.ts";
import type { WebTopsConfig } from "../config/types.ts";
import {
  budgetEntriesOf,
  compareBudgetSettings,
  effectiveCapBytes,
  isBudgetCapKey,
  judgedCapKeys,
} from "./budgets.ts";
import { settingsOf } from "./settings.ts";

const HEAD = 'protocol: "0.3.0"\nversion: "1"\npackage: fixture\n';

function config(extra = "", className = "web-app"): WebTopsConfig {
  const read = parseConfig(`${HEAD}class: ${className}\n${extra}`);
  if (!read.ok) throw new Error(JSON.stringify(read.problems));
  return read.value;
}

const compareYaml = (
  baseExtra: string,
  headExtra: string,
  baseClass = "web-app",
  headClass = baseClass,
) =>
  compareBudgetSettings(
    settingsOf(config(baseExtra, baseClass)),
    settingsOf(config(headExtra, headClass)),
  );

describe("budget cap keys and judged comparisons", () => {
  it("detects per-route and entry cap keys", () => {
    expect(isBudgetCapKey("budgets.class_js_ceiling")).toBe(true);
    expect(isBudgetCapKey("budgets.page_js_bytes")).toBe(true);
    expect(isBudgetCapKey("budgets.static_page_js_bytes")).toBe(true);
    expect(isBudgetCapKey("budgets.route_js_bytes")).toBe(true);
    expect(isBudgetCapKey("layers.size_limit.default_bytes")).toBe(true);
    expect(isBudgetCapKey("budgets.pages./home/")).toBe(true);
    expect(isBudgetCapKey("budgets.routes./docs")).toBe(true);
    expect(isBudgetCapKey("budgets.entries../src")).toBe(true);
    expect(isBudgetCapKey("build.dir")).toBe(false);
  });

  it("unions pages, routes and entries across two refs", () => {
    const base = config(
      'budgets:\n  pages:\n    "/a/": 1\n  routes:\n    "/ra/": 2\nlayers:\n  size_limit:\n    entries:\n      "./ea": 3\n',
      "web-app",
    );
    const head = config(
      'budgets:\n  pages:\n    "/b/": 4\n  routes:\n    "/rb/": 5\nlayers:\n  size_limit:\n    entries:\n      "./eb": 6\n',
      "web-app",
    );
    const keys = judgedCapKeys(base, head);
    expect(keys).toEqual([...keys].sort());
    expect(keys).toEqual(
      expect.arrayContaining([
        "budgets.pages./a/",
        "budgets.pages./b/",
        "budgets.routes./ra/",
        "budgets.routes./rb/",
        "budgets.entries../ea",
        "budgets.entries../eb",
      ]),
    );
  });

  it("sorts cap and non-cap compare items together", () => {
    const items = compareYaml(
      "budgets:\n  page_js_bytes: 1000\n  route_js_bytes: 1000\nbuild:\n  dir: out\n",
      "budgets:\n  page_js_bytes: 9000\n  route_js_bytes: 9000\nbuild:\n  dir: dist\n",
    );
    expect(items.map((item) => item.what)).toEqual([
      "budgets.page_js_bytes",
      "budgets.route_js_bytes",
      "build.dir",
    ]);
  });

  it("hides web-app class ceiling when route_js_bytes is set", () => {
    const values = budgetEntriesOf(config("budgets:\n  route_js_bytes: 999\n", "web-app"));
    expect(values.has("budgets.class_js_ceiling")).toBe(false);
    expect(values.get("budgets.route_js_bytes")?.shown).toBe("999");
  });

  it("hides package class ceiling when page_js_bytes is set", () => {
    const values = budgetEntriesOf(config("budgets:\n  page_js_bytes: 888\n", "ui-components"));
    expect(values.has("budgets.class_js_ceiling")).toBe(false);
    expect(values.get("budgets.page_js_bytes")?.shown).toBe("888");
  });

  it("omits page map rows when budgets.pages is absent", () => {
    const values = budgetEntriesOf(config('budgets:\n  routes:\n    "/x": 1\n', "web-app"));
    expect([...values.keys()].some((key) => key.startsWith("budgets.pages."))).toBe(false);
    expect(values.get("budgets.routes./x")?.shown).toBe("1");
  });

  it("uses the slash route for explicit route_js_bytes", () => {
    const values = budgetEntriesOf(
      config('budgets:\n  routes:\n    "/api": 77000\n  route_js_bytes: 55\n', "web-app"),
    );
    expect(values.get("budgets.route_js_bytes")?.shown).toBe("55");
  });

  it("skips budget ceilings when the surface is absent", () => {
    const values = budgetEntriesOf(config("", "node-service"));
    expect(values.has("budgets.class_js_ceiling")).toBe(false);
    expect(values.has("budgets.page_js_bytes")).toBe(false);
  });

  it("does not weaken when both refs keep the same explicit ceilings", () => {
    const yaml = "budgets:\n  page_js_bytes: 5000\n  route_js_bytes: 6000\n";
    expect(compareYaml(yaml, yaml).length).toBe(0);
  });

  it("judges a route that appears only on head", () => {
    const keys = judgedCapKeys(
      config("", "web-app"),
      config('budgets:\n  routes:\n    "/head-only/": 12\n', "web-app"),
    );
    expect(keys).toContain("budgets.routes./head-only/");
  });

  it("strengthens when a tighter page override is added on head", () => {
    const items = compareYaml(
      "budgets:\n  page_js_bytes: 51200\n",
      'budgets:\n  page_js_bytes: 51200\n  pages:\n    "/tight/": 500\n',
      "astro-site",
      "astro-site",
    );
    expect(items).toContainEqual({
      what: "budgets.pages./tight/",
      change: "strengthened",
      before: "51200",
      after: "500",
    });
  });

  it("weakens when a tighter page override is dropped on head", () => {
    const items = compareYaml(
      'budgets:\n  page_js_bytes: 51200\n  pages:\n    "/x/": 1000\n',
      "budgets:\n  page_js_bytes: 51200\n",
      "astro-site",
      "astro-site",
    );
    expect(items).toContainEqual({
      what: "budgets.pages./x/",
      change: "weakened",
      before: "1000",
      after: "51200",
    });
  });

  it("weakens when an entry override is dropped on head", () => {
    const items = compareYaml(
      'layers:\n  size_limit:\n    default_bytes: 51200\n    entries:\n      "./y": 800\n',
      "layers:\n  size_limit:\n    default_bytes: 51200\n",
      "ts-library",
      "ts-library",
    );
    expect(items).toContainEqual({
      what: "budgets.entries../y",
      change: "weakened",
      before: "800",
      after: "51200",
    });
  });

  it("adds a default dot entry only on package classes", () => {
    const dotOnly = "layers:\n  size_limit:\n    default_bytes: 9000\n";
    expect(budgetEntriesOf(config(dotOnly, "ts-library")).get("budgets.entries..")?.shown).toBe(
      "9000",
    );
    expect(budgetEntriesOf(config(dotOnly, "node-service")).has("budgets.entries..")).toBe(false);
  });

  it("uses astro-site page_js ranking without the web-app branch", () => {
    const cfg = config("budgets:\n  page_js_bytes: 99\n", "astro-site");
    expect(budgetEntriesOf(cfg).get("budgets.page_js_bytes")?.shown).toBe("99");
    expect(budgetEntriesOf(cfg).has("budgets.static_page_js_bytes")).toBe(true);
  });

  it("judged cap keys omit non-cap settings", () => {
    const keys = judgedCapKeys(config("build:\n  dir: out\n", "web-app"), config("", "web-app"));
    expect(keys).not.toContain("build.dir");
    expect(keys).not.toContain("build.command");
  });

  it("sorts mixed cap and non-cap compare items lexicographically", () => {
    const items = compareYaml(
      'build:\n  command: "a"\n  dir: z\nbudgets:\n  page_js_bytes: 1000\n',
      'build:\n  command: "b"\n  dir: y\nbudgets:\n  page_js_bytes: 2000\n',
    );
    expect(items.map((item) => item.what)).toEqual([
      "budgets.page_js_bytes",
      "build.command",
      "build.dir",
    ]);
  });

  it("measures route_js_bytes at the slash route", () => {
    const cfg = config('budgets:\n  route_js_bytes: 77\n  routes:\n    "/api": 5000\n', "web-app");
    expect(effectiveCapBytes("budgets.route_js_bytes", cfg)).toBe(77);
  });

  it("reads per-route ceilings from the routes map", () => {
    const cfg = config('budgets:\n  routes:\n    "/api": 5000\n', "web-app");
    expect(effectiveCapBytes("budgets.routes./api", cfg)).toBe(5000);
    expect([...budgetEntriesOf(cfg).keys()].some((key) => key.startsWith("budgets.pages."))).toBe(
      false,
    );
  });

  it("reads per-page ceilings from the pages map", () => {
    const cfg = config('budgets:\n  pages:\n    "/home/": 9000\n', "astro-site");
    expect(effectiveCapBytes("budgets.pages./home/", cfg)).toBe(9000);
  });

  it("omits page rows when budgets.pages is absent, not merely empty", () => {
    const absent = budgetEntriesOf(config("", "web-app"));
    const empty = budgetEntriesOf(config("budgets:\n  pages: {}\n", "web-app"));
    expect([...absent.keys()].some((key) => key.startsWith("budgets.pages."))).toBe(false);
    expect([...empty.keys()].some((key) => key.startsWith("budgets.pages."))).toBe(false);
  });

  it("surfaces explicit route_js_bytes on ts-library", () => {
    const cfg = config("budgets:\n  route_js_bytes: 4444\n", "ts-library");
    expect(budgetEntriesOf(cfg).get("budgets.route_js_bytes")?.shown).toBe("4444");
  });
});
