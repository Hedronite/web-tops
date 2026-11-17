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

export type BuiltInLayerId = (typeof LAYER_IDS)[number];
export type Verdict = (typeof VERDICTS)[number];

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

/**
 * Every layer and law is required until G3's class profiles carry the `required` field (SPEC-p3 G1).
 * One constant, so G2 and G3 replace it by the profile's value in one place.
 */
export const REQUIRED_UNTIL_PROFILES = true;

/** Whether a verdict on an item ends the run (WEB_TOPS.md section 3.3). */
export function endsRun(verdict: Verdict, required: boolean): boolean {
  const row = FAILURE[verdict];
  return row.ends_run && (required || !row.only_when_required);
}

export interface Finding {
  /** A tool rule id or a law id. */
  readonly rule: string;
  /** A `skip` finding records a step the class does not map, or one switched off; its reason is the message. */
  readonly verdict: Verdict;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  /** Present on an acknowledged soft-rule finding, whose verdict is `pass` (section 3.3). */
  readonly ack?: { readonly source: "comment" | "ledger"; readonly reason: string };
}

export interface LayerReport {
  /** A built-in layer id or a custom layer id. */
  readonly id: string;
  /** The gate number of section 3.1; `laws` runs last, at the tier of the layers it reads. */
  readonly gate: 1 | 2 | 3 | 4 | 5 | 6 | "laws";
  readonly tier: Tier;
  readonly verdict: Verdict;
  /** Required on `skip` and `not-run`. */
  readonly reason?: string;
  readonly findings: readonly Finding[];
  readonly artifacts?: readonly string[];
  readonly duration_ms?: number;
  /** The shuffle seed the tests layer passed (WEB_TOPS.md section 6.6). */
  readonly seed?: number;
}

export interface GateReport {
  readonly protocol: string;
  readonly class: ClassName;
  readonly enforce: Enforce;
  /** False only under `advisory`: verdicts are kept, but nothing fails. */
  readonly enforced: boolean;
  readonly max_tier: Tier;
  /** The `--only` layer, or null. */
  readonly only: string | null;
  readonly counts: {
    /** Layers enabled, mapped by the class, within `--max-tier` and `--only` (section 3.3). */
    readonly in_range: number;
    readonly ran: number;
    /** Every layer whose verdict ends the run (section 3.3); a required `not-evaluated` is in it and in `not_evaluated`. */
    readonly failed: number;
    readonly not_evaluated: number;
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

/** The layers whose verdict ends the run, with every item required (`REQUIRED_UNTIL_PROFILES`). */
function endingCount(report: GateReport): number {
  return report.layers.filter((layer) => endsRun(layer.verdict, REQUIRED_UNTIL_PROFILES)).length;
}

function one(pointer: string, message: string): readonly Problem[] {
  return [{ pointer, message }];
}

function duplicateLayers(report: GateReport): readonly Problem[] {
  const ids = report.layers.map((layer) => layer.id);
  return [...new Set(ids)]
    .filter((id) => ids.indexOf(id) !== ids.lastIndexOf(id))
    .map((id) => ({ pointer: "/layers", message: `layer "${id}" appears more than once` }));
}

/** The verdicts that end the run, named in a message. */
const ENDING = VERDICTS.filter((verdict) => endsRun(verdict, REQUIRED_UNTIL_PROFILES));

function notEvaluatedCount(report: GateReport): readonly Problem[] {
  const claimed = report.counts.not_evaluated;
  const held = count(report, ["not-evaluated"]);
  if (claimed === held) return [];
  return one(
    "/counts/not_evaluated",
    `counts ${String(claimed)} not-evaluated layers, the layers hold ${String(held)}`,
  );
}

function failedCount(report: GateReport): readonly Problem[] {
  const claimed = report.counts.failed;
  const held = endingCount(report);
  if (claimed === held) return [];
  return one(
    "/counts/failed",
    `counts ${String(claimed)} failed layers (${ENDING.join(", ")}), the layers hold ${String(held)}`,
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
  notEvaluatedCount,
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
