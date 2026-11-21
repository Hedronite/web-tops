import { describe, expect, it } from "vitest";
import { invalidReport } from "./check.ts";

/** What `webtops check` writes for a configuration that is not valid: the file name, then a line for each problem. */
describe("invalidReport", () => {
  it("names the file, then each problem on its own line, with the document as (document)", () => {
    const text = invalidReport("web-tops.yaml", [
      { pointer: "/bogus", message: "unknown key" },
      { pointer: "", message: "empty" },
      { pointer: "/class", message: "missing" },
    ]);
    expect(text).toBe(
      "web-tops.yaml: invalid\n  /bogus: unknown key\n  (document): empty\n  /class: missing\n",
    );
  });
});
