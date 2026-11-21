import { describe, expect, it } from "vitest";
import { ajv, toProblems } from "./ajv.ts";

// What the validator's errors become: a pointer and one line a person can act on.

function problemsOf(schema: object, value: unknown) {
  const validate = ajv.compile(schema);
  validate(value);
  return toProblems(validate.errors);
}

describe("toProblems: the message of each kind of error", () => {
  it("names the one value a const allows", () => {
    expect(problemsOf({ const: 1 }, 2)).toEqual([
      { pointer: "", message: "must be equal to constant: 1" },
    ]);
  });

  it("lists the values an enum allows", () => {
    expect(problemsOf({ enum: ["a", "b"] }, "c")).toEqual([
      { pointer: "", message: 'must be equal to one of the allowed values: ["a","b"]' },
    ]);
  });

  it("gives the message as the validator says it when nothing is listed, at the missing property", () => {
    expect(problemsOf({ type: "object", properties: { a: {} }, required: ["a"] }, {})).toEqual([
      { pointer: "/a", message: "must have required property 'a'" },
    ]);
  });

  it("says that an item is missing for a contains, and drops the noise from the items it tried", () => {
    expect(problemsOf({ type: "array", contains: { const: 1 } }, [2])).toEqual([
      { pointer: "", message: "a required item is missing" },
    ]);
  });

  it("falls back to the name of the keyword for an error with no message", () => {
    expect(
      toProblems([{ keyword: "custom", instancePath: "/p", schemaPath: "#/custom", params: {} }]),
    ).toEqual([{ pointer: "/p", message: "fails custom" }]);
  });
});
