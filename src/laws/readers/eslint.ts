import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseJson, readOutput, records } from "../../layers/hygiene/tooling.ts";
import type { LawEntry, LawReader, LawReading, ReadInput } from "./types.ts";
import { configTexts } from "./config-lines.ts";
import { readLaw, type Evidence } from "./eslint-judge.ts";

function configs(): string[] {
  return ["js", "mjs", "cjs", "ts", "mts", "cts"].map((ext) => `eslint.config.${ext}`);
}

/** The ESLint config file: the one the config names, else the flat config at the project's root. */
export function configFileOf(input: ReadInput): string {
  const named = input.ctx.config.hygiene.eslintConfig;
  return (
    named ?? configs().find((name) => existsSync(join(input.ctx.cwd, name))) ?? "eslint.config.js"
  );
}

const ruleIdOf = (message: Record<string, unknown>): string[] => {
  const id = message["ruleId"];
  return typeof id === "string" ? [id] : [];
};

/** ESLint's findings from gate 1, counted by rule id: the JSON the hygiene layer wrote, not a second run. */
export function countFindings(json: unknown): ReadonlyMap<string, number> | undefined {
  if (!Array.isArray(json)) {
    return undefined;
  }
  const counts = new Map<string, number>();
  for (const id of records(json).flatMap((entry) => records(entry["messages"]).flatMap(ruleIdOf))) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

const failedReading = (law: LawEntry, reason: string): LawReading => ({
  law: law.id,
  verdict: "fail",
  reason,
  findings: [],
});

function counts(input: ReadInput): ReadonlyMap<string, number> | string {
  const path = input.ctx.artifacts.get("eslint-json");
  const found = countFindings(parseJson(path === undefined ? undefined : readOutput(path)));
  return found ?? "the ESLint JSON of gate 1 is missing or is not an array of file results";
}

type Inputs = { readonly evidence: Evidence } | { readonly problem: string };

function evidenceOf(
  input: ReadInput,
  found: ReadonlyMap<string, number>,
  levels: Evidence["levels"],
): Evidence {
  const configFile = configFileOf(input);
  return {
    levels,
    counts: found,
    config: configTexts(input.ctx.cwd, configFile),
    configFile,
    held: input.held,
  };
}

async function inputsOf(input: ReadInput): Promise<Inputs> {
  const found = counts(input);
  if (typeof found === "string") {
    return { problem: found };
  }
  const facts = await input.eslint();
  return facts.ok
    ? { evidence: evidenceOf(input, found, facts.facts.levels) }
    : { problem: facts.message };
}

/** The ESLint reader: reads gate 1's JSON and each tracked TypeScript file's effective config (section 8.1). */
export const eslintReader: LawReader = async (input) => {
  const read = await inputsOf(input);
  return "problem" in read
    ? input.laws.map((law) => failedReading(law, read.problem))
    : input.laws.map((law) => readLaw(read.evidence, law));
};
