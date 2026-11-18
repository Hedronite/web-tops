import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical.ts";
import { parseBaseline, readBaseline } from "./read.ts";

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const EMPTY = {
  report_version: "2.0.0",
  subject: { package: "p", root: "." },
  crap: {},
  coverage: {},
  findings: {},
  fingerprints: [],
  census: {},
  pages: {},
};

describe("G9c: reading a baseline gives a reason for everything that is not one", () => {
  it("parses a valid baseline", () => {
    expect(parseBaseline(canonicalJson(EMPTY), "b.json")).toMatchObject({ ok: true });
  });

  it("says when the text is not JSON, and names the pointers when it is not a baseline", () => {
    expect(parseBaseline("{ not json", "b.json")).toEqual({
      ok: false,
      reason: "b.json is not valid JSON",
    });
    const wrong = parseBaseline('{"report_version": 2}', "b.json");
    expect(wrong).toMatchObject({ ok: false });
    expect(JSON.stringify(wrong)).toContain("b.json is not a valid baseline");
  });

  it("says the baseline is missing for a path with no file", () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-read-"));
    made.push(dir);
    expect(readBaseline(dir, "none.json")).toMatchObject({ ok: false });
    expect(JSON.stringify(readBaseline(dir, "none.json"))).toContain("missing");
    writeFileSync(join(dir, "b.json"), canonicalJson(EMPTY));
    expect(readBaseline(dir, "b.json").ok).toBe(true);
  });
});
