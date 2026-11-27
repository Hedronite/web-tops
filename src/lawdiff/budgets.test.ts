import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/validate.ts";
import type { WebTopsConfig } from "../config/types.ts";
import { budgetEntriesOf } from "./budgets.ts";
import { compareRanked } from "./rank.ts";

const HEAD = 'protocol: "0.3.0"\nversion: "1"\npackage: fixture\n';

function config(extra = "", className = "web-app"): WebTopsConfig {
  const read = parseConfig(`${HEAD}class: ${className}\n${extra}`);
  if (!read.ok) {
    throw new Error(JSON.stringify(read.problems));
  }
  return read.value;
}

describe("effective byte budgets in settings", () => {
  it("treats a raised ceiling as weakened", () => {
    const base = budgetEntriesOf(config("budgets:\n  page_js_bytes: 1000\n"));
    const head = budgetEntriesOf(config("budgets:\n  page_js_bytes: 900000\n"));
    expect(compareRanked(base, head)).toEqual([
      {
        what: "budgets.page_js_bytes",
        change: "weakened",
        before: "1000",
        after: "900000",
      },
    ]);
  });

  it("treats a removed entry override as weakened when the fallback ceiling is higher", () => {
    const base = budgetEntriesOf(
      config(
        'layers:\n  size_limit:\n    default_bytes: 5000\n    entries:\n      ".": 1000\n',
        "ts-library",
      ),
    );
    const head = budgetEntriesOf(
      config("layers:\n  size_limit:\n    default_bytes: 5000\n", "ts-library"),
    );
    expect(compareRanked(base, head)).toEqual([
      {
        what: "budgets.entries..",
        change: "weakened",
        before: "1000",
        after: "5000",
      },
    ]);
  });

  it("lets layers.size_limit.entries beat budgets.entries", () => {
    const values = budgetEntriesOf(
      config(
        'budgets:\n  entries:\n    ".": 5000\nlayers:\n  size_limit:\n    entries:\n      ".": 2000\n',
        "ts-library",
      ),
    );
    expect(values.get("budgets.entries..")?.shown).toBe("2000");
  });

  it("treats a tighter override as strengthened", () => {
    const base = budgetEntriesOf(config("budgets:\n  page_js_bytes: 900000\n"));
    const head = budgetEntriesOf(config("budgets:\n  page_js_bytes: 1000\n"));
    expect(compareRanked(base, head)).toEqual([
      {
        what: "budgets.page_js_bytes",
        change: "strengthened",
        before: "900000",
        after: "1000",
      },
    ]);
  });

  it("treats a route dropped from config.routes as weakened", () => {
    const base = budgetEntriesOf(config("routes:\n  - /\n  - /about\n"));
    const head = budgetEntriesOf(config("routes:\n  - /\n"));
    expect(compareRanked(base, head)).toEqual([
      {
        what: "routes./about",
        change: "weakened",
        before: "judged",
        after: "absent",
      },
    ]);
  });
});

const ASTRO_STATIC = String(0);
const ASTRO_ISLAND = String(50 * 1024);
const WEB_ROUTE = String(170 * 1024);

describe("budgetEntriesOf branches", () => {
  it("omits byte ceilings for node-service without budgets", () => {
    const keys = [...budgetEntriesOf(config("", "node-service")).keys()];
    expect(keys.some((key) => key.startsWith("budgets."))).toBe(false);
    expect(keys).toContain("build.dir");
  });

  it("includes astro-site static and island effective ceilings", () => {
    const values = budgetEntriesOf(config("", "astro-site"));
    expect(values.get("budgets.static_page_js_bytes")?.shown).toBe(ASTRO_STATIC);
    expect(values.get("budgets.page_js_bytes")?.shown).toBe(ASTRO_ISLAND);
  });

  it("includes web-app route ceiling fallback", () => {
    const values = budgetEntriesOf(config("", "web-app"));
    expect(values.get("budgets.route_js_bytes")?.shown).toBe(WEB_ROUTE);
    expect(values.get("budgets.page_js_bytes")?.shown).toBe(WEB_ROUTE);
  });

  it("reads explicit page and route map overrides", () => {
    const yaml = 'budgets:\n  pages:\n    "/big/": 90000\n  routes:\n    "/docs/": 120000\n';
    const values = budgetEntriesOf(config(yaml));
    expect(values.get("budgets.pages./big/")?.shown).toBe("90000");
    expect(values.get("budgets.routes./docs/")?.shown).toBe("120000");
  });

  it("lists build.dir and build.command for review", () => {
    const values = budgetEntriesOf(config('build:\n  dir: out\n  command: "npm run build"\n'));
    expect(values.get("build.dir")?.shown).toBe("out");
    expect(values.get("build.command")?.shown).toBe("npm run build");
  });

  it("compares budgets.pages via effective ceiling", () => {
    const base = budgetEntriesOf(config('budgets:\n  pages:\n    "/": 1000\n'));
    const head = budgetEntriesOf(config('budgets:\n  pages:\n    "/": 5000\n'));
    expect(compareRanked(base, head)[0]).toMatchObject({
      what: "budgets.pages./",
      change: "weakened",
    });
  });

  it("compares budgets.routes map entries", () => {
    const base = budgetEntriesOf(config('budgets:\n  routes:\n    "/x": 1000\n'));
    const head = budgetEntriesOf(config('budgets:\n  routes:\n    "/x": 8000\n'));
    expect(compareRanked(base, head)[0]?.change).toBe("weakened");
  });

  it("uses only budgets.entries when size_limit layer is absent", () => {
    const values = budgetEntriesOf(config('budgets:\n  entries:\n    ".": 3000\n', "ts-library"));
    expect(values.get("budgets.entries..")?.shown).toBe("3000");
  });

  it("surfaces size_limit default on package classes", () => {
    const values = budgetEntriesOf(
      config("layers:\n  size_limit:\n    default_bytes: 4000\n", "ts-library"),
    );
    expect(values.get("layers.size_limit.default_bytes")?.shown).toBe("4000");
  });

  it("enables budget surface when only layers.size_limit is set", () => {
    const values = budgetEntriesOf(
      config('layers:\n  size_limit:\n    entries:\n      "./x": 100\n', "node-service"),
    );
    expect(values.get("budgets.entries../x")?.shown).toBe("100");
  });

  it("compares static_page_js when astro-site raises it", () => {
    const base = budgetEntriesOf(config("budgets:\n  static_page_js_bytes: 0\n", "astro-site"));
    const head = budgetEntriesOf(config("budgets:\n  static_page_js_bytes: 999\n", "astro-site"));
    expect(compareRanked(base, head)[0]?.change).toBe("weakened");
  });

  it("compares route_js_bytes for web-app", () => {
    const base = budgetEntriesOf(config("budgets:\n  route_js_bytes: 1000\n", "web-app"));
    const head = budgetEntriesOf(config("budgets:\n  route_js_bytes: 200000\n", "web-app"));
    expect(
      compareRanked(base, head).find((item) => item.what === "budgets.route_js_bytes")?.change,
    ).toBe("weakened");
  });
});
