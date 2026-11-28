import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/validate.ts";
import type { WebTopsConfig } from "../config/types.ts";
import { budgetEntriesOf } from "./budgets.ts";

const HEAD = 'protocol: "0.3.0"\nversion: "1"\npackage: fixture\n';

function config(extra = "", className = "web-app"): WebTopsConfig {
  const read = parseConfig(`${HEAD}class: ${className}\n${extra}`);
  if (!read.ok) throw new Error(JSON.stringify(read.problems));
  return read.value;
}

describe("budget mutant killers", () => {
  it("sorts pages map keys for stable comparison", () => {
    const values = budgetEntriesOf(
      config('budgets:\n  pages:\n    "/z/": 1\n    "/a/": 2\n    "/m/": 3\n'),
    );
    const pageKeys = [...values.keys()].filter((key) => key.startsWith("budgets.pages."));
    expect(pageKeys).toEqual(["budgets.pages./a/", "budgets.pages./m/", "budgets.pages./z/"]);
  });

  it("class-specific page_js defaults differ between astro-site and web-app", () => {
    const astro = budgetEntriesOf(config("", "astro-site"));
    const web = budgetEntriesOf(config("", "web-app"));
    expect(astro.get("budgets.page_js_bytes")?.shown).toBe("51200");
    expect(web.get("budgets.page_js_bytes")?.shown).toBe("174080");
  });

  it("uses library fallback page_js on ts-library", () => {
    const values = budgetEntriesOf(config("", "ts-library"));
    expect(values.has("budgets.page_js_bytes")).toBe(false);
    expect(values.get("layers.size_limit.default_bytes")?.shown).toBe("51200");
  });

  it("marks build.command for review", () => {
    expect(budgetEntriesOf(config("")).get("build.command")?.review).toBe(true);
  });

  it("returns no size_limit layer object for bare node-service", () => {
    const keys = [...budgetEntriesOf(config("", "node-service")).keys()];
    expect(keys).not.toContain("layers.size_limit.default_bytes");
  });

  it("uses explicit numeric static_page_js_bytes", () => {
    const values = budgetEntriesOf(
      config("budgets:\n  static_page_js_bytes: 42\n  page_js_bytes: 10\n", "astro-site"),
    );
    expect(values.get("budgets.static_page_js_bytes")?.shown).toBe("42");
  });

  it("sorts export entry keys", () => {
    const values = budgetEntriesOf(
      config(
        'layers:\n  size_limit:\n    entries:\n      "./z": 1\n      "./a": 2\n',
        "ts-library",
      ),
    );
    const entryKeys = [...values.keys()].filter((key) => key.startsWith("budgets.entries."));
    expect(entryKeys).toEqual(["budgets.entries../a", "budgets.entries../z"]);
  });

  it("does not add default dot when explicit entry keys exist", () => {
    const values = budgetEntriesOf(
      config(
        'layers:\n  size_limit:\n    default_bytes: 9000\n    entries:\n      ".": 1000\n',
        "ts-library",
      ),
    );
    expect(values.get("budgets.entries..")?.shown).toBe("1000");
  });

  it("uses routes map entry for a named route", () => {
    const values = budgetEntriesOf(config('budgets:\n  routes:\n    "/docs": 12000\n', "web-app"));
    expect(values.get("budgets.routes./docs")?.shown).toBe("12000");
    expect(values.get("budgets.route_js_bytes")?.shown).toBe("174080");
  });

  it("honors all three numeric budget ceilings in budgetsSettings", () => {
    const values = budgetEntriesOf(
      config(
        "budgets:\n  page_js_bytes: 100\n  static_page_js_bytes: 200\n  route_js_bytes: 300\n",
        "web-app",
      ),
    );
    expect(values.get("budgets.page_js_bytes")?.shown).toBe("300");
    expect(values.get("budgets.route_js_bytes")?.shown).toBe("300");
  });

  it("keeps routes map without a pages map in budgets", () => {
    const values = budgetEntriesOf(config('budgets:\n  routes:\n    "/api": 77000\n', "web-app"));
    expect(values.has("budgets.routes./api")).toBe(true);
    expect([...values.keys()].some((key) => key.startsWith("budgets.pages."))).toBe(false);
  });

  it("keeps pages map without a routes map in budgets", () => {
    const values = budgetEntriesOf(
      config('budgets:\n  pages:\n    "/home/": 88000\n', "astro-site"),
    );
    expect(values.get("budgets.pages./home/")?.shown).toBe("88000");
    expect(values.has("budgets.routes./api")).toBe(false);
  });

  it("uses route_js from the slash route when judging web-app ceilings", () => {
    const values = budgetEntriesOf(config('budgets:\n  routes:\n    "/": 5000\n', "web-app"));
    expect(values.get("budgets.route_js_bytes")?.shown).toBe("5000");
  });

  it("adds default dot entry when only size_limit.default_bytes is set", () => {
    const values = budgetEntriesOf(
      config("layers:\n  size_limit:\n    default_bytes: 9000\n", "ts-library"),
    );
    expect(values.get("budgets.entries..")?.shown).toBe("9000");
  });

  it("surfaces default_bytes on node-service when only size_limit is configured", () => {
    const values = budgetEntriesOf(
      config("layers:\n  size_limit:\n    default_bytes: 4000\n", "node-service"),
    );
    expect(values.get("layers.size_limit.default_bytes")?.shown).toBe("4000");
  });

  it("returns no merged entry map when size_limit has neither default nor entries", () => {
    const keys = [...budgetEntriesOf(config("", "node-service")).keys()];
    expect(keys).not.toContain("budgets.entries..");
    expect(keys).not.toContain("layers.size_limit.default_bytes");
  });

  it("uses merged entries without default when only export overrides exist", () => {
    const values = budgetEntriesOf(
      config('layers:\n  size_limit:\n    entries:\n      "./only": 111\n', "ts-library"),
    );
    expect(values.get("budgets.entries../only")?.shown).toBe("111");
    expect(values.get("layers.size_limit.default_bytes")?.shown).toBe("51200");
  });

  it("does not treat default dot as separate when explicit entry keys exist", () => {
    const entryKeys = [
      ...budgetEntriesOf(
        config('layers:\n  size_limit:\n    entries:\n      "./a": 1\n', "ts-library"),
      ).keys(),
    ].filter((key) => key.startsWith("budgets.entries."));
    expect(entryKeys).toEqual(["budgets.entries../a"]);
  });

  it("differs astro page_js ceiling path from ui-components package defaults", () => {
    const astro = budgetEntriesOf(config("", "astro-site"));
    const ui = budgetEntriesOf(config("", "ui-components"));
    expect(astro.has("budgets.page_js_bytes")).toBe(true);
    expect(astro.has("budgets.static_page_js_bytes")).toBe(true);
    expect(ui.has("budgets.page_js_bytes")).toBe(false);
    expect(ui.get("layers.size_limit.default_bytes")?.shown).toBe("51200");
  });
});
