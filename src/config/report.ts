import type { ErrorObject } from "ajv";
import { ajv, toProblems } from "./ajv.ts";
import schema from "../../schema/gate-report.schema.json" with { type: "json" };
import type { ClassName } from "./profiles.ts";
import type { Enforce, Problem, Tier, Validated } from "./types.ts";

/** The seven built-in layers every report lists (WEB_TOPS.md section 6.6). A report may add custom ids. */
export const LAYER_IDS = [
  "hygiene",
  "tests",
  "coverage",
  "crap",
  "mutation",
  "build-output",
  "laws",
] as const;

/** The verdicts of section 3.3, in the order of `schema/core.schema.json` (a test holds them equal). */
export const VERDICTS = [
  "pass",
  "fail",
  "refuse",
  "ack-missing",
  "skip",
  "not-run",
  "not-evaluated",
  "vacuous",
] as const;

/** The report format's own version (WEB_TOPS.md section 6.6): it changes only when the report's shape does. */
export const REPORT_VERSION = "2.1.0";

export type BuiltInLayerId = (typeof LAYER_IDS)[number];

/** Per function `{file, name, line, complexity, coverage, crap}`, for the CRAP layer. */
export interface CrapMetric {
  readonly file: string;
  readonly name: string;
  readonly line: number;
  readonly complexity: number;
  readonly coverage: number;
  readonly crap: number;
}

/** Per file `{file, lines_found, lines_hit}`, for the coverage layer. */
export interface CoverageMetric {
  readonly file: string;
  readonly lines_found: number;
  readonly lines_hit: number;
}

/** Per rule per file `{rule, file, count}`, for the layers that report findings. */
export interface FindingMetric {
  readonly rule: string;
  readonly file: string;
  readonly count: number;
}

/** Per page `{route, bytes}`, for build output. */
export interface PageMetric {
  readonly route: string;
  readonly bytes: number;
}

/** What `webtops baseline` projects from (section 6.6): an empty object until a layer has metrics. */
export interface Metrics {
  readonly crap?: readonly CrapMetric[];
  readonly coverage?: readonly CoverageMetric[];
  readonly findings?: readonly FindingMetric[];
  readonly pages?: readonly PageMetric[];
}

/** The package and the root the run judged. */
export interface Subject {
  readonly package: string;
  /** The project's directory, relative to the git top level; `.` at the top level itself. */
  readonly root: string;
}

/** What the run ran on; a value that could not be read is null (section 6.6). */
export interface RunBlock {
  readonly sha: string | null;
  readonly bun: string | null;
  readonly node: string | null;
  /** The version of every tool that ran, read from its package in `node_modules`, by package name. */
  readonly tools: Readonly<Record<string, string>>;
  /** The shuffle seed the tests layer passed. */
  readonly seed: number | null;
}
export type Verdict = (typeof VERDICTS)[number];

/** The closed set of tools a finding may name (WEB_TOPS.md section 6.6); `webtops` is the gate's own checks. */
export const TOOLS = [
  "astro",
  "attw",
  "audit",
  "biome",
  "bun",
  "dependency-cruiser",
  "eslint",
  "prettier",
  "publint",
  "stryker",
  "stylelint",
  "tsc",
  "vitest",
  "webtops",
] as const;

export type Tool = (typeof TOOLS)[number];

interface Failure {
  /** The verdict ends the run non-zero. */
  readonly ends_run: boolean;
  /** ...and does so only on an item that is `required`. */
  readonly only_when_required: boolean;
}

/** The failure table of section 3.3 (`$defs.failure` in `schema/core.schema.json`, held equal by a test). */
export const FAILURE: Readonly<Record<Verdict, Failure>> = {
  pass: { ends_run: false, only_when_required: false },
  fail: { ends_run: true, only_when_required: false },
  refuse: { ends_run: true, only_when_required: false },
  "ack-missing": { ends_run: true, only_when_required: false },
  skip: { ends_run: false, only_when_required: false },
  "not-run": { ends_run: true, only_when_required: false },
  "not-evaluated": { ends_run: true, only_when_required: true },
  vacuous: { ends_run: false, only_when_required: false },
};

/** Whether a verdict on an item ends the run (WEB_TOPS.md section 3.3). */
export function endsRun(verdict: Verdict, required: boolean): boolean {
  const row = FAILURE[verdict];
  return row.ends_run && (required || !row.only_when_required);
}

/** The six fields that key a mutation survivor (WEB_TOPS.md section 6.4); only a finding of the mutation layer has one. */
export interface Survivor {
  readonly file: string;
  readonly function: string;
  readonly mutator: string;
  readonly original: string;
  readonly replacement: string;
  readonly occurrence: number;
}

export interface Finding {
  /** The tool that said it, from the closed set of section 6.6. */
  readonly tool: Tool;
  /** The tool's rule id, or a kit id for one of the gate's own checks. */
  readonly rule: string;
  /** The law the finding maps to, or null until a reader maps it (M3). */
  readonly law: string | null;
  /** A `skip` finding records a step the class does not map, or one switched off; its reason is the message. */
  readonly verdict: Verdict;
  readonly message: string;
  /** Null when the finding has no place. */
  readonly file: string | null;
  readonly line: number | null;
  /** `fp1:` and 16 hex characters: the finding's key, which survives edits elsewhere in the file (section 6.6). */
  readonly fingerprint: string;
  /** On a law finding: whether the class profile requires the law (section 3.3). */
  readonly required?: boolean;
  /** Present on an acknowledged soft-rule finding, whose verdict is `pass` (section 3.3). */
  readonly ack?: { readonly source: "comment" | "ledger"; readonly reason: string };
  /** On a mutation survivor: the key a ledger entry matches it by. */
  readonly survivor?: Survivor;
}

export interface LayerReport {
  /** A built-in layer id or a custom layer id. */
  readonly id: string;
  /** The gate number of section 3.1; `laws` runs last, at the tier of the layers it reads. */
  readonly gate: 1 | 2 | 3 | 4 | 5 | 6 | "laws";
  readonly tier: Tier;
  /** Whether the class profile requires the layer; only a required `not-evaluated` ends the run (section 3.3). */
  readonly required: boolean;
  readonly verdict: Verdict;
  /** Required on `skip` and `not-run`. */
  readonly reason?: string;
  readonly findings: readonly Finding[];
  /** Shaped for `webtops baseline`; empty until the layer has metrics (section 6.6). */
  readonly metrics: Metrics;
  readonly artifacts?: readonly string[];
  readonly duration_ms?: number;
  /** The shuffle seed the tests layer passed (WEB_TOPS.md section 6.6). */
  readonly seed?: number;
}

export interface GateReport {
  readonly report_version: string;
  readonly protocol: string;
  readonly class: ClassName;
  readonly enforce: Enforce;
  /** False only under `advisory`: verdicts are kept, but nothing fails. */
  readonly enforced: boolean;
  readonly max_tier: Tier;
  /** The `--only` layer, or null. */
  readonly only: string | null;
  readonly subject: Subject;
  readonly run: RunBlock;
  readonly counts: {
    /** Layers enabled, mapped by the class, within `--max-tier` and `--only` (section 3.3). */
    readonly in_range: number;
    readonly ran: number;
    /** Every layer whose verdict ends the run (section 3.3); a required `not-evaluated` is in it and in `not_evaluated`. */
    readonly failed: number;
    readonly not_evaluated: number;
    /** The `not-evaluated` layers the class profile requires: the ones that end the run. */
    readonly required_not_evaluated: number;
  };
  readonly layers: readonly LayerReport[];
  // Optional fields the runner writes beside the required set.
  readonly package?: string;
  readonly base?: string | null;
  readonly keep_going?: boolean;
  readonly passed?: boolean;
  readonly exit_code?: 0 | 1 | 2 | 3 | 4;
  readonly problems?: readonly { readonly path: string; readonly message: string }[];
}

const validate = ajv.compile<GateReport>(schema);

/** Names the built-in layer a failed `contains` stands for: the schema lists them in LAYER_IDS order. */
function describe(error: ErrorObject): string | undefined {
  const index = /\/allOf\/(\d+)\/contains$/.exec(error.schemaPath)?.[1];
  const id = index === undefined ? undefined : LAYER_IDS[Number(index)];
  return id === undefined ? undefined : `layer "${id}" is missing`;
}

function count(report: GateReport, verdicts: readonly Verdict[]): number {
  return report.layers.filter((layer) => verdicts.includes(layer.verdict)).length;
}

/** The layers whose verdict ends the run: a `not-evaluated` only when the layer is required. */
function endingCount(report: GateReport): number {
  return report.layers.filter((layer) => endsRun(layer.verdict, layer.required)).length;
}

function one(pointer: string, message: string): readonly Problem[] {
  return [{ pointer, message }];
}

/** The layers whose findings the report counts per rule per file in `metrics.findings`. */
export const COUNTED_LAYERS: ReadonlySet<string> = new Set(["hygiene", "laws"]);

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function compareRows(left: FindingMetric, right: FindingMetric): number {
  return compareText(left.rule, right.rule) || compareText(left.file, right.file);
}

function bump(counts: Map<string, FindingMetric>, rule: string, file: string): void {
  const key = `${rule}\0${file}`;
  counts.set(key, { rule, file, count: (counts.get(key)?.count ?? 0) + 1 });
}

/** Counts per rule per file, from the findings alone, sorted by rule and then file. A finding with no file has no row. */
export function countsByRuleFile(findings: readonly Finding[]): FindingMetric[] {
  const counts = new Map<string, FindingMetric>();
  for (const finding of findings) {
    if (finding.file !== null) {
      bump(counts, finding.rule, finding.file);
    }
  }
  return [...counts.values()].sort(compareRows);
}

/** The layers that count findings carry exactly the counts their own findings give (section 6.6). */
function findingCounts(report: GateReport): readonly Problem[] {
  return report.layers.flatMap((layer, index) => {
    const held = JSON.stringify(countsByRuleFile(layer.findings));
    const said = JSON.stringify(layer.metrics.findings ?? []);
    return COUNTED_LAYERS.has(layer.id) && held !== said
      ? one(
          `/layers/${String(index)}/metrics/findings`,
          "counts per rule per file are not those of the layer's findings",
        )
      : [];
  });
}

function duplicateLayers(report: GateReport): readonly Problem[] {
  const ids = report.layers.map((layer) => layer.id);
  return [...new Set(ids)]
    .filter((id) => ids.indexOf(id) !== ids.lastIndexOf(id))
    .map((id) => ({ pointer: "/layers", message: `layer "${id}" appears more than once` }));
}

/** The verdicts that end the run, named in a message. */
const ENDING = `${VERDICTS.filter((verdict) => endsRun(verdict, false)).join(", ")}, and a required not-evaluated`;

function notEvaluatedCount(report: GateReport): readonly Problem[] {
  const claimed = report.counts.not_evaluated;
  const held = count(report, ["not-evaluated"]);
  if (claimed === held) return [];
  return one(
    "/counts/not_evaluated",
    `counts ${String(claimed)} not-evaluated layers, the layers hold ${String(held)}`,
  );
}

function requiredNotEvaluatedCount(report: GateReport): readonly Problem[] {
  const claimed = report.counts.required_not_evaluated;
  const held = report.layers.filter(
    (layer) => layer.verdict === "not-evaluated" && layer.required,
  ).length;
  if (claimed === held) return [];
  return one(
    "/counts/required_not_evaluated",
    `counts ${String(claimed)} required not-evaluated layers, the layers hold ${String(held)}`,
  );
}

function failedCount(report: GateReport): readonly Problem[] {
  const claimed = report.counts.failed;
  const held = endingCount(report);
  if (claimed === held) return [];
  return one(
    "/counts/failed",
    `counts ${String(claimed)} failed layers (${ENDING}), the layers hold ${String(held)}`,
  );
}

function ranCount(report: GateReport): readonly Problem[] {
  if (report.counts.ran <= report.counts.in_range) return [];
  return one("/counts/ran", "more layers ran than are in range");
}

function enforcedFlag(report: GateReport): readonly Problem[] {
  if (report.enforced === (report.enforce !== "advisory")) return [];
  return one("/enforced", "enforced is false exactly when enforce is advisory");
}

/** Every layer in range ran, none ended the run, and at least one was in range. */
function isClean(report: GateReport): boolean {
  const { counts } = report;
  return counts.in_range > 0 && endingCount(report) === 0 && counts.ran === counts.in_range;
}

function whyPassedIsWrong(report: GateReport, clean: boolean): string {
  if (clean) return "no layer failed and every layer in range ran, so the run passed";
  return report.counts.in_range === 0
    ? "no layer was in range, so the run did not pass: an empty run is not a pass"
    : "a layer failed or was not evaluated, or fewer layers ran than are in range, so the run did not pass";
}

function passedFlag(report: GateReport): readonly Problem[] {
  const clean = isClean(report);
  if (!report.enforced || report.passed === undefined || report.passed === clean) return [];
  return one("/passed", whyPassedIsWrong(report, clean));
}

const CHECKS: readonly ((report: GateReport) => readonly Problem[])[] = [
  duplicateLayers,
  findingCounts,
  notEvaluatedCount,
  requiredNotEvaluatedCount,
  failedCount,
  ranCount,
  enforcedFlag,
  passedFlag,
];

function consistency(report: GateReport): readonly Problem[] {
  return CHECKS.flatMap((check) => check(report));
}

/**
 * Validates a gate report against `schema/gate-report.schema.json`, then checks what a schema
 * cannot: unique layers, the `failed` and `not_evaluated` counts equal to the layers that hold
 * them (`failed` is every verdict the failure table ends the run on), and `passed` agreeing with the
 * counts. `not-evaluated` never yields a pass, and a run with no layer in range is not a pass either
 * (section 3.4, rule 5).
 */
export function validateReport(report: unknown): Validated<GateReport> {
  if (!validate(report)) return { ok: false, problems: toProblems(validate.errors, describe) };
  const problems = consistency(report);
  return problems.length === 0 ? { ok: true, value: report } : { ok: false, problems };
}
