import { describe, it } from "vitest";

describe("suite", () => {
  it.only("runs alone", () => {}); // expect: no-focused-tests
  it.skip("is skipped", () => {}); // expect: no-disabled-tests
});
