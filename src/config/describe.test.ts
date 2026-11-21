import type { ErrorObject } from "ajv";
import { describe as suite, expect, it } from "vitest";
import { describe } from "./report.ts";

const error = (schemaPath: string): ErrorObject => ({
  keyword: "contains",
  instancePath: "/layers",
  schemaPath,
  params: {},
});

const IDS = Array.from({ length: 12 }, (_, index) => `layer${String(index)}`);

suite("which built-in layer a failed contains stands for", () => {
  it("is named by the index in the schema path, of one digit or more", () => {
    expect(describe(error("#/allOf/3/contains"), IDS)).toBe('layer "layer3" is missing');
    expect(describe(error("#/allOf/11/contains"), IDS)).toBe('layer "layer11" is missing');
  });

  it("is nothing for a path that is not one of those, or an index with no layer", () => {
    expect(describe(error("#/properties/layers/contains"), IDS)).toBeUndefined();
    expect(describe(error("#/allOf/12/contains"), IDS)).toBeUndefined();
  });

  it("uses the built-in layer list when none is given", () => {
    expect(describe(error("#/allOf/0/contains"))).toBe('layer "hygiene" is missing');
  });
});
