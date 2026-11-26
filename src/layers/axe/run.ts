import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LayerContext } from "../../gate/types.ts";
import type { RawFinding } from "../../report/findings.ts";
import {
  arrayOf,
  failFinding,
  launchFailure,
  parseJson,
  records,
  str,
} from "../hygiene/tooling.ts";
import { axeOptions, toolPackages, viewport } from "./options.ts";
import type { Target } from "./targets.ts";

export const AXE_TIMEOUT_MS = 300_000;

/** One element one axe rule reported on one page. */
export interface AxeEntry extends Target {
  readonly law: "W-21" | "W-44";
  readonly rule: string;
  readonly impact: string;
  readonly selector: string;
  readonly help: string;
}

export type Visited =
  | {
      readonly ok: true;
      readonly violations: readonly AxeEntry[];
      readonly incomplete: readonly AxeEntry[];
    }
  | { readonly ok: false; readonly finding: RawFinding };

const refused = (rule: string, message: string): Visited => ({
  ok: false,
  finding: failFinding("webtops", rule, message),
});

/** axe's target path as one string: `>>>` between frames, `>>` into a shadow root. */
function selectorOf(target: unknown): string {
  return arrayOf(target)
    .map((frame) => [frame].flat().map(String).join(" >> "))
    .join(" >>> ");
}

/** One entry for each element; a rule that names none still counts once, never as nothing. */
function entriesOf(found: Record<string, unknown>, target: Target): AxeEntry[] {
  const rule = str(found["id"], "");
  const nodes = records(found["nodes"]);
  const base = {
    ...target,
    law: rule === "target-size" ? "W-44" : "W-21",
    rule,
    impact: str(found["impact"], "unknown"),
    help: str(found["help"], ""),
  } as const;
  return (nodes.length === 0 ? [{}] : nodes).map((node: Record<string, unknown>) => ({
    ...base,
    selector: selectorOf(node["target"]),
  }));
}

const answered = (result: Record<string, unknown>): boolean =>
  Array.isArray(result["violations"]) && Array.isArray(result["incomplete"]);

function listed(
  results: readonly Record<string, unknown>[],
  key: "violations" | "incomplete",
  targets: readonly Target[],
): AxeEntry[] {
  return targets.flatMap((target, index) =>
    records(results[index]?.[key]).flatMap((found) => entriesOf(found, target)),
  );
}

function judgedAll(
  results: readonly Record<string, unknown>[],
  targets: readonly Target[],
): Visited {
  const count = results.filter(answered).length;
  return count === targets.length
    ? {
        ok: true,
        violations: listed(results, "violations", targets),
        incomplete: listed(results, "incomplete", targets),
      }
    : refused("axe-unanswered", `axe answered ${String(count)} of ${String(targets.length)} pages`);
}

/** A route the server answered with an error is not the page, so judging it would judge nothing. */
function read(stdout: string, targets: readonly Target[]): Visited {
  const results = records(parseJson(stdout));
  const unserved = targets.filter((_target, index) => Number(results[index]?.["status"]) >= 400);
  return unserved.length === 0
    ? judgedAll(results, targets)
    : refused(
        "axe-route-not-served",
        `dist/ serves no page for ${unserved.map((target) => target.route).join(", ")}`,
      );
}

function writeRequest(context: LayerContext, urls: readonly string[]): string {
  const directory = join(context.outDir, "axe");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "request.json");
  const request = {
    cwd: context.cwd,
    tools: toolPackages(),
    options: axeOptions(),
    viewport: viewport(),
    urls,
  };
  writeFileSync(path, JSON.stringify(request));
  return path;
}

/** The first tool package the project has not installed. */
export const missingTool = (cwd: string): string | undefined =>
  Object.values(toolPackages()).find(
    (name) => !existsSync(join(cwd, "node_modules", name, "package.json")),
  );

/** The first lines of what the driver wrote: Playwright says what is wrong first and prints its advice after. */
const first = (text: string): string => text.trim().split("\n").slice(0, 4).join("\n");

/** Runs the driver under `node` against the served pages; the time limit also reaps the browser it started. */
export async function visitPages(
  context: LayerContext,
  origin: string,
  targets: readonly Target[],
): Promise<Visited> {
  const request = writeRequest(
    context,
    targets.map((target) => `${origin}${target.route}`),
  );
  const result = await context.exec("node", [join(import.meta.dirname, "drive.mjs"), request], {
    cwd: context.cwd,
    env: context.env,
    timeoutMs: AXE_TIMEOUT_MS,
  });
  const launch = launchFailure("webtops", "axe", result);
  if (launch !== undefined) return { ok: false, finding: launch };
  return result.code === 0
    ? read(result.stdout, targets)
    : refused("axe-failed", `axe exited ${String(result.code)}: ${first(result.stderr)}`);
}
