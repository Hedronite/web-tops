import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord, parseJson, readOutput, records } from "../../layers/hygiene/tooling.ts";
import type { LawEntry, LawReader, LawReading } from "./types.ts";
import type { RawFinding } from "../../report/findings.ts";
import { notEvaluated, readingOf, rulesOf } from "./reading.ts";

/** The config the rules are read from, and the tool the laws name them under. */
const CONFIG = ".dependency-cruiser.cjs";
const TOOL = "dependency-cruiser";

interface Cruise {
  /** The severity of each forbidden rule in the ruleset the run used. */
  readonly severities: ReadonlyMap<string, string>;
  readonly violations: readonly Record<string, unknown>[];
}

function severitiesOf(summary: Record<string, unknown>): Map<string, string> {
  const used = summary["ruleSetUsed"];
  const forbidden = isRecord(used) ? records(used["forbidden"]) : [];
  return new Map(
    forbidden.flatMap((rule): [string, string][] =>
      typeof rule["name"] === "string" ? [[rule["name"], String(rule["severity"])]] : [],
    ),
  );
}

/** The ruleset and the violations of a `depcruise --output-type json` run, or undefined when the text is not one. */
export function readCruise(text: string | undefined): Cruise | undefined {
  const value = parseJson(text);
  const summary = isRecord(value) ? value["summary"] : undefined;
  if (!isRecord(summary) || !Array.isArray(summary["violations"])) {
    return undefined;
  }
  return { severities: severitiesOf(summary), violations: records(summary["violations"]) };
}

/** The 1-based line of the config where the rule is named, or undefined. */
function lineOf(text: string | undefined, rule: string): number | undefined {
  const at = text?.split("\n").findIndex((line) => line.includes(`"${rule}"`)) ?? -1;
  return at === -1 ? undefined : at + 1;
}

const configFinding = (rule: string, message: string, line: number | undefined): RawFinding => ({
  tool: TOOL,
  rule,
  verdict: "refuse",
  message,
  file: CONFIG,
  ...(line === undefined ? {} : { line }),
});

/** A rule the run did not have, or had below `error`: off for a required law, at the config line that names it. */
function configBreak(
  rule: string,
  severity: string | undefined,
  config: string | undefined,
): RawFinding[] {
  if (severity === "error") {
    return [];
  }
  const said =
    severity === undefined
      ? `the rule ${rule} is not in the dependency-cruiser config`
      : `the rule ${rule} is at ${severity}, below error`;
  return [configFinding(rule, said, lineOf(config, rule))];
}

/** The violations of the rules a law maps, each as a refusal at the file that imports. */
function violationsOf(
  violations: readonly Record<string, unknown>[],
  names: readonly string[],
): RawFinding[] {
  return violations.flatMap((violation) => {
    const rule = violation["rule"];
    const name = isRecord(rule) ? String(rule["name"]) : undefined;
    if (name === undefined || !names.includes(name)) {
      return [];
    }
    const from = String(violation["from"]);
    const message = `${from} -> ${String(violation["to"])}`;
    return [{ tool: TOOL, rule: name, verdict: "refuse" as const, message, file: from }];
  });
}

/** One law's reading: each rule it maps must be at `error` in the run's ruleset, and have no violation. */
export function judgeCruise(
  cruise: Cruise,
  law: LawEntry,
  config: string | undefined,
  held: boolean,
): LawReading {
  const names = rulesOf(law, TOOL);
  const lapses = names.flatMap((name) => configBreak(name, cruise.severities.get(name), config));
  if (lapses.length > 0) {
    return { law: law.id, verdict: "refuse", findings: lapses };
  }
  return readingOf(law, violationsOf(cruise.violations, names), held);
}

const MISSING =
  "the dependency-cruiser output of gate 1 is missing or is not a depcruise JSON report";

/** The dependency-cruiser reader (W-16, W-17, W-19): it reads what gate 1 wrote and runs no cruise again. */
export const depcruiseReader: LawReader = (input) => {
  const path = input.ctx.artifacts.get("dependency-cruiser-json");
  const cruise = path === undefined ? undefined : readCruise(readOutput(path));
  if (cruise === undefined) {
    return Promise.resolve(input.laws.map((law) => notEvaluated(law, MISSING)));
  }
  const file = join(input.ctx.cwd, CONFIG);
  const config = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  return Promise.resolve(input.laws.map((law) => judgeCruise(cruise, law, config, input.held)));
};
