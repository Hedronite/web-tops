/**
 * The law probe (WEB_TOPS.md section 8.1): every delegated rule is proven to fire. Each law has a bad twin that
 * breaks it on purpose, a clean twin that does not, and `// expect: <rule>` markers on the lines the bad twin breaks.
 */

/**
 * One law as the probe needs it: its id, and what its twins must prove. A proof is a tool rule name
 * (`no-explicit-any`, matched against the rule id the tool reports, with or without its plugin prefix) or a compiler
 * flag (`erasableSyntaxOnly`, matched against the diagnostic codes that flag raises).
 */
export interface ProbeLaw {
  readonly id: string;
  readonly proofs: readonly string[];
  /** The classes that map the law (WEB_TOPS.md section 5.2); absent for a law every class maps. */
  readonly classes?: readonly string[];
}

/** Where the laws come from. `laws/W-NN.yaml` is the source once it lands; until then, the interim table. */
export type LawSource = () => readonly ProbeLaw[];

export type TwinKind = "bad" | "clean";

/** One file of a twin: `file` is relative to the fixtures root, with `/` separators (`W-01/bad/explicit.ts`). */
export interface Twin {
  readonly law: string;
  readonly kind: TwinKind;
  readonly file: string;
}

/** A line of a twin that must report these rule ids. */
export interface Expectation {
  readonly file: string;
  readonly line: number;
  readonly rules: readonly string[];
}

/** One finding of a tool on a twin: the id is a rule id for ESLint and `TS<code>` for the compiler. */
export interface Observed {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
}

export const FAILURE_KINDS = [
  "no-bad-twin",
  "no-clean-twin",
  "no-marker",
  "marker-in-clean",
  "silent",
  "unexpected",
  "noisy",
  "unproven",
] as const;

export type FailureKind = (typeof FAILURE_KINDS)[number];

/** Why a law's probe failed: `message` is the whole sentence, the other fields place it. */
export interface ProbeFailure {
  readonly kind: FailureKind;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly rule?: string;
}

export interface LawProbe {
  readonly id: string;
  readonly verdict: "pass" | "fail";
  readonly failures: readonly ProbeFailure[];
  /** Findings on this law's twins that none of its proofs explain and no marker names: they never fail the law. */
  readonly unrelated: readonly Observed[];
}

export interface ProbeReport {
  readonly laws: readonly LawProbe[];
}
