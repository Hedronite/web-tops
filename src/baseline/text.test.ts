import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import schema from "../../schema/baseline.schema.json" with { type: "json" };
import { get } from "../config/test-support.ts";

const spec = readFileSync(join(import.meta.dirname, "../../WEB_TOPS.md"), "utf8");

function section(from: string, to: string): string {
  return spec.slice(spec.indexOf(from), spec.indexOf(to));
}

describe("G9: the protocol text states the baseline the code writes", () => {
  const report = section("### 6.6", "### 6.7");
  const modes = section("### 6.7", "**Suppression census");
  const cli = section("## 12.", "## 13.");

  it.each([
    ["names the schema", "schema/baseline.schema.json"],
    ["holds the fingerprint of each counted finding", "`fp1`"],
    ["holds the suppression counts by census kind", "census kind"],
    ["counts a coverage hint, as the coverage layer reports it", "`coverage-hint`"],
    ["is written in one canonical form", "canonical"],
  ])("section 6.6 %s", (_what, phrase) => {
    expect(report).toContain(phrase);
  });

  it.each([
    ["only `webtops baseline` writes it, from the last report", "from the last report"],
    ["at HEAD, on a clean tree", "clean tree"],
    ["refused under hard", "`hard`"],
    ["never looser than the baseline already there", "looser"],
    ["may only tighten across a change", "only tighten"],
    ["compared with the merge base's copy", "merge base's copy"],
    ["the first baseline is accepted", "first baseline"],
    ["a rise in a census kind fails, and a moved directive keeps its entry", "keeps its entry"],
    ["coverage is compared exactly", "exactly"],
  ])("section 6.7 %s", (_what, phrase) => {
    expect(modes).toContain(phrase);
  });

  it("section 12 says what the baseline command and check do about it", () => {
    expect(cli).toMatch(/\| `baseline` \|[^\n]*last report[^\n]*clean tree/);
    expect(cli).toMatch(/\| `check` \|[^\n]*merge base's copy/);
  });

  it("agrees with the schema: every top-level key the text names is one the schema requires", () => {
    const required = get(schema, "required");
    expect(required).toEqual([
      "report_version",
      "subject",
      "crap",
      "coverage",
      "findings",
      "fingerprints",
      "census",
      "pages",
    ]);
    for (const key of ["crap", "coverage", "findings", "fingerprints", "census", "pages"]) {
      expect(report + modes, key).toContain(
        key === "crap" ? "CRAP" : key.replace("fingerprints", "`fp1`"),
      );
    }
  });
});
