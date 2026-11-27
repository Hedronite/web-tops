import { join } from "node:path";
import type { BudgetsSettings } from "../../gate/types.ts";
import { brotliBytes, createBrotliCache } from "../bytes/index.ts";
import { WEB_APP_ROUTE_JS_BYTES } from "../bytes/budgets.ts";
import { extractPageScripts } from "../bytes/html.ts";
import type { DistInventory } from "../build/index.ts";
import type { Visit } from "./run.ts";

/** What one route makes the browser run, in brotli bytes (WEB_TOPS.md section 7). */
export interface RouteBytes {
  readonly route: string;
  readonly inlineBytes: number;
  readonly scriptBytes: number;
  readonly totalBytes: number;
  readonly budgetBytes: number;
  /** The files of `dist/` the browser asked for, each once. */
  readonly scripts: readonly string[];
  /** Scripts from another origin: they are not in `dist/`, so they are listed and not counted. */
  readonly external: readonly string[];
  readonly passed: boolean;
}

export type Measured =
  | { readonly ok: true; readonly routes: readonly RouteBytes[] }
  | { readonly ok: false; readonly reason: string };

const everyRoute = (budgets: BudgetsSettings): number =>
  budgets.routeJsBytes ?? WEB_APP_ROUTE_JS_BYTES;

/** The route's own ceiling, else the one for every route, else the class default (WEB_TOPS.md section 5.2). */
export function routeBudget(route: string, budgets: BudgetsSettings = {}): number {
  const own = budgets.routes ?? {};
  return own[route] ?? everyRoute(budgets);
}

interface Asked {
  readonly local: readonly string[];
  readonly external: readonly string[];
}

const unique = (values: readonly string[]): string[] => [...new Set(values)].sort();

/** The served paths under `dist/`, decoded as the server decodes them, and the URLs from anywhere else. */
function asked(visit: Visit, origin: string): Asked {
  const local = visit.scripts.filter((url) => url.startsWith(`${origin}/`));
  return {
    local: unique(local.map((url) => decodeURIComponent(new URL(url).pathname).slice(1))),
    external: unique(visit.scripts.filter((url) => !local.includes(url))),
  };
}

type Sizer = (path: string) => number;

function inlineSize(html: string): number {
  return extractPageScripts(html).inlineBodies.reduce(
    (total, body) => total + brotliBytes(body),
    0,
  );
}

function routeBytes(
  visit: Visit,
  files: Asked,
  distDir: string,
  size: Sizer,
  budgetBytes: number,
): RouteBytes {
  const inlineBytes = inlineSize(visit.html);
  const scriptBytes = files.local.reduce((total, file) => total + size(join(distDir, file)), 0);
  const totalBytes = inlineBytes + scriptBytes;
  return {
    route: visit.route,
    inlineBytes,
    scriptBytes,
    totalBytes,
    budgetBytes,
    scripts: files.local,
    external: files.external,
    passed: totalBytes <= budgetBytes,
  };
}

/** Sizes each route's scripts from `dist/`, so the bytes are the ones the page-bytes layer would count. */
export function measureRoutes(
  visits: readonly Visit[],
  origin: string,
  inventory: DistInventory,
  budgets: BudgetsSettings | undefined,
): Measured {
  const known = new Set(inventory.files);
  const found = visits.map((visit) => ({ visit, files: asked(visit, origin) }));
  const unknown = found.flatMap(({ files }) => files.local.filter((file) => !known.has(file)));
  if (unknown.length > 0) {
    return {
      ok: false,
      reason: `served scripts that are not files of dist/: ${unknown.join(", ")}`,
    };
  }
  const size = createBrotliCache();
  return {
    ok: true,
    routes: found.map(({ visit, files }) =>
      routeBytes(visit, files, inventory.distDir, size, routeBudget(visit.route, budgets)),
    ),
  };
}
