import type { ErrorObject } from "ajv";
import { ajv, toProblems } from "./ajv.ts";
import schema from "../../schema/gate-report.schema.json" with { type: "json" };
import type { ClassName } from "./profiles.ts";
import type { PROTOCOL } from "./protocol.ts";
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

/** The verdicts of section 3.3. */
export const VERDICTS = ["pass", "Refuse", "Ack", "skip", "not-run", "not-evaluated"] as const;

export type BuiltInLayerId = (typeof LAYER_IDS)[number];
export type Verdict = (typeof VERDICTS)[number];

export interface Finding {
  /** A tool rule id or a law id. */
  readonly rule: string;
  /** A `skip` finding records a step the class does not map, or one switched off; its reason is the message. */
  readonly verdict: Verdict;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  /** Present on an acknowledged `Ack` finding. */
  readonly ack?: { readonly source: "comment" | "ledger"; readonly reason: string };
}

export interface LayerReport {
  /** A built-in layer id or a custom layer id. */
  readonly id: string;
  /** The gate number of section 3.1; `laws` is tier 0 and runs last. */
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
  readonly protocol: typeof PROTOCOL;
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
    /** `Refuse`, unacknowledged `Ack` and `not-run`; `not_evaluated` is counted apart and also fails. */
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

const FAILING: readonly Verdict[] = ["Refuse", "Ack", "not-run"];

function count(report: GateReport, verdicts: readonly Verdict[]): number {
  return report.layers.filter((layer) => verdicts.includes(layer.verdict)).length;
}

function consistency(report: GateReport): readonly Problem[] {
  const problems: Problem[] = [];
  const add = (pointer: string, message: string): void => {
    problems.push({ pointer, message });
  };
  const ids = report.layers.map((layer) => layer.id);
  for (const id of new Set(ids)) {
    if (ids.indexOf(id) !== ids.lastIndexOf(id)) {
      add("/layers", `layer "${id}" appears more than once`);
    }
  }
  const { counts } = report;
  const notEvaluated = count(report, ["not-evaluated"]);
  if (counts.not_evaluated !== notEvaluated) {
    add(
      "/counts/not_evaluated",
      `counts ${String(counts.not_evaluated)} not-evaluated layers, the layers hold ${String(notEvaluated)}`,
    );
  }
  const failed = count(report, FAILING);
  if (counts.failed !== failed) {
    add(
      "/counts/failed",
      `counts ${String(counts.failed)} failed layers (Refuse, Ack, not-run), the layers hold ${String(failed)}`,
    );
  }
  if (counts.ran > counts.in_range) add("/counts/ran", "more layers ran than are in range");
  if (report.enforced !== (report.enforce !== "advisory")) {
    add("/enforced", "enforced is false exactly when enforce is advisory");
  }
  const empty = counts.in_range === 0;
  const clean = !empty && failed === 0 && notEvaluated === 0 && counts.ran === counts.in_range;
  if (report.enforced && report.passed !== undefined && report.passed !== clean) {
    add(
      "/passed",
      clean
        ? "no layer failed and every layer in range ran, so the run passed"
        : empty
          ? "no layer was in range, so the run did not pass: an empty run is not a pass"
          : "a layer failed or was not evaluated, or fewer layers ran than are in range, so the run did not pass",
    );
  }
  return problems;
}

/**
 * Validates a gate report against `schema/gate-report.schema.json`, then checks what a schema
 * cannot: unique layers, the `failed` and `not_evaluated` counts equal to the layers that hold
 * them, and `passed` agreeing with the counts. `not-evaluated` never yields a pass, and a run
 * with no layer in range is not a pass either (section 3.4, rule 5).
 */
export function validateReport(report: unknown): Validated<GateReport> {
  if (!validate(report)) return { ok: false, problems: toProblems(validate.errors, describe) };
  const problems = consistency(report);
  return problems.length === 0 ? { ok: true, value: report } : { ok: false, problems };
}
