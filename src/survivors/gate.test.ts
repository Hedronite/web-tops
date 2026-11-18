import { rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { madeDirs, put, tempDir } from "../init/test-support.ts";
import { ledgerState } from "./gate.ts";
import { keyString } from "./key.ts";
import { CLAMP_KEY, SUM_KEY, entryYaml, ledgerYaml } from "./test-support.ts";

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

const LEDGER = ".web-tops/survivors.yaml";
const TODAY = "2026-11-17";

const project = (...entries: readonly string[]): string => {
  const dir = tempDir();
  put(dir, LEDGER, ledgerYaml(...entries));
  return dir;
};

describe("ledgerState: what the gate takes from the survivor ledger", () => {
  it("is empty, and quiet, when there is no ledger", () => {
    const state = ledgerState(tempDir(), LEDGER, TODAY);
    expect(state.explained.size).toBe(0);
    expect(state.findings).toEqual([]);
  });

  it("explains the survivors that live entries accept, by their key strings", () => {
    const dir = project(
      entryYaml(CLAMP_KEY, ["reason: r", "owner: o", "expires: 2027-01-01"]),
      entryYaml(SUM_KEY, ["reason: r", "owner: o"]),
    );
    const state = ledgerState(dir, LEDGER, TODAY);
    expect([...state.explained].sort()).toEqual([keyString(CLAMP_KEY), keyString(SUM_KEY)].sort());
    expect(state.findings).toEqual([]);
  });

  it("stops an expired entry accepting and fails the entry itself, naming who owns it", () => {
    const dir = project(
      entryYaml(CLAMP_KEY, ["reason: r", "owner: web-platform", "expires: 2026-11-16"]),
    );
    const state = ledgerState(dir, LEDGER, TODAY);
    expect(state.explained.size).toBe(0);
    expect(state.findings).toHaveLength(1);
    expect(state.findings[0]).toMatchObject({
      tool: "webtops",
      rule: "ledger-expired",
      verdict: "fail",
      file: LEDGER,
    });
    expect(state.findings[0]?.message).toContain("src/clamp.ts::clamp");
    expect(state.findings[0]?.message).toContain("web-platform");
    expect(state.findings[0]?.message).toContain("2026-11-16");
  });

  it("still accepts on the day the entry names, and fails the next day", () => {
    const dir = project(entryYaml(CLAMP_KEY, ["reason: r", "owner: o", "expires: 2026-11-17"]));
    expect(ledgerState(dir, LEDGER, "2026-11-17").findings).toEqual([]);
    expect(ledgerState(dir, LEDGER, "2026-11-17").explained.size).toBe(1);
    expect(ledgerState(dir, LEDGER, "2026-11-18").findings).toHaveLength(1);
    expect(ledgerState(dir, LEDGER, "2026-11-18").explained.size).toBe(0);
  });

  it("fails an expired entry whether or not its survivor still exists: the state does not know the survivors", () => {
    const dir = project(entryYaml(CLAMP_KEY, ["reason: r", "owner: o", "expires: 2020-01-01"]));
    expect(ledgerState(dir, LEDGER, TODAY).findings).toHaveLength(1);
  });

  it("accepts nothing and fails once per problem for a ledger that is not valid", () => {
    const dir = project(entryYaml(CLAMP_KEY, ["owner: o"]), entryYaml(SUM_KEY, ["reason: r"]));
    const state = ledgerState(dir, LEDGER, TODAY);
    expect(state.explained.size).toBe(0);
    expect(state.findings.map((found) => [found.rule, found.verdict, found.message])).toEqual([
      ["ledger-invalid", "fail", "/survivors/0/reason: reason is missing"],
      ["ledger-invalid", "fail", "/survivors/1/owner: owner is missing"],
    ]);
  });

  it("fails a ledger path the kit refuses, in words", () => {
    const state = ledgerState(tempDir(), "../elsewhere.yaml", TODAY);
    expect(state.findings).toHaveLength(1);
    expect(state.findings[0]?.message).toContain("must name a file inside the project");
  });
});
