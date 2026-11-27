import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { astroCheckReader, judgeAstroCheck } from "./astro-check.ts";
import { inputFor, lawOf } from "./testkit.ts";

const LAW = lawOf("W-27", [{ tool: "astro-check", name: "astro check" }]);
const ran = (code: number | null): string => JSON.stringify({ command: "astro check", code });

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const broken = (code: string): object => ({
  tool: "astro",
  rule: "astro check",
  verdict: "refuse",
  message: `astro check exited ${code}`,
});

describe("W-27: judgeAstroCheck", () => {
  it("passes a check that exited 0", () => {
    expect(judgeAstroCheck(LAW, ran(0))).toEqual({
      law: "W-27",
      verdict: "pass",
      findings: [],
    });
  });

  it.each([
    [1, "1"],
    [null, "null"],
  ])("refuses a check that exited %s", (code, said) => {
    expect(judgeAstroCheck(LAW, ran(code))).toEqual({
      law: "W-27",
      verdict: "refuse",
      findings: [broken(said)],
    });
  });

  it.each([
    ["nothing", undefined],
    ["text that is not JSON", "x"],
    ["no code", "{}"],
    ["a code that is not a number", '{"code":"0"}'],
  ])("is not-evaluated for %s", (_name, text) => {
    expect(judgeAstroCheck(LAW, text)).toEqual({
      law: "W-27",
      verdict: "not-evaluated",
      reason: "gate 1 kept no result of astro check: the step did not run",
      findings: [],
    });
  });
});

describe("the astro check reader", () => {
  it("reads the result gate 1 kept", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-astro-check-"));
    roots.push(dir);
    const path = join(dir, "astro-check.json");
    writeFileSync(path, ran(1));
    const input = inputFor([LAW], { cwd: dir, artifacts: { "astro-check-json": path } });
    expect(await astroCheckReader(input)).toEqual([
      { law: "W-27", verdict: "refuse", findings: [broken("1")] },
    ]);
  });

  it.each([
    [1, "1"],
    [null, "null"],
  ])(
    "refuses a check that exited %s even under a ratchet that holds counts",
    async (code, said) => {
      const dir = mkdtempSync(join(tmpdir(), "wt-astro-check-"));
      roots.push(dir);
      const path = join(dir, "astro-check.json");
      writeFileSync(path, ran(code));
      const input = inputFor([LAW], {
        cwd: dir,
        artifacts: { "astro-check-json": path },
        held: true,
      });
      expect(await astroCheckReader(input)).toEqual([
        { law: "W-27", verdict: "refuse", findings: [broken(said)] },
      ]);
    },
  );

  it("is not-evaluated when gate 1 kept none", async () => {
    const [reading] = await astroCheckReader(inputFor([LAW]));
    expect(reading?.verdict).toBe("not-evaluated");
  });
});
