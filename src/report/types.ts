/** The gate report written to `.web-tops/report.json` (WEB_TOPS.md section 6.6). */

export const VERDICTS = ["pass", "Refuse", "Ack", "skip", "not-run", "not-evaluated"] as const;

/** Section 3.3. */
export type Verdict = (typeof VERDICTS)[number];

export type Enforce = "hard" | "ratchet" | "advisory";

/** A layer's gate number, or the two layers that sit outside the numbered gates. */
export type GateRef = 1 | 2 | 3 | 4 | 5 | 6 | "custom" | "laws";

export interface Finding {
  readonly rule: string;
  /** `skip` marks a step a layer skipped, with the reason as the message. */
  readonly verdict: Verdict;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
}

export interface ReportLayer {
  readonly id: string;
  readonly gate: GateRef;
  readonly tier: number;
  readonly verdict: Verdict;
  readonly reason?: string;
  readonly findings: readonly Finding[];
  readonly artifacts: Readonly<Record<string, string>>;
  readonly duration_ms: number;
}

/** A run-level problem: `path` is the JSON pointer into the report it concerns. */
export interface Problem {
  readonly path: string;
  readonly message: string;
}

export interface Counts {
  /** Enabled, mapped by the class, at or below `--max-tier`, and named by `--only` when given (WEB_TOPS.md section 3.3). */
  readonly in_range: number;
  /** Layers of those whose `run` was invoked. */
  readonly ran: number;
  /** Layers whose verdict is `Refuse`, `Ack` or `not-run`; `not-evaluated` is counted on its own. */
  readonly failed: number;
  readonly not_evaluated: number;
}

export interface Report {
  readonly protocol: string;
  readonly package: string;
  readonly class: string;
  readonly enforce: Enforce;
  /** False under `advisory`: the run is reported but nothing fails. */
  readonly enforced: boolean;
  readonly base: string;
  readonly max_tier: number;
  readonly keep_going: boolean;
  /** `--only` as given, or null. */
  readonly only: readonly string[] | null;
  /** True when every layer in range ran and every verdict is `pass` or `skip`. */
  readonly passed: boolean;
  readonly exit_code: 0 | 1;
  readonly counts: Counts;
  /** Run-level problems that are not a layer's finding, such as a short layer count. */
  readonly problems: readonly Problem[];
  readonly layers: readonly ReportLayer[];
}

const FAILING: ReadonlySet<Verdict> = new Set<Verdict>([
  "Refuse",
  "Ack",
  "not-run",
  "not-evaluated",
]);

/** Section 3.3: `Refuse`, `Ack`, `not-run` and `not-evaluated` never pass. */
export function isFailing(verdict: Verdict): boolean {
  return FAILING.has(verdict);
}
