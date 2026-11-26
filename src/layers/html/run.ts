import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LayerContext } from "../../gate/types.ts";
import type { RawFinding } from "../../report/findings.ts";
import type { DistInventory } from "../build/index.ts";
import {
  arrayOf,
  failFinding,
  launchFailure,
  parseJson,
  records,
  relativeTo,
  resolveTool,
  str,
  tail,
} from "../hygiene/tooling.ts";
import { passes } from "./passes.ts";

export const HTML_TIMEOUT_MS = 120_000;

/** One error html-validate reported on one built page; `file` is relative to `dist/`. */
export interface HtmlError {
  readonly law: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly rule: string;
  readonly message: string;
}

export type Validated =
  | { readonly ok: true; readonly errors: readonly HtmlError[] }
  | { readonly ok: false; readonly finding: RawFinding };

const refused = (rule: string, message: string): Validated => ({
  ok: false,
  finding: failFinding("webtops", rule, message),
});

/** html-validate's severity 2 is an error; a warning (1) fails nothing (WEB_TOPS.md section 7: "Any error"). */
const errorsOf = (result: Record<string, unknown>): HtmlError[] =>
  records(result["messages"])
    .filter((message) => message["severity"] === 2)
    .map((message) => ({
      law: str(result["law"], ""),
      file: str(result["file"], ""),
      line: Number(message["line"]),
      column: Number(message["column"]),
      rule: str(message["ruleId"], ""),
      message: str(message["message"], ""),
    }));

/** A rule both runs hold (`no-dup-id`, for one) is reported once, under the law of the first run that found it. */
function once(errors: readonly HtmlError[]): HtmlError[] {
  const seen = new Map<string, HtmlError>();
  for (const error of errors) {
    const key = [error.file, error.line, error.column, error.rule].join("\0");
    seen.set(key, seen.get(key) ?? error);
  }
  return [...seen.values()];
}

/** The driver answers one result for each page in each run; fewer is a page nobody judged, never a pass. */
function read(stdout: string, pages: number): Validated {
  const results = arrayOf(parseJson(stdout));
  const expected = pages * passes().length;
  return results.length === expected
    ? { ok: true, errors: once(records(results).flatMap(errorsOf)) }
    : refused(
        "html-validate-incomplete",
        `html-validate answered ${String(results.length)} of ${String(expected)} page results`,
      );
}

function writeRequest(context: LayerContext, inventory: DistInventory): string {
  const directory = join(context.outDir, "html");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "request.json");
  const request = {
    cwd: context.cwd,
    tool: "html-validate",
    distDir: inventory.distDir,
    files: inventory.pages.map((page) => page.file),
    passes: passes(),
  };
  writeFileSync(path, JSON.stringify(request));
  return path;
}

async function drive(context: LayerContext, inventory: DistInventory): Promise<Validated> {
  const driver = join(import.meta.dirname, "validate.mjs");
  const result = await context.exec("node", [driver, writeRequest(context, inventory)], {
    cwd: context.cwd,
    env: context.env,
    timeoutMs: HTML_TIMEOUT_MS,
  });
  const launch = launchFailure("webtops", "html-validate", result);
  if (launch !== undefined) return { ok: false, finding: launch };
  return result.code === 0
    ? read(result.stdout, inventory.pages.length)
    : refused(
        "html-validate-failed",
        `html-validate exited ${String(result.code)}: ${tail(result.stderr)}`,
      );
}

/** Validates every page of the inventory with the project's own installed html-validate, under `node`. */
export function validatePages(context: LayerContext, inventory: DistInventory): Promise<Validated> {
  const spec = { package: "html-validate", bin: "html-validate" };
  return resolveTool(context.cwd, spec) === undefined
    ? Promise.resolve(refused("tool-missing", "html-validate is not installed in node_modules"))
    : drive(context, inventory);
}

/**
 * The finding of one error. The report's closed tool list does not name html-validate yet, so the rule carries the
 * name, as knip's findings did before knip was listed.
 */
export const findingOf = (
  context: LayerContext,
  inventory: DistInventory,
  error: HtmlError,
): RawFinding => ({
  tool: "webtops",
  rule: `html-validate:${error.rule}`,
  law: error.law,
  verdict: "fail",
  message: `${error.message} (line ${String(error.line)}, column ${String(error.column)})`,
  file: relativeTo(context.cwd, join(inventory.distDir, error.file)),
  line: error.line,
});
