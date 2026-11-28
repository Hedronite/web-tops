import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/validate.ts";
import type { ClassName } from "../config/profiles.ts";
import type { WebTopsConfig } from "../config/types.ts";
import { budgetEntriesOf, compareBudgetSettings, effectiveCapBytes } from "./budgets.ts";
import { settingsOf } from "./settings.ts";

const HEAD = 'protocol: "0.3.0"\nversion: "1"\npackage: fixture\n';

function config(extra = "", className: ClassName): WebTopsConfig {
  const read = parseConfig(`${HEAD}class: ${className}\n${extra}`);
  if (!read.ok) throw new Error(JSON.stringify(read.problems));
  return read.value;
}

const CLASSES: readonly ClassName[] = [
  "astro-site",
  "web-app",
  "ui-components",
  "ts-library",
  "node-service",
];

const PACKAGE_CLASS_JS = 51_200;
const WEB_APP_CLASS_JS = 174_080;

const packageJsClass = (className: ClassName): boolean =>
  className === "astro-site" || className === "ui-components" || className === "ts-library";

function classJsCeilingExpect(className: ClassName): number | undefined {
  if (className === "web-app") return WEB_APP_CLASS_JS;
  if (packageJsClass(className)) return PACKAGE_CLASS_JS;
  return undefined;
}

describe("class-specific byte budget defaults", () => {
  it.each(CLASSES)("exposes the expected class JS ceiling on %s", (className) => {
    const cfg = config("", className);
    const classJs = effectiveCapBytes("budgets.class_js_ceiling", cfg);
    const expected = classJsCeilingExpect(className);
    expect(classJs).toBe(expected);
    const shown = budgetEntriesOf(cfg).get("budgets.class_js_ceiling")?.shown;
    if (expected === undefined) expect(shown).toBeUndefined();
    else expect(shown).toBe(String(expected));
  });

  it.each([
    ["astro-site", 51_200],
    ["web-app", 174_080],
    ["ui-components", 51_200],
    ["ts-library", 51_200],
  ] as const)("effective page_js without an override follows %s defaults", (className, ceiling) => {
    const cfg = config("budgets:\n  page_js_bytes: 42\n", className);
    expect(effectiveCapBytes("budgets.page_js_bytes", cfg)).toBe(42);
    expect(budgetEntriesOf(cfg).get("budgets.page_js_bytes")?.shown).toBe("42");
    expect(classJsCeilingExpect(className)).toBe(ceiling);
  });

  it("exposes astro static_page_js only on astro-site", () => {
    expect(effectiveCapBytes("budgets.static_page_js_bytes", config("", "astro-site"))).toBe(0);
    expect(
      effectiveCapBytes("budgets.static_page_js_bytes", config("", "web-app")),
    ).toBeUndefined();
    expect(
      effectiveCapBytes("budgets.static_page_js_bytes", config("", "ts-library")),
    ).toBeUndefined();
  });

  it("omits byte cap keys on node-service without budgets", () => {
    const keys = [...budgetEntriesOf(config("", "node-service")).keys()];
    expect(keys.some((key) => key.startsWith("budgets."))).toBe(false);
  });

  it("includes astro static_page_js_bytes in budgetEntriesOf", () => {
    expect(budgetEntriesOf(config("", "astro-site")).has("budgets.static_page_js_bytes")).toBe(
      true,
    );
  });
});

describe("class changes at base and head", () => {
  const classChange = (from: ClassName, to: ClassName) =>
    compareBudgetSettings(settingsOf(config("", from)), settingsOf(config("", to)));

  it("weakened class_js when ui-components becomes web-app", () => {
    expect(classChange("ui-components", "web-app")).toContainEqual({
      what: "budgets.class_js_ceiling",
      change: "weakened",
      before: "51200",
      after: "174080",
    });
  });

  it("weakened class_js when ts-library becomes web-app", () => {
    expect(classChange("ts-library", "web-app")).toContainEqual({
      what: "budgets.class_js_ceiling",
      change: "weakened",
      before: "51200",
      after: "174080",
    });
  });

  it("strengthened class_js when web-app becomes ui-components", () => {
    expect(classChange("web-app", "ui-components")).toContainEqual({
      what: "budgets.class_js_ceiling",
      change: "strengthened",
      before: "174080",
      after: "51200",
    });
  });

  it("adds astro static_page_js when astro-site replaces web-app", () => {
    const items = classChange("web-app", "astro-site");
    expect(items).toContainEqual({
      what: "budgets.static_page_js_bytes",
      change: "strengthened",
      before: "absent",
      after: "0",
    });
    expect(items).toContainEqual({
      what: "budgets.class_js_ceiling",
      change: "strengthened",
      before: "174080",
      after: "51200",
    });
  });
});
