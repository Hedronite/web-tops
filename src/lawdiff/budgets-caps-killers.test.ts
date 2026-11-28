import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/validate.ts";
import type { WebTopsConfig } from "../config/types.ts";
import {
  budgetEntriesOf,
  compareBudgetSettings,
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
});
