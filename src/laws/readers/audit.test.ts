import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recorded } from "../../layers/hygiene/testkit.ts";
import { auditReader, judgeAudit, readAdvisories } from "./audit.ts";
import { inputFor, lawOf } from "./testkit.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const LAW = lawOf("W-38", [{ tool: "audit", name: "bun audit" }]);

const advisory = (severity: string, extra: object = {}): object => ({
  url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
  title: "A flaw",
  severity,
  ...extra,
});

describe("readAdvisories", () => {
  it("lists each high and critical advisory, by its advisory id and package", () => {
    const found = readAdvisories(
      JSON.stringify({ lodash: [advisory("high"), advisory("critical", { title: "Worse" })] }),
    );
    expect(found).toEqual([
      {
        tool: "audit",
        rule: "GHSA-aaaa-bbbb-cccc",
        verdict: "refuse",
        message: "lodash: A flaw (high)",
      },
      {
        tool: "audit",
        rule: "GHSA-aaaa-bbbb-cccc",
        verdict: "refuse",
        message: "lodash: Worse (critical)",
      },
    ]);
  });

  it.each(["moderate", "low", "info", ""])("lists no %j advisory", (severity) => {
    expect(readAdvisories(JSON.stringify({ lodash: [advisory(severity)] }))).toEqual([]);
  });

  it("names an advisory with no url `advisory`, and with no title `advisory`", () => {
    const found = readAdvisories(JSON.stringify({ x: [{ severity: "high" }] }));
    expect(found?.[0]).toMatchObject({ rule: "advisory", message: "x: advisory (high)" });
  });

  it("reads the recordings: a vulnerable project lists advisories, a clean one none", () => {
    expect(readAdvisories(recorded("audit-vulnerable.json"))?.length).toBeGreaterThanOrEqual(3);
    expect(readAdvisories(recorded("audit-clean.json"))).toEqual([]);
  });

  it.each([undefined, "", "not json", "[]", "1"])("is undefined for %j", (text) => {
    expect(readAdvisories(text)).toBeUndefined();
  });
});

describe("judgeAudit", () => {
  const found = readAdvisories(JSON.stringify({ lodash: [advisory("high")] }));

  it("refuses a law over advisories, and passes one over none", () => {
    expect(judgeAudit(LAW, found, false)).toMatchObject({ law: "W-38", verdict: "refuse" });
    expect(judgeAudit(LAW, [], false)).toEqual({ law: "W-38", verdict: "pass", findings: [] });
  });

  it("holds the advisories under a ratchet baseline", () => {
    expect(judgeAudit(LAW, found, true)).toMatchObject({
      verdict: "pass",
      note: "1 held by the baseline",
    });
  });

  it("is not evaluated with no report: the registry was not reached, and that is never a pass", () => {
    expect(judgeAudit(LAW, undefined, false)).toEqual({
      law: "W-38",
      verdict: "not-evaluated",
      reason:
        "gate 1 wrote no bun audit report: the advisory registry was not reached, or the audit did not run",
      findings: [],
    });
  });
});

describe("auditReader", () => {
  function artifact(text: string): Record<string, string> {
    const dir = mkdtempSync(join(tmpdir(), "wt-audit-"));
    roots.push(dir);
    const path = join(dir, "audit.json");
    writeFileSync(path, text);
    return { "audit-json": path };
  }

  it("reads the report gate 1 kept", async () => {
    const readings = await auditReader(
      inputFor([LAW], { artifacts: artifact(recorded("audit-vulnerable.json")) }),
    );
    expect(readings[0]?.verdict).toBe("refuse");
  });

  it("is not evaluated when gate 1 kept no report, or a report that is not one", async () => {
    expect((await auditReader(inputFor([LAW])))[0]?.verdict).toBe("not-evaluated");
    expect((await auditReader(inputFor([LAW], { artifacts: artifact("[]") })))[0]?.verdict).toBe(
      "not-evaluated",
    );
  });
});
