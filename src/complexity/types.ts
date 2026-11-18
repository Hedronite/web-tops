import type * as tsApi from "typescript";

/** The TypeScript compiler API, passed in by the caller: the project's own pinned copy (WEB_TOPS.md section 3.1). */
export type Ts = typeof tsApi;

export type TsNode = tsApi.Node;

export type TsSourceFile = tsApi.SourceFile;

export type ScriptKind = tsApi.ScriptKind;

export type TsDiagnostic = tsApi.Diagnostic;

/** What a record stands for. `module` is the pseudo-function holding the code outside every function. */
export type FunctionKind =
  "function" | "arrow" | "method" | "get" | "set" | "constructor" | "module";

export interface Span {
  readonly start: number;
  readonly end: number;
  readonly startLine: number;
  readonly endLine: number;
}

/** One function of a file, or its `<module>`; see WEB_TOPS.md sections 6.3 (counting) and 6.7 (keys). */
export interface FunctionRecord {
  /** `file::container.chain.name`; `<module>` for module code, `~n` for an anonymous function, `#n` for a duplicate. */
  readonly key: string;
  readonly file: string;
  readonly container: readonly string[];
  readonly name: string;
  /** 1-based among the parent's anonymous functions in source order; only an anonymous function has one. */
  readonly ordinal: number | undefined;
  readonly kind: FunctionKind;
  /** True for the units CRAP scores: module-level functions and class members. Every other function folds. */
  readonly scored: boolean;
  /** 1 plus the branches written directly in this function's body (nested functions excluded). */
  readonly own: number;
  /** `own` plus the branches of every function folded into this one; what CRAP reads for a scored unit. */
  readonly score: number;
  readonly span: Span;
}

/** A syntax problem the counter read around instead of refusing (an Astro template is not JSX). */
export interface Diagnostic {
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

export interface Analysis {
  readonly file: string;
  /** `<module>` first, then every function in source order. */
  readonly records: readonly FunctionRecord[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface Options {
  /** `complexity.nullish_discount`: `??`, `??=` and `?.` weigh 0 (default true) or 1. */
  readonly nullishDiscount: boolean;
}

/** The answer to "which function is this offset in". */
export interface Located {
  /** The innermost function (or `<module>`) containing the offset. */
  readonly innermost: string;
  /** The scored unit it belongs to: the innermost scored record containing the offset. */
  readonly scored: string;
}

/** The file cannot be counted: an unknown extension, code that does not parse, or a kind with no weight. */
export class ComplexityError extends Error {
  readonly file: string;
  readonly line: number | undefined;
  readonly column: number | undefined;

  constructor(message: string, file: string, line?: number, column?: number) {
    const where = line === undefined ? file : `${file}:${String(line)}:${String(column ?? 1)}`;
    super(`${where}: ${message}`);
    this.name = "ComplexityError";
    this.file = file;
    this.line = line;
    this.column = column;
  }
}
