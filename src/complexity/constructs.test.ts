import { describe, expect, it } from "vitest";
import { ts } from "./test-support.ts";
import {
  COUNTED_KINDS,
  COUNTED_OPERATORS,
  NOT_COUNTED_KINDS,
  NOT_COUNTED_OPERATORS,
  NULLISH_OPERATORS,
  weightsFor,
} from "./weights.ts";

/** Every SyntaxKind name of this TypeScript, without the numeric reverse keys and the First/Last range markers. */
const KIND_NAMES = Object.keys(ts.SyntaxKind).filter(
  (name) => Number.isNaN(Number(name)) && !/^(First|Last)/.test(name),
);

const number = (name: string): number => {
  const value: unknown = Reflect.get(ts.SyntaxKind, name);
  if (typeof value !== "number") throw new Error(`no SyntaxKind ${name}`);
  return value;
};

describe("construct guard: a TypeScript that adds a branching kind fails here until it is decided", () => {
  const decided = new Set<string>([...COUNTED_KINDS, ...NOT_COUNTED_KINDS]);
  const operators = new Set<string>([
    ...COUNTED_OPERATORS,
    ...NULLISH_OPERATORS,
    ...NOT_COUNTED_OPERATORS,
  ]);

  it("decides every statement, clause and expression kind TypeScript has", () => {
    const undecided = KIND_NAMES.filter(
      (name) => /(Statement|Clause|Expression)$/.test(name) && !decided.has(name),
    );
    expect(undecided).toEqual([]);
  });

  it("decides every binary-operator kind TypeScript has", () => {
    const low = number("FirstBinaryOperator");
    const high = number("LastBinaryOperator");
    const undecided = KIND_NAMES.filter(
      (name) => number(name) >= low && number(name) <= high && !operators.has(name),
    );
    expect(undecided).toEqual([]);
  });

  it("lists only kinds that exist, each once, and none in two lists", () => {
    const all = [
      ...COUNTED_KINDS,
      ...NOT_COUNTED_KINDS,
      ...COUNTED_OPERATORS,
      ...NULLISH_OPERATORS,
      ...NOT_COUNTED_OPERATORS,
    ];
    expect(new Set(all).size).toBe(all.length);
    for (const name of all) expect(KIND_NAMES).toContain(name);
  });

  it("counts exactly the kinds the spec names, and no others", () => {
    expect([...COUNTED_KINDS].sort()).toEqual(
      [
        "CaseClause",
        "CatchClause",
        "ConditionalExpression",
        "DoStatement",
        "ForInStatement",
        "ForOfStatement",
        "ForStatement",
        "IfStatement",
        "WhileStatement",
      ].sort(),
    );
    expect([...COUNTED_OPERATORS].sort()).toEqual(
      [
        "AmpersandAmpersandEqualsToken",
        "AmpersandAmpersandToken",
        "BarBarEqualsToken",
        "BarBarToken",
      ].sort(),
    );
    expect([...NULLISH_OPERATORS].sort()).toEqual([
      "QuestionQuestionEqualsToken",
      "QuestionQuestionToken",
    ]);
  });

  it("never weighs `default`, `else`, `try`, `finally`, `switch` or the bitwise operators", () => {
    const { kinds, operators: weighed } = weightsFor(ts, false);
    for (const name of ["DefaultClause", "TryStatement", "SwitchStatement", "BlockStatement"]) {
      if (KIND_NAMES.includes(name)) expect(kinds.has(number(name))).toBe(false);
    }
    for (const name of ["AmpersandToken", "BarToken", "CaretToken", "ExclamationToken"]) {
      expect(weighed.has(number(name))).toBe(false);
    }
  });
});

describe("weights", () => {
  it("weigh the nullish operators 0 under the discount and 1 without it, and the rest 1", () => {
    const discounted = weightsFor(ts, true);
    const counted = weightsFor(ts, false);
    expect(discounted.chain).toBe(0);
    expect(counted.chain).toBe(1);
    for (const name of NULLISH_OPERATORS) {
      expect(discounted.operators.get(number(name))).toBe(0);
      expect(counted.operators.get(number(name))).toBe(1);
    }
    for (const name of [...COUNTED_OPERATORS])
      expect(discounted.operators.get(number(name))).toBe(1);
    for (const name of COUNTED_KINDS) expect(discounted.kinds.get(number(name))).toBe(1);
  });

  it("are built once per TypeScript and setting", () => {
    expect(weightsFor(ts, true)).toBe(weightsFor(ts, true));
    expect(weightsFor(ts, true)).not.toBe(weightsFor(ts, false));
  });
});
