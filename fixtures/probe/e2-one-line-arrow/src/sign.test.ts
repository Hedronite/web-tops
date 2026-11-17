import { expect, it } from "vitest";
import { sign } from "./sign.ts";

it("loads the module", () => {
  expect(typeof sign).toBe("function");
});
