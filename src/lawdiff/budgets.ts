import type { ClassName } from "../config/profiles.ts";
import type { WebTopsConfig } from "../config/types.ts";
import {
  ASTRO_ISLAND_JS_BYTES,
  ASTRO_STATIC_JS_BYTES,
  WEB_APP_ROUTE_JS_BYTES,
  budgetForPage,
} from "../layers/bytes/budgets.ts";
import { budgetForEntry, DEFAULT_ENTRY_BYTES } from "../layers/size-limit/budgets.ts";
import { routeBudget } from "../layers/route-bytes/measure.ts";
import type { BudgetsSettings } from "../gate/types.ts";
import type { Ranked } from "./types.ts";

const BUDGET_CLASSES: readonly ClassName[] = [
  "astro-site",
  "web-app",
  "ts-library",
  "ui-components",
];

const capRank = (bytes: number): Ranked => ({ shown: String(bytes), rank: -bytes });

const sortedKeys = (record: Readonly<Record<string, number>> | undefined): string[] =>
  record === undefined ? [] : [...Object.keys(record)].sort();

type RawBudget = NonNullable<WebTopsConfig["budgets"]>;

const BUDGET_NUMBER_FIELDS: readonly (readonly [keyof BudgetsSettings, keyof RawBudget])[] = [
  ["pageJsBytes", "page_js_bytes"],
  ["staticPageJsBytes", "static_page_js_bytes"],
  ["routeJsBytes", "route_js_bytes"],
];

function budgetMaps(raw: RawBudget): Pick<BudgetsSettings, "pages" | "routes"> {
  return {
    ...(raw.pages === undefined ? {} : { pages: raw.pages }),
    ...(raw.routes === undefined ? {} : { routes: raw.routes }),
  };
}

function budgetsSettings(config: WebTopsConfig): BudgetsSettings {
  const raw = config.budgets;
  if (raw === undefined) return {};
  const scaled: BudgetsSettings = {};
  for (const [outKey, rawKey] of BUDGET_NUMBER_FIELDS) {
    const value = raw[rawKey];
    if (typeof value === "number") Object.assign(scaled, { [outKey]: value });
  }
  return { ...scaled, ...budgetMaps(raw) };
}

function webAppPageJs(budgets: BudgetsSettings): number {
  return budgets.routeJsBytes ?? budgets.pageJsBytes ?? WEB_APP_ROUTE_JS_BYTES;
}

function astroPageJs(budgets: BudgetsSettings): number {
  return budgets.pageJsBytes ?? ASTRO_ISLAND_JS_BYTES;
}

function libraryPageJs(budgets: BudgetsSettings): number {
  return budgets.pageJsBytes ?? DEFAULT_ENTRY_BYTES;
}

function effectivePageJs(config: WebTopsConfig): number {
  const budgets = budgetsSettings(config);
  if (config.class === "web-app") return webAppPageJs(budgets);
  if (config.class === "astro-site") return astroPageJs(budgets);
  return libraryPageJs(budgets);
}

function effectiveStaticPageJs(config: WebTopsConfig): number {
  const budgets = budgetsSettings(config);
  return budgets.staticPageJsBytes ?? budgets.pageJsBytes ?? ASTRO_STATIC_JS_BYTES;
}

function mergeEntryMaps(config: WebTopsConfig): Readonly<Record<string, number>> {
  return { ...config.budgets?.entries, ...config.layers?.size_limit?.entries };
}

function layerDefaultBytes(config: WebTopsConfig): number | undefined {
  return config.layers?.size_limit?.default_bytes;
}

type SizeLimitLayerValue = {
  readonly defaultBytes?: number;
  readonly entries?: Readonly<Record<string, number>>;
};

function sizeLimitFrom(
  defaultBytes: number | undefined,
  entryNames: string[],
  merged: Readonly<Record<string, number>>,
): SizeLimitLayerValue {
  if (entryNames.length === 0) {
    return defaultBytes === undefined ? {} : { defaultBytes };
  }
  if (defaultBytes === undefined) return { entries: merged };
  return { defaultBytes, entries: merged };
}

function sizeLimitLayer(config: WebTopsConfig): SizeLimitLayerValue | undefined {
  const merged = mergeEntryMaps(config);
  const entryNames = Object.keys(merged);
  const defaultBytes = layerDefaultBytes(config);
  if (entryNames.length === 0 && defaultBytes === undefined) return undefined;
  return sizeLimitFrom(defaultBytes, entryNames, merged);
}

function effectiveDefaultEntry(config: WebTopsConfig): number {
  return sizeLimitLayer(config)?.defaultBytes ?? DEFAULT_ENTRY_BYTES;
}

const mapKeys = (record: Readonly<Record<string, number>> | undefined): string[] =>
  record === undefined ? [] : Object.keys(record);

function packageEntryKeys(config: WebTopsConfig): string[] {
  return [...mapKeys(config.budgets?.entries), ...mapKeys(config.layers?.size_limit?.entries)];
}

function isPackageClass(className: ClassName): boolean {
  return className === "ts-library" || className === "ui-components";
}

function emptyEntryKeys(keys: Set<string>): boolean {
  return keys.size === 0;
}

function hasLayerDefaultBytes(config: WebTopsConfig): boolean {
  return config.layers?.size_limit?.default_bytes !== undefined;
}

function needsDefaultDot(config: WebTopsConfig, keys: Set<string>): boolean {
  if (!emptyEntryKeys(keys)) return false;
  if (!hasLayerDefaultBytes(config)) return false;
  return isPackageClass(config.class);
}

function entryKeys(config: WebTopsConfig): string[] {
  const keys = new Set(packageEntryKeys(config));
  if (needsDefaultDot(config, keys)) keys.add(".");
  return [...keys].sort();
}

function buildDirEntry(config: WebTopsConfig): Ranked {
  return { shown: config.build?.dir ?? "dist", rank: 0, review: true };
}

function buildCommandEntry(config: WebTopsConfig): Ranked {
  const command = config.build?.command;
  return { shown: command ?? "unset", rank: 0, review: true };
}

function buildReviewEntries(config: WebTopsConfig): Map<string, Ranked> {
  return new Map([
    ["build.dir", buildDirEntry(config)],
    ["build.command", buildCommandEntry(config)],
  ]);
}

function routeListEntries(config: WebTopsConfig): Map<string, Ranked> {
  const values = new Map<string, Ranked>();
  for (const route of config.routes ?? []) {
    values.set(`routes.${route}`, { shown: "judged", rank: 1 });
  }
  return values;
}

function budgetedClass(className: ClassName): boolean {
  return BUDGET_CLASSES.includes(className);
}

function hasBudgetSurface(config: WebTopsConfig): boolean {
  if (config.budgets !== undefined) return true;
  if (config.layers?.size_limit !== undefined) return true;
  return budgetedClass(config.class);
}

function showGlobalPageJs(config: WebTopsConfig): boolean {
  if (config.budgets !== undefined) return true;
  return config.class === "astro-site" || config.class === "web-app";
}

function astroCeilings(config: WebTopsConfig, values: Map<string, Ranked>): void {
  values.set("budgets.static_page_js_bytes", capRank(effectiveStaticPageJs(config)));
}

function webAppCeilings(config: WebTopsConfig, values: Map<string, Ranked>): void {
  const budgets = budgetsSettings(config);
  values.set("budgets.route_js_bytes", capRank(routeBudget("/", budgets)));
}

function addPageJsCeiling(config: WebTopsConfig, values: Map<string, Ranked>): void {
  values.set("budgets.page_js_bytes", capRank(effectivePageJs(config)));
}

function addClassCeilings(config: WebTopsConfig, values: Map<string, Ranked>): void {
  if (config.class === "astro-site") astroCeilings(config, values);
  if (config.class === "web-app") webAppCeilings(config, values);
}

function ceilingEntries(config: WebTopsConfig): Map<string, Ranked> {
  const values = new Map<string, Ranked>();
  if (!showGlobalPageJs(config)) return values;
  addPageJsCeiling(config, values);
  addClassCeilings(config, values);
  return values;
}

function pageBudgetEntries(config: WebTopsConfig): Map<string, Ranked> {
  const values = new Map<string, Ranked>();
  const budgets = budgetsSettings(config);
  for (const route of sortedKeys(config.budgets?.pages)) {
    values.set(
      `budgets.pages.${route}`,
      capRank(budgetForPage(route, config.class, true, budgets)),
    );
  }
  return values;
}

function routeBudgetEntries(config: WebTopsConfig): Map<string, Ranked> {
  const values = new Map<string, Ranked>();
  const budgets = budgetsSettings(config);
  for (const route of sortedKeys(config.budgets?.routes)) {
    values.set(`budgets.routes.${route}`, capRank(routeBudget(route, budgets)));
  }
  return values;
}

function perKeyBudgetEntries(config: WebTopsConfig): Map<string, Ranked> {
  return mergeBudgetMaps(pageBudgetEntries(config), routeBudgetEntries(config));
}

function showDefaultEntry(config: WebTopsConfig): boolean {
  if (config.layers?.size_limit?.default_bytes !== undefined) return true;
  return isPackageClass(config.class);
}

function sizeLimitBudgetEntries(config: WebTopsConfig): Map<string, Ranked> {
  const values = new Map<string, Ranked>();
  if (showDefaultEntry(config)) {
    values.set("layers.size_limit.default_bytes", capRank(effectiveDefaultEntry(config)));
  }
  const sizeLayer = sizeLimitLayer(config);
  for (const key of entryKeys(config)) {
    values.set(`budgets.entries.${key}`, capRank(budgetForEntry(key, sizeLayer)));
  }
  return values;
}

function mergeBudgetMaps(...parts: ReadonlyMap<string, Ranked>[]): Map<string, Ranked> {
  const values = new Map<string, Ranked>();
  for (const part of parts) for (const [key, ranked] of part) values.set(key, ranked);
  return values;
}

/** Effective byte budgets and related settings from `web-tops.yaml`, each ranked so a higher ceiling is weaker. */
export function budgetEntriesOf(config: WebTopsConfig): Map<string, Ranked> {
  const base = mergeBudgetMaps(buildReviewEntries(config), routeListEntries(config));
  if (!hasBudgetSurface(config)) return base;
  return mergeBudgetMaps(
    base,
    ceilingEntries(config),
    perKeyBudgetEntries(config),
    sizeLimitBudgetEntries(config),
  );
}
