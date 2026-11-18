import type * as tsApi from "typescript";
import type { FunctionKind, Ts, TsNode, TsSourceFile } from "./types.ts";

/**
 * What a node is, and what it is called (WEB_TOPS.md section 6.7): which nodes are functions, the
 * name a function takes from its declaration, its method or property name, or the variable it is
 * bound to, and which nodes are containers in a key's chain.
 */

function accessorKind(ts: Ts, node: TsNode): FunctionKind | undefined {
  if (ts.isGetAccessorDeclaration(node)) return "get";
  return ts.isSetAccessorDeclaration(node) ? "set" : undefined;
}

function memberKind(ts: Ts, node: TsNode): FunctionKind | undefined {
  if (ts.isMethodDeclaration(node)) return "method";
  return ts.isConstructorDeclaration(node) ? "constructor" : accessorKind(ts, node);
}

function kindIgnoringBody(ts: Ts, node: TsNode): FunctionKind | undefined {
  if (ts.isArrowFunction(node)) return "arrow";
  if (ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) return "function";
  return memberKind(ts, node);
}

/** The function kind of a node that has a body: an overload, a `declare` function or an abstract member is not one. */
export function functionKindOf(ts: Ts, node: TsNode): FunctionKind | undefined {
  const kind = kindIgnoringBody(ts, node);
  return kind !== undefined && Reflect.get(node, "body") !== undefined ? kind : undefined;
}

const isNode = (value: unknown): value is TsNode =>
  typeof value === "object" && value !== null && typeof Reflect.get(value, "kind") === "number";

/** A property name as written: `x`, `#x`, `"x"`, `1`, or `[expr]` for a computed one. */
function propertyText(ts: Ts, sf: TsSourceFile, name: unknown): string | undefined {
  if (!isNode(name)) return undefined;
  if (ts.isComputedPropertyName(name)) return `[${name.expression.getText(sf)}]`;
  const text: unknown = Reflect.get(name, "text");
  return typeof text === "string" ? text : undefined;
}

function isWrapper(ts: Ts, node: TsNode): boolean {
  const { SyntaxKind } = ts;
  return [
    SyntaxKind.ParenthesizedExpression,
    SyntaxKind.AsExpression,
    SyntaxKind.SatisfiesExpression,
    SyntaxKind.NonNullExpression,
    SyntaxKind.TypeAssertionExpression,
  ].includes(node.kind);
}

/** The first ancestor of a function that is not a parenthesis, `as`, `satisfies`, `!` or `<T>` around it. */
function holderOf(ts: Ts, node: TsNode): TsNode {
  let holder = node.parent;
  while (isWrapper(ts, holder)) holder = holder.parent;
  return holder;
}

function assignedName(ts: Ts, assignment: tsApi.BinaryExpression): string | undefined {
  if (assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return undefined;
  const target = assignment.left;
  if (ts.isIdentifier(target)) return target.text;
  return ts.isPropertyAccessExpression(target) ? target.name.text : undefined;
}

/** The nodes a function can be bound to by name: `const f =`, `{ f: }` and a class field. */
const isNamingHolder = (ts: Ts, holder: TsNode): boolean =>
  [
    ts.SyntaxKind.VariableDeclaration,
    ts.SyntaxKind.PropertyAssignment,
    ts.SyntaxKind.PropertyDeclaration,
  ].includes(holder.kind);

/** The name an anonymous function is bound to: `const f =`, `{ f: }`, a class field, `a.f =`, `f =`. */
function boundName(ts: Ts, sf: TsSourceFile, node: TsNode): string | undefined {
  const holder = holderOf(ts, node);
  if (isNamingHolder(ts, holder)) return propertyText(ts, sf, Reflect.get(holder, "name"));
  return ts.isBinaryExpression(holder) ? assignedName(ts, holder) : undefined;
}

const withAccessor = (kind: FunctionKind, declared: string): string =>
  kind === "get" || kind === "set" ? `${kind} ${declared}` : declared;

/** A function's own name, or undefined when it is anonymous. A getter and a setter are `get x` and `set x`. */
export function functionName(
  ts: Ts,
  sf: TsSourceFile,
  node: TsNode,
  kind: FunctionKind,
): string | undefined {
  if (kind === "constructor") return "constructor";
  const declared = propertyText(ts, sf, Reflect.get(node, "name"));
  return declared === undefined ? boundName(ts, sf, node) : withAccessor(kind, declared);
}

/** True for the functions CRAP scores whatever they sit in: class methods, accessors, constructors, and function-valued fields. */
export function isClassMember(ts: Ts, node: TsNode, kind: FunctionKind): boolean {
  if (kind !== "arrow" && kind !== "function") return ts.isClassLike(node.parent);
  const holder = holderOf(ts, node);
  return ts.isPropertyDeclaration(holder) && ts.isClassLike(holder.parent);
}

/** A class or namespace in a key's chain; `name` is undefined for an anonymous class. */
export interface Container {
  readonly name: string | undefined;
}

function classContainer(ts: Ts, sf: TsSourceFile, node: TsNode): Container {
  return { name: propertyText(ts, sf, Reflect.get(node, "name")) ?? boundName(ts, sf, node) };
}

export function containerOf(ts: Ts, sf: TsSourceFile, node: TsNode): Container | undefined {
  if (ts.isClassLike(node)) return classContainer(ts, sf, node);
  return ts.isModuleDeclaration(node) ? { name: propertyText(ts, sf, node.name) } : undefined;
}
