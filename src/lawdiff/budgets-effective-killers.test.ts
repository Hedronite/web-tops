import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/validate.ts";
import type { WebTopsConfig } from "../config/types.ts";
import {
  budgetEntriesOf,
  compareBudgetSettings,
  effectiveCapBytes,
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

/** One place so mutation on budgets.ts must keep every effective-cap behavior observable. */
describe("effective budget mutation killers", () => {
  it("covers class, map, partial-cap, and sort behavior", () => {
    expect(budgetEntriesOf(config("", "node-service")).has("budgets.class_js_ceiling")).toBe(false);
    expect(
      budgetEntriesOf(config("budgets:\n  page_js_bytes: 1\n", "node-service")).has(
        "budgets.class_js_ceiling",
      ),
    ).toBe(false);
    expect(
      budgetEntriesOf(
        config("layers:\n  size_limit:\n    default_bytes: 1\n", "ui-components"),
      ).has("budgets.class_js_ceiling"),
    ).toBe(false);
    expect(
      budgetEntriesOf(config("budgets:\n  route_js_bytes: 42\n", "web-app")).get(
        "budgets.route_js_bytes",
      )?.shown,
    ).toBe("42");
    expect(
      effectiveCapBytes(
        "budgets.pages./p/",
        config('budgets:\n  pages:\n    "/p/": 9\n', "astro-site"),
      ),
    ).toBe(9);
    expect(
      effectiveCapBytes(
        "budgets.routes./r/",
        config('budgets:\n  routes:\n    "/r/": 8\n', "web-app"),
      ),
    ).toBe(8);
    expect(
      [...budgetEntriesOf(config("budgets:\n  pages: {}\n", "web-app")).keys()].some((k) =>
        k.startsWith("budgets.pages."),
      ),
    ).toBe(false);
    expect(judgedCapKeys(config("", "web-app"), config("", "web-app"))).not.toContain("build.dir");
    expect(
      compareYaml("budgets:\n  page_js_bytes: 1000\n", "", "web-app", "web-app"),
    ).toContainEqual({
      what: "budgets.page_js_bytes",
      change: "weakened",
      before: "1000",
      after: "absent",
    });
    expect(
      compareYaml("budgets:\n  route_js_bytes: 2000\n", "", "web-app", "web-app"),
    ).toContainEqual({
      what: "budgets.route_js_bytes",
      change: "weakened",
      before: "2000",
      after: "absent",
    });
    expect(
      compareYaml(
        'routes:\n  - /a\n  - /b\nbuild:\n  command: "x"\n  dir: z\n',
        'routes:\n  - /a\nbuild:\n  command: "y"\n  dir: w\n',
      ).map((item) => item.what),
    ).toEqual(["build.command", "build.dir", "routes./b"]);
  });
});
