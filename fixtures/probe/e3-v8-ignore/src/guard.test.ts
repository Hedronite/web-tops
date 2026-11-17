import { expect, it } from "vitest";
import { guard } from "./guard.ts";

it("passes a positive number through", () => {
  expect(guard(1)).toBe(1);
});
