import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LayerContext } from "../../gate/types.ts";
import type { RawFinding } from "../../report/findings.ts";
import { failFinding, launchFailure, parseJson, records } from "../hygiene/tooling.ts";

export const ROUTE_TIMEOUT_MS = 300_000;

/** The package the driver loads from the project. */
export const PLAYWRIGHT = (): string => "@playwright/test";

/** What the browser did on one route: the document it got and the scripts it asked for. */
export interface Visit {
  readonly route: string;
  readonly html: string;
  readonly scripts: readonly string[];
}

export type Visited =
  | { readonly ok: true; readonly visits: readonly Visit[] }
  | { readonly ok: false; readonly finding: RawFinding };

const refused = (rule: string, message: string): Visited => ({
  ok: false,
  finding: failFinding("webtops", rule, message),
});

type Result = Record<string, unknown>;

const answered = (result: Result): boolean =>
  typeof result["html"] === "string" &&
  Array.isArray(result["scripts"]) &&
  Array.isArray(result["failed"]);

/** The scripts of one route that the server refused or the browser could not fetch. */
function broken(result: Result): string[] {
  const refusedScripts = records(result["scripts"])
    .filter((script) => Number(script["status"]) >= 400)
    .map((script) => String(script["url"]));
  return [...refusedScripts, ...[result["failed"]].flat().map(String)];
}

const visitOf = (route: string, result: Result): Visit => ({
  route,
  html: String(result["html"]),
  scripts: records(result["scripts"]).map((script) => String(script["url"])),
});

/** A script that did not arrive would count as no bytes, so it ends the run instead. */
function complete(results: readonly Result[], routes: readonly string[]): Visited {
  const answers = results.map((result, index) => ({ route: String(routes[index]), result }));
  // A script the server refused is also a request the browser reports as failed: it is named once.
  const lost = answers.flatMap(({ route, result }) =>
    broken(result).map((url) => `${route}: ${new URL(url).pathname}`),
  );
  return lost.length === 0
    ? { ok: true, visits: answers.map(({ route, result }) => visitOf(route, result)) }
    : refused("route-script-failed", `scripts did not load: ${[...new Set(lost)].join(", ")}`);
}

function read(stdout: string, routes: readonly string[]): Visited {
  const results = records(parseJson(stdout));
  const unserved = routes.filter((_route, index) => Number(results[index]?.["status"]) >= 400);
  if (unserved.length > 0) {
    return refused("route-not-served", `dist/ serves no page for ${unserved.join(", ")}`);
  }
  const count = results.filter(answered).length;
  return count === routes.length
    ? complete(results, routes)
    : refused(
        "route-bytes-unanswered",
        `the browser answered ${String(count)} of ${String(routes.length)} routes`,
      );
}

function writeRequest(context: LayerContext, urls: readonly string[]): string {
  const directory = join(context.outDir, "route-bytes");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "request.json");
  const request = {
    cwd: context.cwd,
    tool: PLAYWRIGHT(),
    viewport: { width: 1280, height: 720 },
    urls,
  };
  writeFileSync(path, JSON.stringify(request));
  return path;
}

/** The first lines of what the driver wrote: Playwright says what is wrong first and prints its advice after. */
const first = (text: string): string => text.trim().split("\n").slice(0, 4).join("\n");

/** Runs the driver under `node` against the served routes; the time limit also reaps the browser it started. */
export async function visitRoutes(
  context: LayerContext,
  origin: string,
  routes: readonly string[],
): Promise<Visited> {
  const request = writeRequest(
    context,
    routes.map((route) => `${origin}${route}`),
  );
  const result = await context.exec("node", [join(import.meta.dirname, "drive.mjs"), request], {
    cwd: context.cwd,
    env: context.env,
    timeoutMs: ROUTE_TIMEOUT_MS,
  });
  const launch = launchFailure("webtops", "route-bytes", result);
  if (launch !== undefined) return { ok: false, finding: launch };
  return result.code === 0
    ? read(result.stdout, routes)
    : refused(
        "route-bytes-failed",
        `route-bytes exited ${String(result.code)}: ${first(result.stderr)}`,
      );
}
