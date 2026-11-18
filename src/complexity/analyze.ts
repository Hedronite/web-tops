import { extname } from "node:path";
import { astroParts } from "./astro.ts";
import type { AstroPart } from "./astro.ts";
import type {
  Analysis,
  Diagnostic,
  FunctionRecord,
  Located,
  Options,
  ScriptKind,
  Ts,
  TsDiagnostic,
  TsSourceFile,
} from "./types.ts";
import { ComplexityError } from "./types.ts";
import { newState, fold, visit } from "./walk.ts";
import type { Builder, Env, FileState } from "./walk.ts";
import { weightsFor } from "./weights.ts";

const MODULE = "<module>";

/** A fragment around a template, so several root elements parse; its length is taken off every position. */
const WRAP_OPEN = "<>";
const WRAP_CLOSE = "</>";

function scriptKinds(ts: Ts): ReadonlyMap<string, ScriptKind> {
  return new Map([
    [".ts", ts.ScriptKind.TS],
    [".mts", ts.ScriptKind.TS],
    [".cts", ts.ScriptKind.TS],
    [".tsx", ts.ScriptKind.TSX],
    [".js", ts.ScriptKind.JS],
    [".mjs", ts.ScriptKind.JS],
    [".cjs", ts.ScriptKind.JS],
    [".jsx", ts.ScriptKind.JSX],
  ]);
}

const isDiagnostic = (value: unknown): value is TsDiagnostic =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "start") === "number" &&
  Reflect.has(value, "messageText");

/** TypeScript's own syntax errors for a parsed file (`parseDiagnostics`, which the public type hides). */
function syntaxErrors(ts: Ts, sf: TsSourceFile): Diagnostic[] {
  const raw: unknown = Reflect.get(sf, "parseDiagnostics");
  if (!Array.isArray(raw)) {
    throw new ComplexityError(
      `the TypeScript passed in (${ts.version}) does not report parse errors`,
      sf.fileName,
    );
  }
  return raw.filter(isDiagnostic).map((found) => {
    const at = sf.getLineAndCharacterOfPosition(found.start ?? 0);
    const message = ts.flattenDiagnosticMessageText(found.messageText, " ");
    return { line: at.line + 1, column: at.character + 1, message };
  });
}

function parse(ts: Ts, file: string, text: string, kind: ScriptKind): TsSourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

function refuse(file: string, errors: readonly Diagnostic[]): void {
  const first = errors[0];
  if (first !== undefined) throw new ComplexityError(first.message, file, first.line, first.column);
}

/** The number of lines in a text, counting `\r\n`, `\n`, `\r`, U+2028 and U+2029 as TypeScript does. */
const LAST_BREAK = /(?:\r\n|[\n\r\u2028\u2029])$/;

const linesIn = (text: string): number => text.split(/\r\n|[\n\r\u2028\u2029]/).length;

function moduleBuilder(text: string): Builder {
  return {
    kind: "module",
    chain: [],
    ordinal: undefined,
    scored: true,
    span: {
      start: 0,
      end: text.length,
      startLine: 1,
      endLine: linesIn(text.replace(LAST_BREAK, "")),
    },
    parent: undefined,
    own: 1,
    score: 1,
  };
}

function walkCode(env: Env, file: string, module: Builder): void {
  refuse(file, syntaxErrors(env.ts, env.sf));
  visit(env, env.sf, { fn: module, chain: [] });
}

/** The template is read as JSX in a fragment; what TypeScript cannot parse is reported, not refused. */
function walkTemplate(env: Env, module: Builder): Diagnostic[] {
  visit(env, env.sf, { fn: module, chain: [] });
  return syntaxErrors(env.ts, env.sf).map((found) => ({
    ...found,
    column: found.line === 1 ? Math.max(1, found.column - WRAP_OPEN.length) : found.column,
  }));
}

interface Source {
  readonly parts: readonly AstroPart[];
  readonly kind: ScriptKind;
}

function sourceOf(ts: Ts, path: string, text: string): Source {
  const ext = extname(path).toLowerCase();
  if (ext === ".astro") return { parts: astroParts(text, path), kind: ts.ScriptKind.TS };
  const kind = scriptKinds(ts).get(ext);
  if (kind === undefined) {
    throw new ComplexityError(
      `cannot count a ${ext === "" ? "file with no extension" : `${ext} file`}`,
      path,
    );
  }
  return { parts: [{ kind: "frontmatter", text }], kind };
}

function walkPart(
  ts: Ts,
  path: string,
  part: AstroPart,
  shared: {
    readonly state: FileState;
    readonly module: Builder;
    readonly nullishDiscount: boolean;
    readonly kind: ScriptKind;
  },
): Diagnostic[] {
  const template = part.kind === "template";
  const text = template ? `${WRAP_OPEN}${part.text}${WRAP_CLOSE}` : part.text;
  const kind = template ? ts.ScriptKind.TSX : shared.kind;
  const env: Env = {
    ts,
    sf: parse(ts, path, text, kind),
    weights: weightsFor(ts, shared.nullishDiscount),
    state: shared.state,
    template,
  };
  if (template) return walkTemplate(env, shared.module);
  walkCode(env, path, shared.module);
  return [];
}

function record(path: string, builder: Builder): FunctionRecord {
  const name = builder.chain.at(-1) ?? MODULE;
  const container = builder.chain.slice(0, -1);
  return {
    key: `${path}::${builder.chain.length === 0 ? MODULE : builder.chain.join(".")}`,
    file: path,
    container,
    name,
    ordinal: builder.ordinal,
    kind: builder.kind,
    scored: builder.scored,
    own: builder.own,
    score: builder.score,
    span: builder.span,
  };
}

/**
 * Counts one file (WEB_TOPS.md section 6.3) and names each function (section 6.7). `ts` is the
 * TypeScript compiler API: the project's own pinned copy. Returns `<module>` first, then every
 * function in source order. Throws `ComplexityError` for an extension it does not know and for code
 * that does not parse; an Astro template that does not parse as JSX is reported in `diagnostics`.
 */
export function analyzeFile(
  ts: Ts,
  path: string,
  text: string,
  options: Options = { nullishDiscount: true },
): Analysis {
  const { parts, kind } = sourceOf(ts, path, text);
  const module = moduleBuilder(text);
  const shared = {
    state: newState(module),
    module,
    nullishDiscount: options.nullishDiscount,
    kind,
  };
  const diagnostics = parts.flatMap((part) => walkPart(ts, path, part, shared));
  fold(shared.state.builders);
  return {
    file: path,
    records: shared.state.builders.map((builder) => record(path, builder)),
    diagnostics,
  };
}

const lengthOf = (found: FunctionRecord): number => found.span.end - found.span.start;

function innermostOf(records: readonly FunctionRecord[]): FunctionRecord | undefined {
  return records.reduce<FunctionRecord | undefined>(
    (best, found) => (best === undefined || lengthOf(found) < lengthOf(best) ? found : best),
    undefined,
  );
}

const contains = (found: FunctionRecord, offset: number): boolean =>
  found.kind !== "module" && found.span.start <= offset && offset < found.span.end;

const keyOfInnermost = (records: readonly FunctionRecord[], fallback: string): string =>
  innermostOf(records)?.key ?? fallback;

/** Which function an offset is in: the innermost, and the scored unit it counts toward. */
export function functionAt(analysis: Analysis, offset: number): Located {
  const inside = analysis.records.filter((found) => contains(found, offset));
  const fallback = `${analysis.file}::${MODULE}`;
  return {
    innermost: keyOfInnermost(inside, fallback),
    scored: keyOfInnermost(
      inside.filter((found) => found.scored),
      fallback,
    ),
  };
}
