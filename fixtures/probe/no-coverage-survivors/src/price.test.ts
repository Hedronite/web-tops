import { expect, it } from "vitest";
import { discount } from "./price.ts";

it("gives a member 10 percent off over 100", () => {
  expect(discount(200, true)).toBe(180);
});

it("gives a member nothing at 100 or under", () => {
  expect(discount(100, true)).toBe(100);
});

it("gives a non-member nothing", () => {
  expect(discount(200, false)).toBe(200);
});
