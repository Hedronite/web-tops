import { describe, expect, it } from "vitest";
import {
  attributeName,
  attributeValue,
  byKind,
  child,
  children,
  dottedName,
  kind,
  linesBetween,
  lookup,
  propertyName,
  quasisOf,
  startLine,
  staticText,
  stringList,
} from "./ast.ts";

const id = (name: string) => ({ type: "Identifier", name });
const member = (object: unknown, property: unknown, computed = false) => ({
  type: "MemberExpression",
  object,
  property,
  computed,
});
const literal = (value: unknown) => ({ type: "Literal", value });

describe("reading nodes by shape", () => {
  it("takes a node's type and fields, and nothing from a value that is not a node", () => {
    expect(kind(id("a"))).toBe("Identifier");
    expect(kind(null)).toBeUndefined();
    expect(kind("Identifier")).toBeUndefined();
    expect(kind({ type: 5 })).toBeUndefined();
    expect(child(null, "x")).toBeUndefined();
    expect(child({ x: 1 }, "x")).toBe(1);
  });

  it("reads a list field, and an empty list when it is absent or not a list", () => {
    expect(children({ list: [1, 2] }, "list")).toEqual([1, 2]);
    expect(children({}, "list")).toEqual([]);
    expect(children({ list: "no" }, "list")).toEqual([]);
  });

  it("looks a node type or a name up in a table", () => {
    const table = new Map([["Identifier", 1]]);
    expect(byKind(table, id("a"))).toBe(1);
    expect(byKind(table, literal("a"))).toBeUndefined();
    expect(byKind(table, null)).toBeUndefined();
    expect(lookup(table, "Identifier")).toBe(1);
    expect(lookup(table, undefined)).toBeUndefined();
  });

  it("gives the cooked text of each template part, and nothing for a part that cannot be cooked", () => {
    const template = {
      type: "TemplateLiteral",
      quasis: [{ value: { cooked: "a" } }, { value: { cooked: null } }, { value: {} }],
      expressions: [],
    };
    expect(quasisOf(template)).toEqual(["a", "", ""]);
  });

  it("gives static text for a string literal and a template with no interpolation only", () => {
    const plain = {
      type: "TemplateLiteral",
      quasis: [{ value: { cooked: "t" } }],
      expressions: [],
    };
    expect(staticText(literal("s"))).toBe("s");
    expect(staticText(literal(5))).toBeUndefined();
    expect(staticText(plain)).toBe("t");
    expect(staticText({ ...plain, expressions: [id("x")] })).toBeUndefined();
    expect(staticText(id("x"))).toBeUndefined();
  });

  it("names an identifier, and a chain of plain member accesses", () => {
    expect(dottedName(id("a"))).toBe("a");
    expect(dottedName(member(member(id("a"), id("b")), id("c")))).toBe("a.b.c");
    expect(dottedName(member(id("a"), literal("b"), true))).toBeUndefined();
    expect(dottedName(member(id("a"), id("b"), true))).toBeUndefined();
    expect(dottedName(member({ type: "ThisExpression" }, id("x")))).toBeUndefined();
    expect(dottedName(member(id("a"), { type: "PrivateIdentifier" }))).toBeUndefined();
    expect(dottedName(literal("a"))).toBeUndefined();
  });

  it("names a property by identifier or by string key, and not by another computed key", () => {
    expect(propertyName(member(id("a"), id("b")))).toBe("b");
    expect(propertyName(member(id("a"), literal("b"), true))).toBe("b");
    expect(propertyName(member(id("a"), id("b"), true))).toBeUndefined();
  });

  it("names a JSX attribute, plain or namespaced, and reads its value", () => {
    const plain = { type: "JSXAttribute", name: { type: "JSXIdentifier", name: "className" } };
    const spaced = {
      type: "JSXAttribute",
      name: {
        type: "JSXNamespacedName",
        namespace: { name: "set" },
        name: { name: "html" },
      },
      value: { type: "JSXExpressionContainer", expression: id("x") },
    };
    expect(attributeName(plain)).toBe("className");
    expect(attributeName(spaced)).toBe("set:html");
    expect(attributeName({ name: { type: "JSXNamespacedName" } })).toBe(":");
    expect(attributeValue(spaced)).toEqual(id("x"));
    expect(attributeValue({ value: literal("a b") })).toEqual(literal("a b"));
  });

  it("takes only the strings of a list option, and the fallback when there is no list", () => {
    expect(stringList({ names: ["a", 1, "b"] }, "names", ["z"])).toEqual(["a", "b"]);
    expect(stringList({}, "names", ["z"])).toEqual(["z"]);
    expect(stringList(undefined, "names", ["z"])).toEqual(["z"]);
  });

  it("gives the line a node starts on, and the gap between two nodes", () => {
    const at = (line: number): unknown => ({ loc: { start: { line, column: 0 } } });
    expect(startLine(at(7))).toBe(7);
    expect(startLine({ loc: { start: { line: "7" } } })).toBeUndefined();
    expect(startLine({})).toBeUndefined();
    expect(linesBetween(at(3), at(4))).toBe(1);
    expect(linesBetween(at(4), at(4))).toBe(0);
    expect(linesBetween(at(3), {})).toBeUndefined();
    expect(linesBetween({}, at(3))).toBeUndefined();
  });
});
