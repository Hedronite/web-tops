import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildReport } from "../config/test-support-report.ts";
import { madeDirs, put, tempDir } from "../init/test-support.ts";
import { loadReport, renderReport } from "./render.ts";
import { formatText } from "./text.ts";

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

/** A stored report with a failure, a skip and a layer that was never judged. */
const sample = () => buildReport({ tests: "Refuse", coverage: "not-evaluated", crap: "skip" });

describe("renderReport", () => {
  const report = sample();

  it("renders json that parses back to the stored report exactly", () => {
    const text = renderReport(report, "json");
    expect(JSON.parse(text)).toEqual(report);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("renders text with the one text printer", () => {
    expect(renderReport(report, "text")).toBe(formatText(report));
  });

  it("shows every layer, its verdict and a skip reason in text", () => {
    const text = renderReport(report, "text");
    for (const layer of report.layers) {
      expect(text).toContain(layer.id);
      expect(text).toContain(layer.verdict);
      expect(text).toContain(layer.reason ?? "");
    }
  });

  it("does not show a not-evaluated layer as a pass", () => {
    const line = renderReport(report, "text")
      .split("\n")
      .find((l) => l.includes("not-evaluated") && l.includes("coverage"));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/\bpass\b/);
  });

  it("agrees between formats on the overall verdict", () => {
    expect(report.passed).toBe(false);
    expect(JSON.parse(renderReport(report, "json"))).toMatchObject({ passed: false });
    expect(renderReport(report, "text")).toContain("gate failed");
  });
});

describe("loadReport", () => {
  it("loads a valid report from a file", () => {
    const dir = tempDir();
    put(dir, "r.json", JSON.stringify(sample()));
    expect(loadReport(join(dir, "r.json"))).toEqual({ ok: true, report: sample() });
  });

  it.each([
    ["is missing", undefined, "run `webtops gate`"],
    ["is empty", "", "empty"],
    ["is not JSON", "{ nope", "not valid JSON"],
    ["is not a report", JSON.stringify({ hello: "world" }), "gate-report"],
    ["is a JSON array", "[]", "gate-report"],
  ])("fails when the report %s", (_name, text, words) => {
    const dir = tempDir();
    if (text !== undefined) put(dir, "r.json", text);
    const loaded = loadReport(join(dir, "r.json"));
    expect(loaded.ok).toBe(false);
    expect(loaded.ok ? "" : loaded.error).toContain(words);
  });

  it("names the JSON pointer of what is wrong in a report that fails validation", () => {
    const dir = tempDir();
    const broken = { ...sample(), counts: { ...sample().counts, failed: 99 } };
    put(dir, "r.json", JSON.stringify(broken));
    const loaded = loadReport(join(dir, "r.json"));
    expect(loaded.ok).toBe(false);
    expect(loaded.ok ? "" : loaded.error).toContain("/counts");
  });
});
