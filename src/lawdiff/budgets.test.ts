import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/validate.ts";
import type { WebTopsConfig } from "../config/types.ts";
import { budgetEntriesOf, compareBudgetSettings, effectiveCapBytes } from "./budgets.ts";
import { settingsOf } from "./settings.ts";

const HEAD = 'protocol: "0.3.0"\nversion: "1"\npackage: fixture\n';

function config(extra = "", className = "web-app"): WebTopsConfig {
  const read = parseConfig(`${HEAD}class: ${className}\n${extra}`);
  if (!read.ok) {
    throw new Error(JSON.stringify(read.problems));
  }
  return read.value;
}

const compareBudgets = (
  baseExtra: string,
  headExtra: string,
  baseClass = "web-app",
  headClass = baseClass,
) =>
  compareBudgetSettings(
    settingsOf(config(baseExtra, baseClass)),
    settingsOf(config(headExtra, headClass)),
  );

describe("effective byte budgets in settings", () => {
  it("treats a raised ceiling as weakened", () => {
    expect(
      compareBudgets("budgets:\n  page_js_bytes: 1000\n", "budgets:\n  page_js_bytes: 900000\n"),
    ).toEqual([
      {
        what: "budgets.page_js_bytes",
        change: "weakened",
        before: "1000",
        after: "900000",
      },
    ]);
  });

  it("treats a removed entry override as weakened when the fallback ceiling is higher", () => {
    expect(
      compareBudgets(
        'layers:\n  size_limit:\n    default_bytes: 5000\n    entries:\n      ".": 1000\n',
        "layers:\n  size_limit:\n    default_bytes: 5000\n",
        "ts-library",
        "ts-library",
      ),
    ).toEqual([
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
    expect(
      compareBudgets("budgets:\n  page_js_bytes: 900000\n", "budgets:\n  page_js_bytes: 1000\n"),
    ).toEqual([
      {
        what: "budgets.page_js_bytes",
        change: "strengthened",
        before: "900000",
        after: "1000",
      },
    ]);
  });

  it("treats a route dropped from config.routes as weakened", () => {
    expect(compareBudgets("routes:\n  - /\n  - /about\n", "routes:\n  - /\n")).toEqual([
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
    expect(values.get("budgets.class_js_ceiling")?.shown).toBe(ASTRO_ISLAND);
  });

  it("includes web-app route ceiling fallback", () => {
    const values = budgetEntriesOf(config("", "web-app"));
    expect(values.get("budgets.class_js_ceiling")?.shown).toBe(WEB_ROUTE);
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
    expect(
      compareBudgets(
        'budgets:\n  pages:\n    "/": 1000\n',
        'budgets:\n  pages:\n    "/": 5000\n',
      )[0],
    ).toMatchObject({
      what: "budgets.pages./",
      change: "weakened",
    });
  });

  it("compares budgets.routes map entries", () => {
    expect(
      compareBudgets(
        'budgets:\n  routes:\n    "/x": 1000\n',
        'budgets:\n  routes:\n    "/x": 8000\n',
      )[0]?.change,
    ).toBe("weakened");
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
    expect(
      compareBudgets(
        "budgets:\n  static_page_js_bytes: 0\n",
        "budgets:\n  static_page_js_bytes: 999\n",
        "astro-site",
        "astro-site",
      )[0]?.change,
    ).toBe("weakened");
  });

  it("compares route_js_bytes for web-app", () => {
    expect(
      compareBudgets(
        "budgets:\n  route_js_bytes: 1000\n",
        "budgets:\n  route_js_bytes: 200000\n",
        "web-app",
        "web-app",
      ).find((item) => item.what === "budgets.route_js_bytes")?.change,
    ).toBe("weakened");
  });

  it("reads effective caps from page, route and entry map keys", () => {
    const cfg = config(
      'budgets:\n  pages:\n    "/p/": 1000\n  routes:\n    "/r/": 2000\nlayers:\n  size_limit:\n    entries:\n      "./e": 3000\n',
      "ts-library",
    );
    expect(effectiveCapBytes("budgets.pages./p/", cfg)).toBe(1000);
    expect(effectiveCapBytes("budgets.routes./r/", cfg)).toBe(2000);
    expect(effectiveCapBytes("budgets.entries../e", cfg)).toBe(3000);
    expect(effectiveCapBytes("budgets.not_a_map", cfg)).toBeUndefined();
  });

  it("reads class JS ceilings through effectiveCapBytes", () => {
    expect(effectiveCapBytes("budgets.class_js_ceiling", config("", "ts-library"))).toBe(51_200);
    expect(effectiveCapBytes("budgets.class_js_ceiling", config("", "ui-components"))).toBe(51_200);
    expect(effectiveCapBytes("budgets.class_js_ceiling", config("", "web-app"))).toBe(174_080);
    expect(effectiveCapBytes("budgets.class_js_ceiling", config("", "astro-site"))).toBe(51_200);
    expect(
      effectiveCapBytes("budgets.class_js_ceiling", config("", "node-service")),
    ).toBeUndefined();
  });

  it("reports no cap items when an explicit ceiling is unchanged", () => {
    expect(
      compareBudgets("budgets:\n  page_js_bytes: 5000\n", "budgets:\n  page_js_bytes: 5000\n"),
    ).toEqual([]);
  });

  it("uses the library page_js path on ts-library", () => {
    const values = budgetEntriesOf(config("budgets:\n  page_js_bytes: 1234\n", "ts-library"));
    expect(values.get("budgets.page_js_bytes")?.shown).toBe("1234");
  });

  it("builds size_limit from default_bytes alone", () => {
    const values = budgetEntriesOf(
      config("layers:\n  size_limit:\n    default_bytes: 4200\n", "ui-components"),
    );
    expect(values.get("budgets.entries..")?.shown).toBe("4200");
  });

  it("treats a newly judged default_bytes cap as strengthened", () => {
    expect(
      compareBudgets(
        "",
        "layers:\n  size_limit:\n    default_bytes: 5000\n",
        "ts-library",
        "ts-library",
      ),
    ).toContainEqual({
      what: "layers.size_limit.default_bytes",
      change: "strengthened",
      before: "absent",
      after: "5000",
    });
  });

  it("treats a dropped size_limit default cap as weakened", () => {
    expect(
      compareBudgets(
        "layers:\n  size_limit:\n    default_bytes: 5000\n",
        "",
        "ts-library",
        "ts-library",
      ),
    ).toContainEqual({
      what: "layers.size_limit.default_bytes",
      change: "weakened",
      before: "5000",
      after: "absent",
    });
  });
});
