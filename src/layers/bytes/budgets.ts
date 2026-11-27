import type { ClassName } from "../../config/profiles.ts";
import type { BudgetsSettings } from "../../gate/types.ts";

/** Default brotli JS ceilings from WEB_TOPS.md §5.2 (`50 KiB` with islands, `170 KiB` per route). */
export const ASTRO_ISLAND_JS_BYTES = 50 * 1024;
export const ASTRO_STATIC_JS_BYTES = 0;
export const WEB_APP_ROUTE_JS_BYTES = 170 * 1024;

function staticAstroBudget(budgets: BudgetsSettings | undefined): number {
  if (budgets === undefined) return ASTRO_STATIC_JS_BYTES;
  return budgets.staticPageJsBytes ?? budgets.pageJsBytes ?? ASTRO_STATIC_JS_BYTES;
}

function astroBudget(hasIsland: boolean, budgets: BudgetsSettings | undefined): number {
  if (!hasIsland) return staticAstroBudget(budgets);
  return budgets === undefined
    ? ASTRO_ISLAND_JS_BYTES
    : (budgets.pageJsBytes ?? ASTRO_ISLAND_JS_BYTES);
}

function webAppBudget(budgets: BudgetsSettings | undefined): number {
  if (budgets === undefined) return WEB_APP_ROUTE_JS_BYTES;
  return budgets.routeJsBytes ?? budgets.pageJsBytes ?? WEB_APP_ROUTE_JS_BYTES;
}

function explicitPageBudget(
  route: string,
  pages: Readonly<Record<string, number>> | undefined,
): number | undefined {
  return pages === undefined ? undefined : pages[route];
}

/** Resolves the brotli JS byte ceiling for one built HTML page (WEB_TOPS.md §5.2/§7/§9). */
export function budgetForPage(
  route: string,
  className: ClassName,
  hasIsland: boolean,
  budgets: BudgetsSettings | undefined,
): number {
  const pages = budgets === undefined ? undefined : budgets.pages;
  const perPage = explicitPageBudget(route, pages);
  if (perPage !== undefined) return perPage;
  return className === "web-app" ? webAppBudget(budgets) : astroBudget(hasIsland, budgets);
}
