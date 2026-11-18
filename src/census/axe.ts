import type * as tsApi from "typescript";
import { loadTypeScript } from "../complexity/index.ts";
import type { Ts } from "../complexity/index.ts";
import type { RawFinding } from "../report/findings.ts";
import { failed, passFinding } from "./finding.ts";
import { isScriptFile, readSource, withinSource } from "./files.ts";
import { KIND_MESSAGES } from "./kinds.ts";
import type { AxeKind } from "./kinds.ts";

/** One axe setting the project writes: the census kind, what is set, and where. */
export interface AxeHit {
  readonly kind: AxeKind;
  readonly line: number;
  readonly pos: number;
  /** The rule id or selector the string names. */
  readonly text: string;
}

/** A `.disableRules(...)` or `.exclude(...)` call on an AxeBuilder whose argument is not a literal string or an array of them. */
export interface AxeUnreadable {
  readonly method: string;
  readonly line: number;
}

export interface AxeReading {
  readonly hits: readonly AxeHit[];
  readonly unreadable: readonly AxeUnreadable[];
}

const METHODS: ReadonlyMap<string, AxeKind> = new Map([
  ["disableRules", "axe-disable-rules"],
  ["exclude", "axe-exclude"],
]);

type Wrapper =
  | tsApi.ParenthesizedExpression
  | tsApi.AsExpression
  | tsApi.SatisfiesExpression
  | tsApi.NonNullExpression;

const isWrapper = (ts: Ts, node: tsApi.Node): node is Wrapper =>
  ts.isParenthesizedExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isNonNullExpression(node);

/** The expression inside any parentheses, `as`, `satisfies` or `!` around it. */
function unwrap(ts: Ts, node: tsApi.Node): tsApi.Node {
  let inner = node;
  while (isWrapper(ts, inner)) inner = inner.expression;
  return inner;
}

/** `AxeBuilder`, or `something.AxeBuilder`: the class `@axe-core/playwright` exports. */
const isBuilderName = (ts: Ts, node: tsApi.Node): boolean =>
  (ts.isIdentifier(node) && node.text === "AxeBuilder") ||
  (ts.isPropertyAccessExpression(node) && node.name.text === "AxeBuilder");

/** The expression a call or a member access is made on, or undefined for anything else. */
const receiverOf = (ts: Ts, node: tsApi.Node): tsApi.Node | undefined =>
  ts.isCallExpression(node) || ts.isPropertyAccessExpression(node) ? node.expression : undefined;

/** True when a chain of calls and member accesses starts at `new AxeBuilder(...)`, or at a variable that holds one. */
function startsAtBuilder(ts: Ts, node: tsApi.Node, builders: ReadonlySet<string>): boolean {
  const inner = unwrap(ts, node);
  if (ts.isNewExpression(inner)) return isBuilderName(ts, inner.expression);
  if (ts.isIdentifier(inner)) return builders.has(inner.text);
  const next = receiverOf(ts, inner);
  return next !== undefined && startsAtBuilder(ts, next, builders);
}

const declaresBuilder = (
  ts: Ts,
  node: tsApi.Node,
  builders: ReadonlySet<string>,
): node is tsApi.VariableDeclaration =>
  ts.isVariableDeclaration(node) &&
  ts.isIdentifier(node.name) &&
  node.initializer !== undefined &&
  startsAtBuilder(ts, node.initializer, builders);

/** The names of the variables of the file that are given a builder (`const b = new AxeBuilder(...)`, or a chain from one). */
function builderNames(ts: Ts, root: tsApi.Node): Set<string> {
  const names = new Set<string>();
  const visit = (node: tsApi.Node): void => {
    if (declaresBuilder(ts, node, names)) names.add(node.name.getText());
    ts.forEachChild(node, visit);
  };
  visit(root);
  return names;
}

interface AxeCall {
  readonly method: string;
  readonly kind: AxeKind;
  readonly receiver: tsApi.Node;
  readonly call: tsApi.CallExpression;
}

/** A call of `.disableRules(...)` or `.exclude(...)` on something: whether that something is a builder is asked separately. */
function axeCallOf(ts: Ts, node: tsApi.Node): AxeCall | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression))
    return undefined;
  const method = node.expression.name.text;
  const kind = METHODS.get(method);
  return kind === undefined
    ? undefined
    : { method, kind, receiver: node.expression.expression, call: node };
}

interface Literal {
  readonly text: string;
  readonly node: tsApi.Node;
}

/** The text of a string literal, or of a template literal with no substitution. */
const textOf = (ts: Ts, node: tsApi.Node): string | undefined => {
  const inner = unwrap(ts, node);
  return ts.isStringLiteralLike(inner) ? inner.text : undefined;
};

/** The strings of a literal array, or undefined when any element is not a literal string (a spread, a name, a call). */
function elementsOf(ts: Ts, array: tsApi.ArrayLiteralExpression): Literal[] | undefined {
  const found = array.elements.flatMap((element): Literal[] => {
    const text = textOf(ts, element);
    return text === undefined ? [] : [{ text, node: element }];
  });
  return found.length === array.elements.length ? found : undefined;
}

/** The strings an argument names: one string, or the strings of a literal array; undefined for anything else. */
function literalsOf(ts: Ts, argument: tsApi.Node): Literal[] | undefined {
  const inner = unwrap(ts, argument);
  const single = textOf(ts, inner);
  if (single !== undefined) return [{ text: single, node: inner }];
  return ts.isArrayLiteralExpression(inner) ? elementsOf(ts, inner) : undefined;
}

const lineOf = (sf: tsApi.SourceFile, node: tsApi.Node): number =>
  sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

function readCall(ts: Ts, sf: tsApi.SourceFile, found: AxeCall): AxeReading {
  const argument = found.call.arguments[0];
  if (argument === undefined) return { hits: [], unreadable: [] };
  const literals = literalsOf(ts, argument);
  if (literals === undefined)
    return { hits: [], unreadable: [{ method: found.method, line: lineOf(sf, argument) }] };
  const hits = literals.map((literal): AxeHit => ({
    kind: found.kind,
    line: lineOf(sf, literal.node),
    pos: literal.node.getStart(sf),
    text: literal.text,
  }));
  return { hits, unreadable: [] };
}

/**
 * The axe settings written in one source file, by AST (WEB_TOPS.md section 6.7): each string of a literal array
 * (or a single string) passed to `.disableRules(...)` or `.exclude(...)` on a chain that starts at
 * `new AxeBuilder(...)`, or at a variable of the file that holds one. An argument that is not a literal makes
 * the call `unreadable`, never a zero. A same-named call on anything else is not an axe setting.
 */
export function readAxe(ts: Ts, file: string, text: string): AxeReading {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const builders = builderNames(ts, sf);
  const readings: AxeReading[] = [];
  const visit = (node: tsApi.Node): void => {
    const found = axeCallOf(ts, node);
    if (found !== undefined && startsAtBuilder(ts, found.receiver, builders))
      readings.push(readCall(ts, sf, found));
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return {
    hits: readings.flatMap((reading) => reading.hits).sort((a, b) => a.pos - b.pos),
    unreadable: readings.flatMap((reading) => reading.unreadable).sort((a, b) => a.line - b.line),
  };
}

const unreadableFinding = (file: string, found: AxeUnreadable): RawFinding =>
  failed(
    "census-axe-unreadable",
    `.${found.method}() on an AxeBuilder is not given a literal string or an array of literal strings, so what it sets cannot be counted`,
    { file, line: found.line },
  );

function findingsOf(ts: Ts, file: string, text: string): RawFinding[] {
  const reading = readAxe(ts, file, text);
  return [
    ...reading.hits.map((hit) =>
      passFinding(hit.kind, file, `${KIND_MESSAGES[hit.kind]} (${hit.text})`, hit.line),
    ),
    ...reading.unreadable.map((found) => unreadableFinding(file, found)),
  ];
}

/** The tracked script files that name AxeBuilder: the only ones whose syntax is worth reading. */
function mentioning(
  cwd: string,
  files: readonly string[],
): { readonly file: string; readonly text: string }[] {
  return files
    .filter((file) => isScriptFile(file) && withinSource(file))
    .flatMap((file) => {
      const text = readSource(cwd, file);
      return text?.includes("AxeBuilder") === true ? [{ file, text }] : [];
    });
}

/**
 * `axe-disable-rules` and `axe-exclude` for a project (WEB_TOPS.md section 6.7), as findings: a pass finding for
 * each rule or selector, a failing `census-axe-unreadable` finding for each call it cannot read, and one such
 * finding when the project names AxeBuilder and has no TypeScript to read it with.
 */
export function axeFindings(cwd: string, files: readonly string[]): RawFinding[] {
  const sources = mentioning(cwd, files);
  if (sources.length === 0) return [];
  try {
    const ts = loadTypeScript(cwd);
    return sources.flatMap((source) => findingsOf(ts, source.file, source.text));
  } catch (error) {
    return [
      failed("census-axe-unreadable", `AxeBuilder settings cannot be read: ${String(error)}`),
    ];
  }
}
