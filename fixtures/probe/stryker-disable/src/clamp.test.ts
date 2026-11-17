import { expect, it } from "vitest";
import { clamp } from "./clamp.ts";

it("clamps below, inside and above", () => {
  expect(clamp(-1, 0, 10)).toBe(0);
  expect(clamp(5, 0, 10)).toBe(5);
  expect(clamp(11, 0, 10)).toBe(10);
});
