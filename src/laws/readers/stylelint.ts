import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { withinSource } from "../../census/files.ts";
import { askStyle, configNames } from "../../lawdiff/style.ts";
import type { Rules } from "../../lawdiff/types.ts";
import { parseJson, readOutput, records, relativeTo, str } from "../../layers/hygiene/tooling.ts";
import type { RawFinding } from "../../report/findings.ts";
import { isData } from "./files.ts";
import { notEvaluated, readingOf, rulesOf } from "./reading.ts";
import type { LawEntry, LawReader, LawReading, ReadInput } from "./types.ts";

const TOOL = "stylelint";

/** The file types gate 1 hands to Stylelint for a class (WEB_TOPS.md section 7). */
const extensionsOf = (className: string): readonly string[] =>
  className === "astro-site" ? [".css", ".astro"] : [".css"];

const isSource = (file: string): boolean => withinSource(file) && !isData(file);

/** What Stylelint is asked about: the tracked stylesheets, and a probe path for each type the project has none of. */
export function sheetsOf(
  tracked: readonly string[],
  className: string,
): { readonly files: readonly string[]; readonly probes: readonly string[] } {
  const wanted = extensionsOf(className);
  const files = tracked.filter((file) => wanted.includes(extname(file)) && isSource(file));
  const have = new Set(files.map((file) => extname(file)));
  const probes = wanted
    .filter((extension) => !have.has(extension))
    .map((extension) => `src/__webtops_probe__${extension}`);
  return { files, probes };
}

/** What the reader judges a law over. */
export interface StyleEvidence {
  /** The tracked stylesheets. */
  readonly files: readonly string[];
  /** The effective rules of each file Stylelint reaches, probe paths among them. */
  readonly rules: Rules;
  /** Gate 1's JSON: one result for each file it linted. */
  readonly results: readonly Record<string, unknown>[];
  readonly cwd: string;
  readonly configFile: string;
  readonly held: boolean;
}

const refusal = (rule: string, message: string, file: string, line?: number): RawFinding => ({
  tool: TOOL,
  rule,
  verdict: "refuse",
  message,
  file,
  ...(line === undefined ? {} : { line }),
});

/** A rule below `error`, or absent, for any file Stylelint reaches: Stylelint's rules are not scoped by file type. */
function lapse(evidence: StyleEvidence, name: string): RawFinding[] {
  const below = [...evidence.rules]
    .filter(([, rules]) => (rules.get(name)?.level ?? 0) < 2)
    .map(([file]) => file);
  return below.length === 0
    ? []
    : [
        refusal(
          name,
          `${name} is below error for ${String(below.length)} file(s), such as ${String(below[0])}`,
          evidence.configFile,
          1,
        ),
      ];
}

/** A tracked stylesheet an ignore drops is linted by nothing, so no style law judges it. */
const unlinted = (evidence: StyleEvidence): RawFinding[] =>
  evidence.files
    .filter((file) => !evidence.rules.has(file))
    .map((file) =>
      refusal("file-set", `${file} is not linted by Stylelint: an ignore drops it`, file),
    );

const lineOf = (entry: Record<string, unknown>): number | undefined =>
  typeof entry["line"] === "number" ? entry["line"] : undefined;

/** The errors of one file: its warnings, and the values Stylelint could not parse, which it lists apart. */
function errorsOf(cwd: string, result: Record<string, unknown>): RawFinding[] {
  const file = relativeTo(cwd, String(result["source"]));
  const parsed = records(result["parseErrors"]).map((entry) => ({ ...entry, rule: "parse-error" }));
  return [...records(result["warnings"]), ...parsed].map((entry: Record<string, unknown>) =>
    refusal(String(entry["rule"]), str(entry["text"], "no message"), file, lineOf(entry)),
  );
}

/** A file Stylelint could not parse was judged by no rule, so its syntax error breaks each law that reads it. */
const unread = (): readonly string[] => ["CssSyntaxError", "parse-error"];

function breaksOf(evidence: StyleEvidence, names: readonly string[]): RawFinding[] {
  const wanted = [...names, ...unread()];
  return evidence.results
    .flatMap((result) => errorsOf(evidence.cwd, result))
    .filter((found) => wanted.includes(found.rule) && isSource(String(found.file)));
}

/** Why no style rule can be judged, if none can. */
function blocked(evidence: StyleEvidence): string | undefined {
  if (evidence.rules.size === 0) {
    return "Stylelint's config reaches no stylesheet, so no rule can be judged";
  }
  const invalid = evidence.results.some(
    (result) => records(result["invalidOptionWarnings"]).length > 0,
  );
  return invalid
    ? "Stylelint's config holds an option it cannot use, so its rules did not all run"
    : undefined;
}

const probeNote = (evidence: StyleEvidence): { readonly note?: string } =>
  evidence.files.length === 0
    ? { note: "judged on a probe path: the project has no stylesheet" }
    : {};

/**
 * Gate 1 counts Stylelint's warnings, never the values it lists apart as unparsed, so no ratchet holds one of those
 * (section 6.7). A syntax error is a warning, and is held as gate 1 holds it.
 */
function readingUnder(law: LawEntry, found: readonly RawFinding[], held: boolean): LawReading {
  const unparsed = found.filter((one) => one.rule === "parse-error");
  return held && unparsed.length > 0
    ? readingOf(law, unparsed, false)
    : readingOf(law, found, held);
}

function judgedBreaks(evidence: StyleEvidence, law: LawEntry, names: string[]): LawReading {
  const reading = readingUnder(law, breaksOf(evidence, names), evidence.held);
  return reading.verdict === "pass" ? { ...probeNote(evidence), ...reading } : reading;
}

/** One law over its Stylelint rules: each at `error` for every file, every file linted, and no error of theirs. */
export function judgeStyle(evidence: StyleEvidence, law: LawEntry): LawReading {
  const reason = blocked(evidence);
  if (reason !== undefined) {
    return notEvaluated(law, reason);
  }
  const names = rulesOf(law, TOOL);
  const lapses = [...names.flatMap((name) => lapse(evidence, name)), ...unlinted(evidence)];
  return lapses.length > 0
    ? { law: law.id, verdict: "refuse", findings: lapses }
    : judgedBreaks(evidence, law, names);
}

const MISSING = "the Stylelint JSON of gate 1 is missing or is not an array of file results";

function resultsOf(input: ReadInput): Record<string, unknown>[] | undefined {
  const path = input.ctx.artifacts.get("stylelint-json");
  const json = parseJson(path === undefined ? undefined : readOutput(path));
  return Array.isArray(json) ? records(json) : undefined;
}

const configFileOf = (cwd: string): string =>
  configNames().find((name) => existsSync(join(cwd, name))) ?? "stylelint.config.js";

async function judgeAll(
  input: ReadInput,
  results: readonly Record<string, unknown>[],
): Promise<readonly LawReading[]> {
  const { cwd, env, exec, outDir, config } = input.ctx;
  const { files, probes } = sheetsOf(input.tracked, config.class);
  const asked = await askStyle({ cwd, env, exec, outDir }, [...files, ...probes]);
  if (!asked.ok) {
    return input.laws.map((law) => ({
      law: law.id,
      verdict: "fail",
      reason: asked.message,
      findings: [],
    }));
  }
  const evidence = {
    files,
    rules: asked.value,
    results,
    cwd,
    configFile: configFileOf(cwd),
    held: input.held,
  };
  return input.laws.map((law) => judgeStyle(evidence, law));
}

/** The Stylelint reader (W-24, W-25, W-26): gate 1's JSON and each stylesheet's effective rules. */
export const stylelintReader: LawReader = (input) => {
  const results = resultsOf(input);
  return results === undefined
    ? Promise.resolve(input.laws.map((law) => notEvaluated(law, MISSING)))
    : judgeAll(input, results);
};
