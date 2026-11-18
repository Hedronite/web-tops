import { containerOf, functionKindOf, functionName, isClassMember } from "./names.ts";
import type { FunctionKind, Span, Ts, TsNode, TsSourceFile } from "./types.ts";
import type { Weights } from "./weights.ts";

/** One function while the file is being walked; `own` and `score` are filled in as the walk goes. */
export interface Builder {
  readonly kind: FunctionKind;
  readonly chain: readonly string[];
  readonly ordinal: number | undefined;
  readonly scored: boolean;
  readonly span: Span;
  /** The function this one folds into; undefined for a scored unit and for `<module>`. */
  readonly parent: Builder | undefined;
  own: number;
  score: number;
}

/** What is shared by every part of one file: the builders in source order and the counters that name them. */
export interface FileState {
  readonly builders: Builder[];
  readonly anonymous: Map<string, number>;
  readonly seen: Map<string, number>;
}

export interface Env {
  readonly ts: Ts;
  readonly sf: TsSourceFile;
  readonly weights: Weights;
  readonly state: FileState;
  /** True for an Astro template: its arrows fold into `<module>` instead of being functions. */
  readonly template: boolean;
}

/** Where the walk is: the function that counts what it meets, and the container chain of keys. */
export interface Scope {
  readonly fn: Builder;
  readonly chain: readonly string[];
}

interface Child {
  readonly chain: readonly string[];
  readonly ordinal: number | undefined;
}

export const newState = (module: Builder): FileState => ({
  builders: [module],
  anonymous: new Map(),
  seen: new Map(),
});

function namedChild(state: FileState, parent: readonly string[], name: string): Child {
  const base = [...parent, name].join(".");
  const times = (state.seen.get(base) ?? 0) + 1;
  state.seen.set(base, times);
  return {
    chain: [...parent, times === 1 ? name : `${name}#${String(times)}`],
    ordinal: undefined,
  };
}

function anonymousChild(state: FileState, parent: readonly string[]): Child {
  const parentKey = parent.join(".");
  const ordinal = (state.anonymous.get(parentKey) ?? 0) + 1;
  state.anonymous.set(parentKey, ordinal);
  const last = parent.at(-1) ?? "<module>";
  return { chain: [...parent.slice(0, -1), `${last}~${String(ordinal)}`], ordinal };
}

/** A named thing keeps its name (a repeat gets `#n`); an anonymous one takes its parent's key plus `~n`. */
const childOf = (state: FileState, parent: readonly string[], name: string | undefined): Child =>
  name === undefined ? anonymousChild(state, parent) : namedChild(state, parent, name);

function spanOf(sf: TsSourceFile, node: TsNode): Span {
  const start = node.getStart(sf);
  const end = node.getEnd();
  return {
    start,
    end,
    startLine: sf.getLineAndCharacterOfPosition(start).line + 1,
    endLine: sf.getLineAndCharacterOfPosition(end).line + 1,
  };
}

function enterFunction(env: Env, node: TsNode, scope: Scope, kind: FunctionKind): Scope {
  const child = childOf(env.state, scope.chain, functionName(env.ts, env.sf, node, kind));
  const scored = scope.fn.kind === "module" || isClassMember(env.ts, node, kind);
  const builder: Builder = {
    kind,
    chain: child.chain,
    ordinal: child.ordinal,
    scored,
    span: spanOf(env.sf, node),
    parent: scored ? undefined : scope.fn,
    own: 1,
    score: 1,
  };
  env.state.builders.push(builder);
  return { fn: builder, chain: child.chain };
}

function enter(env: Env, node: TsNode, scope: Scope): Scope {
  if (env.template) return scope;
  const kind = functionKindOf(env.ts, node);
  if (kind !== undefined) return enterFunction(env, node, scope, kind);
  const container = containerOf(env.ts, env.sf, node);
  if (container === undefined) return scope;
  return { fn: scope.fn, chain: childOf(env.state, scope.chain, container.name).chain };
}

function isOptionalLink(ts: Ts, node: TsNode): boolean {
  if (
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node) ||
    ts.isCallExpression(node)
  ) {
    return node.questionDotToken !== undefined;
  }
  return false;
}

function operatorWeight(env: Env, node: TsNode): number {
  if (!env.ts.isBinaryExpression(node)) return 0;
  return env.weights.operators.get(node.operatorToken.kind) ?? 0;
}

const chainWeight = (env: Env, node: TsNode): number =>
  isOptionalLink(env.ts, node) ? env.weights.chain : 0;

/** What one node adds: its kind's weight, a binary operator's, and one for a `?.` link. */
export const weightOf = (env: Env, node: TsNode): number =>
  (env.weights.kinds.get(node.kind) ?? 0) + operatorWeight(env, node) + chainWeight(env, node);

/** Types and interfaces hold no executable code; a heritage clause's expression does. */
function skipped(ts: Ts, node: TsNode): boolean {
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return true;
  return ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node);
}

/** Counts every branch under `node` into the function it is written in, and opens a builder for each function. */
export function visit(env: Env, node: TsNode, scope: Scope): void {
  if (skipped(env.ts, node)) return;
  scope.fn.own += weightOf(env, node);
  const next = enter(env, node, scope);
  env.ts.forEachChild(node, (child) => {
    visit(env, child, next);
  });
}

/** Adds each folded function's branches (its `own` less the base 1) to the function it folds into, inside out. */
export function fold(builders: readonly Builder[]): void {
  for (const builder of builders) builder.score = builder.own;
  for (const builder of builders.toReversed()) {
    if (builder.parent !== undefined) builder.parent.score += builder.score - 1;
  }
}
