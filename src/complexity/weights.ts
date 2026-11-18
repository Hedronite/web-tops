import type { Ts } from "./types.ts";
import { ComplexityError } from "./types.ts";

/**
 * Every SyntaxKind the counter decides on, by name (WEB_TOPS.md section 6.3). A kind is looked up in
 * the TypeScript passed in, so a TypeScript that lacks one fails loudly instead of counting less.
 */

/** +1 each: `if`, `?:`, each non-`default` `case`, `for`, `for...in`, `for...of`, `while`, `do`, `catch`. */
export const COUNTED_KINDS = [
  "IfStatement",
  "ConditionalExpression",
  "CaseClause",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoStatement",
  "CatchClause",
] as const;

/** +1 each: `&&`, `||`, `&&=`, `||=`. */
export const COUNTED_OPERATORS = [
  "AmpersandAmpersandToken",
  "BarBarToken",
  "AmpersandAmpersandEqualsToken",
  "BarBarEqualsToken",
] as const;

/** Weight 0 under `nullish_discount` (the default), +1 each without it: `??` and `??=`; `?.` is separate. */
export const NULLISH_OPERATORS = ["QuestionQuestionToken", "QuestionQuestionEqualsToken"] as const;

/**
 * The statement, clause and expression kinds the spec decides do not count. With COUNTED_KINDS this
 * is every TypeScript kind ending in Statement, Clause or Expression, so a TypeScript that adds a
 * branching kind fails the construct guard until someone decides it.
 */
export const NOT_COUNTED_KINDS = [
  "ArrayLiteralExpression",
  "ObjectLiteralExpression",
  "PropertyAccessExpression",
  "ElementAccessExpression",
  "CallExpression",
  "NewExpression",
  "TaggedTemplateExpression",
  "TypeAssertionExpression",
  "ParenthesizedExpression",
  "FunctionExpression",
  "DeleteExpression",
  "TypeOfExpression",
  "VoidExpression",
  "AwaitExpression",
  "PrefixUnaryExpression",
  "PostfixUnaryExpression",
  "BinaryExpression",
  "TemplateExpression",
  "YieldExpression",
  "ClassExpression",
  "OmittedExpression",
  "AsExpression",
  "NonNullExpression",
  "SyntheticExpression",
  "SatisfiesExpression",
  "EmptyStatement",
  "VariableStatement",
  "ExpressionStatement",
  "ContinueStatement",
  "BreakStatement",
  "ReturnStatement",
  "WithStatement",
  "SwitchStatement",
  "LabeledStatement",
  "ThrowStatement",
  "TryStatement",
  "DebuggerStatement",
  "ImportClause",
  "JsxExpression",
  "DefaultClause",
  "HeritageClause",
  "AssertClause",
  "JSDocTypeExpression",
  "NotEmittedStatement",
  "PartiallyEmittedExpression",
  "CommaListExpression",
  "SyntheticReferenceExpression",
] as const;

/** Binary-operator range kinds that do not branch: arithmetic, comparison, bitwise, assignment, punctuation. */
export const NOT_COUNTED_OPERATORS = [
  "LessThanToken",
  "LessThanSlashToken",
  "GreaterThanToken",
  "LessThanEqualsToken",
  "GreaterThanEqualsToken",
  "EqualsEqualsToken",
  "ExclamationEqualsToken",
  "EqualsEqualsEqualsToken",
  "ExclamationEqualsEqualsToken",
  "EqualsGreaterThanToken",
  "PlusToken",
  "MinusToken",
  "AsteriskToken",
  "AsteriskAsteriskToken",
  "SlashToken",
  "PercentToken",
  "PlusPlusToken",
  "MinusMinusToken",
  "LessThanLessThanToken",
  "GreaterThanGreaterThanToken",
  "GreaterThanGreaterThanGreaterThanToken",
  "AmpersandToken",
  "BarToken",
  "CaretToken",
  "ExclamationToken",
  "TildeToken",
  "QuestionToken",
  "ColonToken",
  "AtToken",
  "BacktickToken",
  "HashToken",
  "EqualsToken",
  "PlusEqualsToken",
  "MinusEqualsToken",
  "AsteriskEqualsToken",
  "AsteriskAsteriskEqualsToken",
  "SlashEqualsToken",
  "PercentEqualsToken",
  "LessThanLessThanEqualsToken",
  "GreaterThanGreaterThanEqualsToken",
  "GreaterThanGreaterThanGreaterThanEqualsToken",
  "AmpersandEqualsToken",
  "BarEqualsToken",
  "CaretEqualsToken",
] as const;

/** What a node contributes: its kind's weight, an operator's weight, and `?.` as its own. */
export interface Weights {
  readonly kinds: ReadonlyMap<number, number>;
  readonly operators: ReadonlyMap<number, number>;
  /** The weight of one `?.`. */
  readonly chain: number;
}

function kindNumber(ts: Ts, name: string): number {
  const value: unknown = Reflect.get(ts.SyntaxKind, name);
  if (typeof value === "number") return value;
  throw new ComplexityError(
    `the TypeScript passed in (${ts.version}) has no SyntaxKind ${name}; the counter cannot weigh it`,
    "<typescript>",
  );
}

function table(ts: Ts, names: readonly string[], weight: number): [number, number][] {
  return names.map((name) => [kindNumber(ts, name), weight]);
}

const cache = new WeakMap<object, Map<boolean, Weights>>();

function build(ts: Ts, nullishDiscount: boolean): Weights {
  const nullish = nullishDiscount ? 0 : 1;
  return {
    kinds: new Map(table(ts, COUNTED_KINDS, 1)),
    operators: new Map([
      ...table(ts, COUNTED_OPERATORS, 1),
      ...table(ts, NULLISH_OPERATORS, nullish),
    ]),
    chain: nullish,
  };
}

/** The weights for this TypeScript and nullish setting, built once per pair. */
export function weightsFor(ts: Ts, nullishDiscount: boolean): Weights {
  const byOption = cache.get(ts) ?? new Map<boolean, Weights>();
  cache.set(ts, byOption);
  const known = byOption.get(nullishDiscount);
  if (known !== undefined) return known;
  const built = build(ts, nullishDiscount);
  byOption.set(nullishDiscount, built);
  return built;
}
