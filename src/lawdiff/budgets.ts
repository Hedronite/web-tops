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
import type { Item, Ranked, Settings } from "./types.ts";
import { compareRanked } from "./rank.ts";

const BUDGET_CLASSES: readonly ClassName[] = [
  "astro-site",
  "web-app",
  "ts-library",
  "ui-components",
];

const CLASS_JS_KEY = "budgets.class_js_ceiling";
const ROUTE_JS_ROOT = "/";

const capRank = (bytes: number): Ranked => ({ shown: String(bytes), rank: -bytes });

const sortedKeys = (record: Readonly<Record<string, number>> | undefined): string[] =>
  record === undefined ? [] : [...Object.keys(record)].sort();

type RawBudget = NonNullable<WebTopsConfig["budgets"]>;

const BUDGET_NUMBER_FIELDS: readonly (readonly [keyof BudgetsSettings, keyof RawBudget])[] = [
  ["pageJsBytes", "page_js_bytes"],
  ["staticPageJsBytes", "static_page_js_bytes"],
  ["routeJsBytes", "route_js_bytes"],
];

const BUDGET_CAP_EXACT = new Set<string>([
  CLASS_JS_KEY,
  "budgets.page_js_bytes",
  "budgets.static_page_js_bytes",
  "budgets.route_js_bytes",
  "layers.size_limit.default_bytes",
]);

/** Whether a settings key is a byte ceiling law-diff compares by effective value. */
export function isBudgetCapKey(key: string): boolean {
  if (BUDGET_CAP_EXACT.has(key)) return true;
  return (
    key.startsWith("budgets.pages.") ||
    key.startsWith("budgets.routes.") ||
    key.startsWith("budgets.entries.")
  );
}

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

const pageJsForClass: Partial<Record<ClassName, (budgets: BudgetsSettings) => number>> = {
  "web-app": webAppPageJs,
  "astro-site": astroPageJs,
};

function effectivePageJs(config: WebTopsConfig): number {
  const budgets = budgetsSettings(config);
  const pick = pageJsForClass[config.class];
  return pick === undefined ? libraryPageJs(budgets) : pick(budgets);
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

/** Export keys used for size-limit entry budgets in `budgetEntriesOf`. */
export function entryKeysFor(config: WebTopsConfig): readonly string[] {
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

function packageClassJs(config: WebTopsConfig): number {
  return effectiveDefaultEntry(config);
}

const classJsForClass: Partial<Record<ClassName, (config: WebTopsConfig) => number>> = {
  "web-app": (cfg) => webAppPageJs(budgetsSettings(cfg)),
  "astro-site": (cfg) => astroPageJs(budgetsSettings(cfg)),
};

function classJsForBudgetedClass(config: WebTopsConfig): number {
  const pick = classJsForClass[config.class];
  return pick === undefined ? packageClassJs(config) : pick(config);
}

function classJsCeiling(config: WebTopsConfig): number | undefined {
  return classJsForBudgetedClass(config);
}

const noExplicitPageJs = (config: WebTopsConfig): boolean =>
  config.budgets?.page_js_bytes === undefined;

function webAppShowsClassJs(config: WebTopsConfig): boolean {
  return noExplicitPageJs(config) && config.budgets?.route_js_bytes === undefined;
}

function packageShowsClassJs(config: WebTopsConfig): boolean {
  return !hasLayerDefaultBytes(config) && noExplicitPageJs(config);
}

function showClassJsCeiling(config: WebTopsConfig): boolean {
  if (config.class === "web-app") return webAppShowsClassJs(config);
  if (config.class === "astro-site") return noExplicitPageJs(config);
  if (isPackageClass(config.class)) return packageShowsClassJs(config);
  return false;
}

function addClassJsCeiling(config: WebTopsConfig, values: Map<string, Ranked>): void {
  if (!showClassJsCeiling(config)) return;
  const classJs = classJsCeiling(config);
  if (classJs !== undefined) values.set(CLASS_JS_KEY, capRank(classJs));
}

function addAstroStaticCeiling(config: WebTopsConfig, values: Map<string, Ranked>): void {
  if (config.class !== "astro-site") return;
  values.set("budgets.static_page_js_bytes", capRank(effectiveStaticPageJs(config)));
}

function addExplicitPageJs(config: WebTopsConfig, values: Map<string, Ranked>): void {
  if (config.budgets?.page_js_bytes === undefined) return;
  values.set("budgets.page_js_bytes", capRank(effectivePageJs(config)));
}

function addExplicitRouteJs(config: WebTopsConfig, values: Map<string, Ranked>): void {
  if (config.budgets?.route_js_bytes === undefined) return;
  values.set(
    "budgets.route_js_bytes",
    capRank(routeBudget(ROUTE_JS_ROOT, budgetsSettings(config))),
  );
}

function ceilingEntries(config: WebTopsConfig): Map<string, Ranked> {
  const values = new Map<string, Ranked>();
  addClassJsCeiling(config, values);
  addAstroStaticCeiling(config, values);
  addExplicitPageJs(config, values);
  addExplicitRouteJs(config, values);
  return values;
}

function pageBudgetEntries(config: WebTopsConfig): Map<string, Ranked> {
  const pages = config.budgets?.pages;
  if (pages === undefined) return new Map();
  return new Map(
    Object.entries(pages)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([route, bytes]) => [`budgets.pages.${route}`, capRank(bytes)] as const),
  );
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

function sizeLimitBudgetEntries(config: WebTopsConfig): Map<string, Ranked> {
  const values = new Map<string, Ranked>();
  if (hasLayerDefaultBytes(config)) {
    values.set("layers.size_limit.default_bytes", capRank(effectiveDefaultEntry(config)));
  }
  const sizeLayer = sizeLimitLayer(config);
  for (const key of entryKeysFor(config)) {
    values.set(`budgets.entries.${key}`, capRank(budgetForEntry(key, sizeLayer)));
  }
  return values;
}

function mergeBudgetMaps(...parts: ReadonlyMap<string, Ranked>[]): Map<string, Ranked> {
  const values = new Map<string, Ranked>();
  for (const part of parts) for (const [key, ranked] of part) values.set(key, ranked);
  return values;
}

function classJsCapBytes(config: WebTopsConfig): number | undefined {
  return showClassJsCeiling(config) ? classJsCeiling(config) : undefined;
}

type ScalarCapReader = (config: WebTopsConfig) => number | undefined;

const scalarCapReaders: Record<string, ScalarCapReader> = {
  [CLASS_JS_KEY]: classJsCapBytes,
  "budgets.page_js_bytes": (config) =>
    config.budgets?.page_js_bytes === undefined ? undefined : effectivePageJs(config),
  "budgets.static_page_js_bytes": (config) =>
    config.class === "astro-site" ? effectiveStaticPageJs(config) : undefined,
  "budgets.route_js_bytes": (config) =>
    config.budgets?.route_js_bytes === undefined
      ? undefined
      : routeBudget(ROUTE_JS_ROOT, budgetsSettings(config)),
  "layers.size_limit.default_bytes": (config) =>
    hasLayerDefaultBytes(config) ? effectiveDefaultEntry(config) : undefined,
};

function namedCapBytes(key: string, config: WebTopsConfig): number | undefined {
  const read = scalarCapReaders[key];
  return read === undefined ? undefined : read(config);
}

function pageCapFromKey(key: string, config: WebTopsConfig): number | undefined {
  const route = key.slice("budgets.pages.".length);
  return budgetForPage(route, config.class, true, budgetsSettings(config));
}

function routeCapFromKey(key: string, config: WebTopsConfig): number | undefined {
  const route = key.slice("budgets.routes.".length);
  return routeBudget(route, budgetsSettings(config));
}

function entryCapFromKey(key: string, config: WebTopsConfig): number | undefined {
  const entry = key.slice("budgets.entries.".length);
  return budgetForEntry(entry, sizeLimitLayer(config));
}

function mapCapBytes(key: string, config: WebTopsConfig): number | undefined {
  if (key.startsWith("budgets.pages.")) return pageCapFromKey(key, config);
  if (key.startsWith("budgets.routes.")) return routeCapFromKey(key, config);
  if (key.startsWith("budgets.entries.")) return entryCapFromKey(key, config);
  return undefined;
}

/** Gate-effective byte ceiling for one judged settings key at a ref. */
export function effectiveCapBytes(key: string, config: WebTopsConfig): number | undefined {
  return namedCapBytes(key, config) ?? mapCapBytes(key, config);
}

function addCapKeysFromEntries(keys: Set<string>, config: WebTopsConfig): void {
  for (const key of budgetEntriesOf(config).keys()) {
    if (isBudgetCapKey(key)) keys.add(key);
  }
}

/** Every byte-cap settings key that should be compared across two refs. */
export function judgedCapKeys(base: WebTopsConfig, head: WebTopsConfig): string[] {
  const keys = new Set<string>();
  addCapKeysFromEntries(keys, base);
  addCapKeysFromEntries(keys, head);
  return [...keys].sort();
}

function compareCapNumbers(before: number, after: number): Item["change"] {
  if (after > before) return "weakened";
  if (after < before) return "strengthened";
  return "unchanged";
}

function absentCapChange(before: number | undefined, after: number | undefined): Item["change"] {
  if (before === undefined) return after === undefined ? "unchanged" : "strengthened";
  return "weakened";
}

export function directionOf(before: number | undefined, after: number | undefined): Item["change"] {
  if (typeof before === "number" && typeof after === "number")
    return compareCapNumbers(before, after);
  return absentCapChange(before, after);
}

function compareCapKey(key: string, base: WebTopsConfig, head: WebTopsConfig): Item[] {
  const before = effectiveCapBytes(key, base);
  const after = effectiveCapBytes(key, head);
  const change = directionOf(before, after);
  if (change === "unchanged") return [];
  return [
    {
      what: key,
      change,
      before: before === undefined ? "absent" : String(before),
      after: after === undefined ? "absent" : String(after),
    },
  ];
}

const subsetValues = (
  values: ReadonlyMap<string, Ranked>,
  keys: readonly string[],
): Map<string, Ranked> => {
  const picked = new Map<string, Ranked>();
  for (const key of keys) {
    const ranked = values.get(key);
    if (ranked !== undefined) picked.set(key, ranked);
  }
  return picked;
};

const nonCapSettingKeys = (base: Settings, head: Settings): string[] =>
  [...new Set([...base.values.keys(), ...head.values.keys()])].filter(
    (key) => !isBudgetCapKey(key),
  );

/** Compare gate settings, using effective byte ceilings instead of generic rank add/remove for caps. */
export function compareBudgetSettings(base: Settings, head: Settings): Item[] {
  const otherKeys = nonCapSettingKeys(base, head);
  const fromMaps = compareRanked(
    subsetValues(base.values, otherKeys),
    subsetValues(head.values, otherKeys),
  );
  const capItems = judgedCapKeys(base.config, head.config).flatMap((key) =>
    compareCapKey(key, base.config, head.config),
  );
  return [...fromMaps, ...capItems].sort((left, right) => left.what.localeCompare(right.what));
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
