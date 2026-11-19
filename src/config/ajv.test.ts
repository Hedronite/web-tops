import type { ErrorObject } from "ajv";
import { describe, expect, it } from "vitest";
import { ajv, fail, toProblems } from "./ajv.ts";

/** An Ajv error with the given parts; `message` is left out unless given. */
function error(parts: Partial<ErrorObject> & Pick<ErrorObject, "keyword">): ErrorObject {
  return { instancePath: "", schemaPath: "#", params: {}, ...parts };
}

describe("toProblems", () => {
  it("is empty for no errors, null and undefined", () => {
    expect(toProblems([])).toEqual([]);
    expect(toProblems(null)).toEqual([]);
    expect(toProblems(undefined)).toEqual([]);
  });

  it("points a required error at the missing property, and an additional one at the extra property", () => {
    expect(
      toProblems([
        error({
          keyword: "required",
          instancePath: "/a",
          params: { missingProperty: "b" },
          message: "m",
        }),
        error({
          keyword: "additionalProperties",
          instancePath: "/a",
          params: { additionalProperty: "c" },
          message: "n",
        }),
        error({
          keyword: "unevaluatedProperties",
          instancePath: "/d",
          params: { unevaluatedProperty: "e" },
          message: "o",
        }),
      ]),
    ).toEqual([
      { pointer: "/a/b", message: "m" },
      { pointer: "/a/c", message: "n" },
      { pointer: "/d/e", message: "o" },
    ]);
  });

  it("escapes ~ and / in a property name the way a JSON pointer does, ~ first", () => {
    const found = toProblems([
      error({ keyword: "required", params: { missingProperty: "a~b/c" }, message: "m" }),
    ]);
    expect(found).toEqual([{ pointer: "/a~0b~1c", message: "m" }]);
  });

  it("points any other error at its own path, and a required error with no name there too", () => {
    expect(toProblems([error({ keyword: "type", instancePath: "/x", message: "m" })])).toEqual([
      { pointer: "/x", message: "m" },
    ]);
    expect(
      toProblems([
        error({
          keyword: "required",
          instancePath: "/x",
          params: { missingProperty: 3 },
          message: "m",
        }),
      ]),
    ).toEqual([{ pointer: "/x", message: "m" }]);
  });

  it("adds the allowed values of an enum, and the allowed value of a const, to the message", () => {
    expect(
      toProblems([
        error({ keyword: "enum", params: { allowedValues: ["a", "b"] }, message: "must be one" }),
      ]),
    ).toEqual([{ pointer: "", message: 'must be one: ["a","b"]' }]);
    expect(
      toProblems([
        error({ keyword: "const", params: { allowedValue: "x" }, message: "must be x" }),
      ]),
    ).toEqual([{ pointer: "", message: 'must be x: "x"' }]);
  });

  it("does not read allowedValues for a const, nor allowedValue for an enum", () => {
    expect(
      toProblems([error({ keyword: "const", params: { allowedValues: ["a"] }, message: "m" })]),
    ).toEqual([{ pointer: "", message: "m" }]);
    expect(
      toProblems([error({ keyword: "enum", params: { allowedValue: "a" }, message: "m" })]),
    ).toEqual([{ pointer: "", message: "m" }]);
  });

  it("says a contains error is a missing required item, whatever its own message", () => {
    expect(
      toProblems([
        error({ keyword: "contains", message: "must contain at least 1 valid item(s)" }),
      ]),
    ).toEqual([{ pointer: "", message: "a required item is missing" }]);
  });

  it("falls back to the keyword when an error has no message", () => {
    expect(toProblems([error({ keyword: "format" })])).toEqual([
      { pointer: "", message: "fails format" },
    ]);
  });

  it("drops the noise from `if` and from the items a contains tried", () => {
    expect(
      toProblems([
        error({ keyword: "if", message: 'must match "then" schema' }),
        error({ keyword: "type", schemaPath: "#/contains/type", message: "tried" }),
        error({ keyword: "type", schemaPath: "#/properties/a/type", message: "kept" }),
      ]),
    ).toEqual([{ pointer: "", message: "kept" }]);
  });

  it("merges errors with the same pointer and message, and keeps the first order", () => {
    const found = toProblems([
      error({ keyword: "type", instancePath: "/a", message: "x" }),
      error({ keyword: "type", instancePath: "/b", message: "y" }),
      error({ keyword: "type", instancePath: "/a", message: "x" }),
      error({ keyword: "type", instancePath: "/a", message: "z" }),
    ]);
    expect(found).toEqual([
      { pointer: "/a", message: "x" },
      { pointer: "/b", message: "y" },
      { pointer: "/a", message: "z" },
    ]);
  });

  it("does not merge a pointer and message that only run together the same way", () => {
    const found = toProblems([
      error({ keyword: "type", instancePath: "/a", message: "b" }),
      error({ keyword: "type", instancePath: "/", message: "ab" }),
    ]);
    expect(found).toHaveLength(2);
  });

  it("lets the caller word an error, and falls back to the default when it does not", () => {
    const found = toProblems(
      [error({ keyword: "type", message: "a" }), error({ keyword: "enum", message: "b" })],
      (each) => (each.keyword === "type" ? "worded" : undefined),
    );
    expect(found).toEqual([
      { pointer: "", message: "worded" },
      { pointer: "", message: "b" },
    ]);
  });
});

describe("fail and the shared validator", () => {
  it("fail is one problem at a pointer", () => {
    expect(fail("/a", "bad")).toEqual({
      ok: false,
      problems: [{ pointer: "/a", message: "bad" }],
    });
  });

  it("the validator is strict, reports every error and fills defaults", () => {
    const validate = ajv.compile({
      type: "object",
      required: ["a", "b"],
      properties: { a: {}, b: {}, c: { type: "number", default: 7 } },
    });
    const value: Record<string, unknown> = {};
    expect(validate(value)).toBe(false);
    expect(validate.errors).toHaveLength(2);
    expect(value["c"]).toBe(7);
    expect(() => ajv.compile({ type: "object", notAKeyword: true })).toThrow();
  });
});
