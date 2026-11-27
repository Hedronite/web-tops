import type { EslintRead } from "../../census/eslint.ts";
import type { LayerContext } from "../../gate/types.ts";
import type { RawFinding } from "../../report/findings.ts";
import type { Verdict } from "../../report/types.ts";

/** A tool rule or compiler flag a law maps (`laws/W-NN.yaml`, WEB_TOPS.md section 8.3). */
export interface LawRule {
  readonly tool: string;
  readonly name: string;
  /** The classes the rule holds for, a subset of the law's: absent, it holds for every class the law maps. */
  readonly classes?: readonly string[];
}

/**
 * What the layer reads of a law: the catalog's record (G1) as the layer takes it. `classes` is empty for a law every
 * class maps. A law is `judged` when section 8.2 ticks it, or a later milestone gave it a reader.
 */
export interface LawEntry {
  readonly id: string;
  /** `R`: a break is `refuse`. `A`: a break needs an acknowledgement (`ack-missing`). */
  readonly severity: "R" | "A";
  /** `tl` a tool, `an` an analyzer, `at` attested, `tbd` not built (section 8.1). */
  readonly reader: "tl" | "an" | "at" | "tbd";
  readonly classes: readonly string[];
  readonly judged: boolean;
  readonly rules: readonly LawRule[];
}

/** What one reader says about one law: its verdict, the evidence for it, and why when it could not judge. */
export interface LawReading {
  readonly law: string;
  readonly verdict: Verdict;
  readonly reason?: string;
  /** One finding for each place that breaks the law (a config line, a file); the layer adds the law's own. */
  readonly findings: readonly RawFinding[];
  /** What the reader looked at, for the law's one line: `3 rules, 120 files`. */
  readonly note?: string;
}

/** What a reader is given: the run, the laws it reads, and the tracked files. */
export interface ReadInput {
  readonly ctx: LayerContext;
  readonly laws: readonly LawEntry[];
  readonly tracked: readonly string[];
  /** What the project's own ESLint says of each tracked TypeScript file; asked once, the first time a reader needs it. */
  readonly eslint: () => Promise<EslintRead>;
  /** The ratchet holds finding counts, so a count above zero is the ratchet's to refuse (section 6.7). */
  readonly held: boolean;
}

/** A reader judges the laws that map a tool's rules; it never runs the tool's lint again (section 3.1). */
export type LawReader = (input: ReadInput) => Promise<readonly LawReading[]>;
