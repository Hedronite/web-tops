/** One thing an engine reported on one fixture. */
export interface Fire {
  /** The rule's name without its plugin prefix, or null for a parse or config error. */
  readonly rule: string | null;
  readonly fatal: boolean;
}

/** What one engine saw: the rules it can run and what fired on each fixture (path from w22/). */
export interface Observation {
  readonly engine: string;
  readonly version: string;
  readonly implemented: readonly string[];
  readonly deprecated: readonly string[];
  /** For each deprecated rule, the rules upstream names as its replacement. */
  readonly replaced_by: Readonly<Record<string, readonly string[]>>;
  readonly files: Readonly<Record<string, readonly Fire[]>>;
}

export type Cell = "pass" | "fail" | "not-implemented" | "error";

export interface Row {
  readonly rule: string;
  readonly deprecated: boolean;
  readonly implemented: boolean;
  readonly fires_on_bad: boolean;
  readonly quiet_on_clean: boolean;
  readonly cell: Cell;
}

/** A rule deprecated upstream: outside the bar, listed with its status and replacement. */
export interface DeprecatedNote {
  readonly rule: string;
  readonly replaced_by: readonly string[];
  readonly cells: Readonly<Record<string, Cell>>;
  readonly replacement_cells: Readonly<Record<string, Readonly<Record<string, Cell>>>>;
}
