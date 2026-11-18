import ts from "typescript";
import type { FunctionSpan } from "./types.ts";

type FunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

type Binding = ts.VariableDeclaration | ts.PropertyAssignment | ts.PropertyDeclaration;

interface Scope {
  /** The dotted container chain so far, with a trailing dot: `outer.` or `C.`. */
  readonly path: string;
  /** The key of the nearest enclosing function, or the module's. */
  readonly parentKey: string;
}

interface Walk {
  readonly file: string;
  readonly source: ts.SourceFile;
  readonly spans: FunctionSpan[];
  readonly anonymous: Map<string, number>;
}

const FUNCTION_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
]);

/** A function with a body: overloads and abstract members are not functions of their own. */
function isFunctionNode(node: ts.Node): node is FunctionNode {
  return FUNCTION_KINDS.has(node.kind) && Reflect.get(node, "body") !== undefined;
}

function isBinding(node: ts.Node): node is Binding {
  return (
    ts.isVariableDeclaration(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isPropertyDeclaration(node)
  );
}

function boundName(node: ts.Node): string | undefined {
  const parent = node.parent;
  return isBinding(parent) && parent.initializer === node ? parent.name.getText() : undefined;
}

function declaredName(node: FunctionNode): string | undefined {
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isArrowFunction(node)) return undefined;
  return node.name === undefined ? undefined : node.name.getText();
}

function containerName(node: ts.Node): string | undefined {
  if (ts.isClassLike(node)) return node.name?.getText();
  return ts.isModuleDeclaration(node) ? node.name.getText() : undefined;
}

function lineOf(source: ts.SourceFile, position: number): number {
  return source.getLineAndCharacterOfPosition(position).line + 1;
}

function anonymousKey(walk: Walk, scope: Scope): string {
  const order = (walk.anonymous.get(scope.parentKey) ?? 0) + 1;
  walk.anonymous.set(scope.parentKey, order);
  return `${scope.parentKey}#${String(order)}`;
}

function openFunction(walk: Walk, node: FunctionNode, scope: Scope): Scope {
  const name = declaredName(node) ?? boundName(node);
  const key = name === undefined ? anonymousKey(walk, scope) : `${walk.file}::${scope.path}${name}`;
  const start = lineOf(walk.source, node.getStart(walk.source));
  walk.spans.push({ key, start, end: lineOf(walk.source, node.getEnd()) });
  return { path: `${key.slice(walk.file.length + 2)}.`, parentKey: key };
}

function enter(walk: Walk, node: ts.Node, scope: Scope): Scope {
  const container = containerName(node);
  if (container !== undefined) return { ...scope, path: `${scope.path}${container}.` };
  return isFunctionNode(node) ? openFunction(walk, node, scope) : scope;
}

function visit(walk: Walk, node: ts.Node, scope: Scope): void {
  const next = enter(walk, node, scope);
  ts.forEachChild(node, (child) => {
    visit(walk, child, next);
  });
}

function kindOf(file: string): ts.ScriptKind {
  return file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/**
 * Every function of a file, keyed by file, container chain and name (WEB_TOPS.md section 6.7), with its
 * inclusive line range, in source order. The first entry is the file's `<module>` pseudo-function.
 */
export function functionsIn(file: string, text: string): readonly FunctionSpan[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2023, true, kindOf(file));
  const module = `${file}::<module>`;
  const last = text.replace(/\n$/, "").split("\n").length;
  const walk: Walk = {
    file,
    source,
    spans: [{ key: module, start: 1, end: last }],
    anonymous: new Map(),
  };
  visit(walk, source, { path: "", parentKey: module });
  return walk.spans;
}

const sizeOf = (span: FunctionSpan): number => span.end - span.start;

/** The smallest span that holds `line`, or undefined when none does. */
export function innermostAt(
  spans: readonly FunctionSpan[],
  line: number,
): FunctionSpan | undefined {
  const holding = spans.filter((span) => span.start <= line && line <= span.end);
  return holding.reduce<FunctionSpan | undefined>(
    (best, span) => (best === undefined || sizeOf(span) <= sizeOf(best) ? span : best),
    undefined,
  );
}
