import type * as tsApi from "typescript";
import type { Ts } from "../complexity/index.ts";

/**
 * What a source file calls an axe builder (WEB_TOPS.md section 6.7). The builder class comes from the file's own
 * import or require of an `@axe-core/` package, under whatever local name it gives it; a variable, a parameter
 * typed as the class, an assignment, or a function of the file that returns one holds a builder. The names are
 * collected for the whole file, not per scope: a name is a builder wherever it is written in the file.
 */
export interface Scope {
  /** What the file has been found to hold, one `kind:name` fact each (see `Kind`). It only ever grows. */
  readonly facts: Set<string>;
}

/**
 * `class`: a local name bound to the builder class (`AxeBuilder`, a renamed default import, `{ default: B }`).
 * `namespace`: a local name bound to a whole axe module, so `ns.default` and `ns.AxeBuilder` are the class.
 * `builder`: a variable or parameter that holds a builder. `maker`: a function of the file that returns one.
 */
type Kind = "class" | "namespace" | "builder" | "maker";

const factOf = (kind: Kind, name: string): string => `${kind}:${name}`;

const has = (scope: Scope, kind: Kind, name: string): boolean =>
  scope.facts.has(factOf(kind, name));

const learn = (scope: Scope, kind: Kind, name: string): void => {
  scope.facts.add(factOf(kind, name));
};

/** What an axe package exports the builder as: its default, `AxeBuilder`, or `AxePuppeteer`. */
const EXPORTS: ReadonlySet<string> = new Set(["default", "AxeBuilder", "AxePuppeteer"]);

const isAxeModule = (name: string): boolean => name.startsWith("@axe-core/");

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
export function unwrap(ts: Ts, node: tsApi.Node): tsApi.Node {
  let inner = node;
  while (isWrapper(ts, inner)) inner = inner.expression;
  return inner;
}

/** The expression a call or a member access is made on, or undefined for anything else. */
const receiverOf = (ts: Ts, node: tsApi.Node): tsApi.Node | undefined =>
  ts.isCallExpression(node) || ts.isPropertyAccessExpression(node) ? node.expression : undefined;

const isClassName = (ts: Ts, node: tsApi.Node, scope: Scope): boolean =>
  ts.isIdentifier(node) && (node.text === "AxeBuilder" || has(scope, "class", node.text));

const isModuleHolder = (ts: Ts, node: tsApi.Node, scope: Scope): boolean =>
  ts.isIdentifier(node) && has(scope, "namespace", node.text);

/** `ns.default` and `ns.AxeBuilder` for an axe module bound to `ns`; any `.AxeBuilder` is the class by its name. */
function isClassMember(ts: Ts, node: tsApi.Node, scope: Scope): boolean {
  if (!ts.isPropertyAccessExpression(node)) return false;
  return (
    node.name.text === "AxeBuilder" ||
    (EXPORTS.has(node.name.text) && isModuleHolder(ts, node.expression, scope))
  );
}

const isClass = (ts: Ts, node: tsApi.Node, scope: Scope): boolean =>
  isClassName(ts, node, scope) || isClassMember(ts, node, scope);

function isMakerCall(ts: Ts, node: tsApi.Node, scope: Scope): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = unwrap(ts, node.expression);
  return ts.isIdentifier(callee) && has(scope, "maker", callee.text);
}

/** Whether an expression is itself a builder: a `new` of the class, a variable that holds one, a call of a maker. */
function isBuilder(ts: Ts, node: tsApi.Node, scope: Scope): boolean {
  if (ts.isNewExpression(node)) return isClass(ts, node.expression, scope);
  if (ts.isIdentifier(node)) return has(scope, "builder", node.text);
  return isMakerCall(ts, node, scope);
}

/** True when a chain of calls and member accesses starts at a builder (`new AxeBuilder(...)`, a variable, a maker's call). */
export function startsAtBuilder(ts: Ts, node: tsApi.Node, scope: Scope): boolean {
  const inner = unwrap(ts, node);
  if (isBuilder(ts, inner, scope)) return true;
  const next = receiverOf(ts, inner);
  return next !== undefined && startsAtBuilder(ts, next, scope);
}

const isTypeName = (ts: Ts, name: tsApi.EntityName, scope: Scope): boolean =>
  ts.isIdentifier(name)
    ? name.text === "AxeBuilder" || has(scope, "class", name.text)
    : EXPORTS.has(name.right.text);

/** A type annotation that names the builder class: `AxeBuilder`, a renamed import, or `ns.AxeBuilder`. */
const isBuilderType = (ts: Ts, type: tsApi.TypeNode | undefined, scope: Scope): boolean =>
  type !== undefined && ts.isTypeReferenceNode(type) && isTypeName(ts, type.typeName, scope);

/** The import clause of an import of an axe package, or undefined for any other statement. */
function axeClause(ts: Ts, node: tsApi.Node): tsApi.ImportClause | undefined {
  if (!ts.isImportDeclaration(node) || !ts.isStringLiteralLike(node.moduleSpecifier))
    return undefined;
  return isAxeModule(node.moduleSpecifier.text) ? node.importClause : undefined;
}

function learnSpecifier(element: tsApi.ImportSpecifier, scope: Scope): void {
  if (EXPORTS.has((element.propertyName ?? element.name).text))
    learn(scope, "class", element.name.text);
}

function learnBindings(ts: Ts, named: tsApi.NamedImportBindings | undefined, scope: Scope): void {
  if (named === undefined) return;
  if (ts.isNamespaceImport(named)) {
    learn(scope, "namespace", named.name.text);
    return;
  }
  for (const element of named.elements) learnSpecifier(element, scope);
}

/** `import X from "@axe-core/x"`, `import { AxeBuilder as X }`, `import * as ns`: the names the file gives the package. */
function learnImport(ts: Ts, node: tsApi.Node, scope: Scope): void {
  const clause = axeClause(ts, node);
  if (clause === undefined) return;
  if (clause.name !== undefined) learn(scope, "class", clause.name.text);
  learnBindings(ts, clause.namedBindings, scope);
}

const isLoader = (ts: Ts, callee: tsApi.Node): boolean =>
  (ts.isIdentifier(callee) && callee.text === "require") ||
  callee.kind === ts.SyntaxKind.ImportKeyword;

const isAxeSpecifier = (ts: Ts, node: tsApi.Node | undefined): boolean =>
  node !== undefined && ts.isStringLiteralLike(node) && isAxeModule(node.text);

/** The call under any `await` and parentheses, or undefined. */
function callOf(ts: Ts, node: tsApi.Node): tsApi.CallExpression | undefined {
  const inner = unwrap(ts, node);
  const call = ts.isAwaitExpression(inner) ? unwrap(ts, inner.expression) : inner;
  return ts.isCallExpression(call) ? call : undefined;
}

/** `require("@axe-core/x")` or `import("@axe-core/x")`, awaited or not. */
function loadsAxe(ts: Ts, node: tsApi.Node): boolean {
  const call = callOf(ts, node);
  if (call === undefined || !isLoader(ts, call.expression)) return false;
  return isAxeSpecifier(ts, call.arguments[0]);
}

/** `require("@axe-core/x").default`: the class itself. */
const loadsAxeClass = (ts: Ts, node: tsApi.Node): boolean => {
  const inner = unwrap(ts, node);
  return (
    ts.isPropertyAccessExpression(inner) &&
    EXPORTS.has(inner.name.text) &&
    loadsAxe(ts, inner.expression)
  );
};

const exportedName = (ts: Ts, element: tsApi.BindingElement): string | undefined => {
  const imported = element.propertyName ?? element.name;
  return ts.isIdentifier(imported) ? imported.text : undefined;
};

/** One name of an object pattern: `{ AxeBuilder }`, `{ AxeBuilder: B }`, `{ default: B }`. */
function learnElement(ts: Ts, element: tsApi.BindingElement, scope: Scope): void {
  const imported = exportedName(ts, element);
  if (ts.isIdentifier(element.name) && imported !== undefined && EXPORTS.has(imported)) {
    learn(scope, "class", element.name.text);
  }
}

/** What `const x = require("@axe-core/x")` and its destructured forms bind. */
function bindLoaded(ts: Ts, name: tsApi.BindingName, scope: Scope): void {
  if (ts.isIdentifier(name)) {
    learn(scope, "namespace", name.text);
    return;
  }
  if (ts.isObjectBindingPattern(name))
    for (const element of name.elements) learnElement(ts, element, scope);
}

/** `const B = require("@axe-core/x").default`: the name is the class. */
function bindClass(ts: Ts, name: tsApi.BindingName, init: tsApi.Node, scope: Scope): void {
  if (loadsAxeClass(ts, init) && ts.isIdentifier(name)) learn(scope, "class", name.text);
}

function learnLoad(ts: Ts, node: tsApi.Node, scope: Scope): void {
  if (!ts.isVariableDeclaration(node) || node.initializer === undefined) return;
  bindClass(ts, node.name, node.initializer, scope);
  if (loadsAxe(ts, node.initializer)) bindLoaded(ts, node.name, scope);
}

/** A variable given a builder, or typed as one. */
const holdsBuilder = (ts: Ts, node: tsApi.VariableDeclaration, scope: Scope): boolean =>
  (node.initializer !== undefined && startsAtBuilder(ts, node.initializer, scope)) ||
  isBuilderType(ts, node.type, scope);

function learnVariable(ts: Ts, node: tsApi.Node, scope: Scope): void {
  if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return;
  if (holdsBuilder(ts, node, scope)) learn(scope, "builder", node.name.text);
}

/** A parameter typed as the builder class. */
function learnParameter(ts: Ts, node: tsApi.Node, scope: Scope): void {
  if (!ts.isParameter(node) || !ts.isIdentifier(node.name)) return;
  if (isBuilderType(ts, node.type, scope)) learn(scope, "builder", node.name.text);
}

const isPlainAssignment = (ts: Ts, node: tsApi.Node): node is tsApi.BinaryExpression =>
  ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken;

/** `b = new AxeBuilder(...)` after `let b`. */
function learnAssignment(ts: Ts, node: tsApi.Node, scope: Scope): void {
  if (!isPlainAssignment(ts, node) || !ts.isIdentifier(node.left)) return;
  if (startsAtBuilder(ts, node.right, scope)) learn(scope, "builder", node.left.text);
}

/** Whether one `return` statement hands back a builder: `return;` and `return value` of anything else do not. */
const returnedBuilder = (ts: Ts, node: tsApi.ReturnStatement, scope: Scope): boolean =>
  node.expression !== undefined && startsAtBuilder(ts, node.expression, scope);

/** Whether a return statement under the node, not inside a nested function, returns a builder. */
function returnsBuilder(ts: Ts, node: tsApi.Node, scope: Scope): boolean {
  if (ts.isReturnStatement(node)) return returnedBuilder(ts, node, scope);
  return (
    !ts.isFunctionLike(node) &&
    ts.forEachChild(node, (child) => returnsBuilder(ts, child, scope) || undefined) === true
  );
}

type Maker = tsApi.FunctionDeclaration | tsApi.ArrowFunction | tsApi.FunctionExpression;

/** A function whose body is a builder, or has a `return` of one. */
function makesBuilder(ts: Ts, fn: Maker, scope: Scope): boolean {
  const body = fn.body;
  if (body === undefined) return false;
  return ts.isBlock(body) ? returnsBuilder(ts, body, scope) : startsAtBuilder(ts, body, scope);
}

const functionOf = (ts: Ts, node: tsApi.Node | undefined): Maker | undefined =>
  node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
    ? node
    : undefined;

interface Binding {
  readonly name: string;
  readonly fn: Maker;
}

/** `const make = () => ...` or `const make = function () {...}`. */
function valueBinding(ts: Ts, node: tsApi.Node): Binding | undefined {
  if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return undefined;
  const fn = functionOf(ts, node.initializer);
  return fn === undefined ? undefined : { name: node.name.text, fn };
}

/** A named function of the file: a declaration, or a variable that holds a function. */
function functionBinding(ts: Ts, node: tsApi.Node): Binding | undefined {
  if (ts.isFunctionDeclaration(node))
    return node.name === undefined ? undefined : { name: node.name.text, fn: node };
  return valueBinding(ts, node);
}

/** `function make() { return new AxeBuilder(...) }` and `const make = () => new AxeBuilder(...)`. */
function learnMaker(ts: Ts, node: tsApi.Node, scope: Scope): void {
  const bound = functionBinding(ts, node);
  if (bound !== undefined && makesBuilder(ts, bound.fn, scope)) learn(scope, "maker", bound.name);
}

const LEARNERS = [
  learnImport,
  learnLoad,
  learnVariable,
  learnParameter,
  learnAssignment,
  learnMaker,
];

function learnFrom(ts: Ts, root: tsApi.Node, scope: Scope): void {
  const visit = (node: tsApi.Node): void => {
    for (const learn of LEARNERS) learn(ts, node, scope);
    ts.forEachChild(node, visit);
  };
  visit(root);
}

/**
 * What the file calls a builder. Passes repeat until one learns nothing new, so a builder handed on through
 * variables and functions is found however long the chain, and whatever order the file writes it in.
 */
export function buildScope(ts: Ts, root: tsApi.Node): Scope {
  const scope: Scope = { facts: new Set() };
  let before: number;
  do {
    before = scope.facts.size;
    learnFrom(ts, root, scope);
  } while (before !== scope.facts.size);
  return scope;
}
