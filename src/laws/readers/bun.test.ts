import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bunReader } from "./bun.ts";
import { inputFor, lawOf } from "./testkit.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const AUDIT = lawOf("W-38", [{ tool: "bun", name: "audit" }]);
const FROZEN = lawOf("W-40", [{ tool: "bun", name: "install --frozen-lockfile" }]);
const OTHER = lawOf("W-99", [{ tool: "bun", name: "pm ls" }]);

describe("bunReader: one tool, two laws", () => {
  it("routes each law to the reader of the rule it names, and refuses to guess at any other", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-bun-"));
    roots.push(dir);
    writeFileSync(join(dir, "audit.json"), "{}");
    writeFileSync(join(dir, "install.json"), '{"code":0}');
    const readings = await bunReader(
      inputFor([OTHER, FROZEN, AUDIT], {
        tracked: ["bun.lock"],
        artifacts: {
          "audit-json": join(dir, "audit.json"),
          "install-json": join(dir, "install.json"),
        },
      }),
    );
    expect(readings.map((reading) => [reading.law, reading.verdict])).toEqual([
      ["W-38", "pass"],
      ["W-40", "pass"],
      ["W-99", "not-evaluated"],
    ]);
    expect(readings[2]?.reason).toBe("bun has no reader for pm ls of W-99");
  });

  it("reads nothing for a law that does not map the tool", async () => {
    const eslintLaw = lawOf("W-01", [{ tool: "eslint", name: "no-explicit-any" }]);
    const readings = await bunReader(inputFor([eslintLaw]));
    expect(readings.map((reading) => reading.law)).toEqual(["W-01"]);
    expect(readings[0]?.verdict).toBe("not-evaluated");
    expect(readings[0]?.reason).toBe("bun has no reader for the rules of W-01");
  });

  it("a law that names audit and another bun rule is not evaluated for the other rule, beside its audit reading", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-bun-"));
    roots.push(dir);
    writeFileSync(join(dir, "audit.json"), "{}");
    const both = lawOf("W-50", [
      { tool: "bun", name: "audit" },
      { tool: "bun", name: "made-up" },
      { tool: "bun", name: "pm ls" },
    ]);
    const readings = await bunReader(
      inputFor([both], { artifacts: { "audit-json": join(dir, "audit.json") } }),
    );
    expect(readings.map((reading) => [reading.law, reading.verdict])).toEqual([
      ["W-50", "pass"],
      ["W-50", "not-evaluated"],
    ]);
    expect(readings[1]?.reason).toBe("bun has no reader for made-up, pm ls of W-50");
  });

  it("a law that names only the two known rules gets no reading for an unknown one", async () => {
    const both = lawOf("W-51", [
      { tool: "bun", name: "audit" },
      { tool: "bun", name: "install --frozen-lockfile" },
    ]);
    const readings = await bunReader(inputFor([both], { tracked: ["bun.lock"] }));
    expect(readings.map((reading) => reading.verdict)).toEqual(["not-evaluated", "not-evaluated"]);
    expect(readings.every((reading) => !(reading.reason ?? "").includes("no reader"))).toBe(true);
  });
});
