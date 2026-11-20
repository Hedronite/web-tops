import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { EslintRead } from "../../census/eslint.ts";
import { cfg } from "../../gate/testkit.ts";
import type { LayerContext } from "../../gate/types.ts";
import type { LawEntry, ReadInput } from "./types.ts";
import { cleanTemp, put, tempDir } from "../probe/testkit.ts";
import { configFileOf, countFindings, eslintReader } from "./eslint.ts";

afterAll(cleanTemp);

const ANY = "@typescript-eslint/no-explicit-any";

const LAW: LawEntry = {
  id: "W-01",
  severity: "R",
  reader: "tl",
  classes: [],
  judged: true,
  rules: [{ tool: "eslint", name: "no-explicit-any" }],
};

const ok = (rules: Record<string, number>): EslintRead => ({
  ok: true,
  facts: {
    ignored: new Map(),
    levels: new Map([["src/a.ts", new Map(Object.entries(rules))]]),
  },
});

function input(
  cwd: string,
  facts: EslintRead,
  artifacts: Record<string, string>,
  held = false,
): ReadInput {
  const ctx: LayerContext = {
    cwd,
    config: cfg(),
    base: "origin/main",
    enforce: "hard",
    env: {},
    exec: () => Promise.reject(new Error("the reader never runs a tool")),
    outDir: join(cwd, ".web-tops", "out"),
    artifacts: new Map(Object.entries(artifacts)),
  };
  return { ctx, laws: [LAW], tracked: [], held, eslint: () => Promise.resolve(facts) };
}

function project(files: Record<string, string> = {}): string {
  const cwd = tempDir();
  put(cwd, {
    "eslint.config.js": `export default [{ rules: { "${ANY}": "error" } }];\n`,
    ...files,
  });
  return cwd;
}

const json = (...ids: string[]): string =>
  JSON.stringify([
    { filePath: "/p/src/a.ts", messages: ids.map((ruleId) => ({ ruleId, line: 1 })) },
  ]);

describe("G4a the ESLint reader takes gate 1's JSON and each file's effective config, and runs nothing", () => {
  it("counts the findings of gate 1 by rule id, and skips a message with no rule", () => {
    const value = [
      { messages: [{ ruleId: ANY }, { ruleId: ANY }, { ruleId: null }, { ruleId: "x" }] },
      { messages: [{ ruleId: "x" }] },
      "not an entry",
    ];
    expect(countFindings(value)).toEqual(
      new Map([
        [ANY, 2],
        ["x", 2],
      ]),
    );
    expect(countFindings({ not: "an array" })).toBeUndefined();
  });

  it("judges the laws from the artifact and the facts: a clean run at error is a pass", async () => {
    const cwd = project({ "out/eslint.json": json() });
    const readings = await eslintReader(
      input(cwd, ok({ [ANY]: 2 }), { "eslint-json": join(cwd, "out/eslint.json") }),
    );
    expect(readings).toEqual([{ law: "W-01", verdict: "pass", findings: [] }]);
  });

  it("a finding in the artifact refuses the law, and a rule off in the facts refuses it at the config line", async () => {
    const cwd = project({ "out/eslint.json": json(ANY) });
    const artifacts = { "eslint-json": join(cwd, "out/eslint.json") };
    const found = await eslintReader(input(cwd, ok({ [ANY]: 2 }), artifacts));
    expect(found).toEqual([
      { law: "W-01", verdict: "refuse", findings: [], note: "no-explicit-any 1" },
    ]);
    const off = await eslintReader(input(cwd, ok({ [ANY]: 0 }), artifacts));
    expect(off[0]?.verdict).toBe("refuse");
    expect(off[0]?.findings.map((finding) => finding.file)).toEqual(["eslint.config.js"]);
  });

  it("a missing or unreadable artifact fails the law, and so does ESLint failing to load the config", async () => {
    const cwd = project({ "out/bad.json": "{" });
    const missing = await eslintReader(input(cwd, ok({}), {}));
    expect(missing[0]).toMatchObject({ verdict: "fail" });
    expect(missing[0]?.reason).toContain("ESLint JSON of gate 1");
    const bad = await eslintReader(
      input(cwd, ok({}), { "eslint-json": join(cwd, "out/bad.json") }),
    );
    expect(bad[0]?.verdict).toBe("fail");
    put(cwd, { "out/e.json": json() });
    const broken: EslintRead = { ok: false, message: "the config did not load" };
    const failed = await eslintReader(
      input(cwd, broken, { "eslint-json": join(cwd, "out/e.json") }),
    );
    expect(failed[0]).toEqual({
      law: "W-01",
      verdict: "fail",
      reason: "the config did not load",
      findings: [],
    });
  });

  it("names the config file: the one the config says, else the flat config in the project", () => {
    const cwd = project();
    expect(configFileOf(input(cwd, ok({}), {}))).toBe("eslint.config.js");
    const bare = tempDir();
    expect(configFileOf(input(bare, ok({}), {}))).toBe("eslint.config.js");
    put(bare, { "eslint.config.mjs": "export default [];\n" });
    expect(configFileOf(input(bare, ok({}), {}))).toBe("eslint.config.mjs");
  });
});

describe("G4a the ESLint config file of a project", () => {
  it("is the flat config in its root, whichever extension it has", () => {
    for (const ext of ["js", "mjs", "cjs", "ts", "mts", "cts"]) {
      const cwd = tempDir();
      put(cwd, { [`eslint.config.${ext}`]: "export default [];\n" });
      expect(configFileOf(input(cwd, ok({}), {})), ext).toBe(`eslint.config.${ext}`);
    }
  });

  it("takes the one the config names, over any in the root", () => {
    const cwd = tempDir();
    put(cwd, { "eslint.config.js": "x\n" });
    const named = input(cwd, ok({}), {});
    const ctx = {
      ...named.ctx,
      config: cfg({ hygiene: { steps: {}, auditFailOn: "high", eslintConfig: "other.js" } }),
    };
    expect(configFileOf({ ...named, ctx })).toBe("other.js");
  });

  it("prefers the .js config when a project has more than one, as ESLint does", () => {
    const cwd = tempDir();
    put(cwd, { "eslint.config.mjs": "x\n", "eslint.config.js": "x\n" });
    expect(configFileOf(input(cwd, ok({}), {}))).toBe("eslint.config.js");
  });
});
