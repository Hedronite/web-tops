import { symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cfg } from "../../gate/testkit.ts";
import type { Exec, ExecResult, LayerContext } from "../../gate/types.ts";
import { cleanTemp, put, tempDir } from "../probe/testkit.ts";
import type { LawEntry } from "../readers/types.ts";
import type { Law } from "../catalog/index.ts";
import { entryOf } from "./catalog.ts";
import { forClass, ruleApplies } from "./entries.ts";
import { lawsLayer } from "./index.ts";

afterAll(cleanTemp);

/** R106: a rule with a class list holds for those classes only, and is neither required nor refused for another. */

const REPO = resolve(import.meta.dirname, "../../..");
const PLAIN = "jsx-a11y-x/alt-text";
const ASTRO = "astro/jsx-a11y/alt-text";

const W22: LawEntry = {
  id: "W-22",
  severity: "R",
  reader: "tl",
  classes: ["ui-components", "astro-site"],
  judged: true,
  rules: [
    { tool: "eslint", name: PLAIN },
    { tool: "eslint", name: ASTRO, classes: ["astro-site"] },
  ],
};

describe("a rule and the class it holds for", () => {
  it("holds for every class when it names none, and only for the named ones when it does", () => {
    const open = { tool: "eslint", name: "a" };
    const shut = { tool: "eslint", name: "b", classes: ["astro-site"] };
    expect([ruleApplies(open, "node-service"), ruleApplies(shut, "node-service")]).toEqual([
      true,
      false,
    ]);
    expect(ruleApplies(shut, "astro-site")).toBe(true);
    expect(ruleApplies({ ...shut, classes: [] }, "astro-site")).toBe(false);
  });

  it("a law as a class reads it keeps its other fields and only the rules that hold", () => {
    const read = forClass(W22, "ui-components");
    expect(read.rules.map((rule) => rule.name)).toEqual([PLAIN]);
    expect(read).toMatchObject({
      id: "W-22",
      severity: "R",
      classes: ["ui-components", "astro-site"],
    });
    expect(forClass(W22, "astro-site").rules.map((rule) => rule.name)).toEqual([PLAIN, ASTRO]);
  });
});

describe("the catalog's rule classes reach the layer", () => {
  it("entryOf keeps each rule's classes, as the catalog's schema has them", () => {
    const law: Law = {
      id: "W-22",
      title: "t",
      family: "HTML and accessibility",
      severity: "R",
      classes: ["ui-components", "astro-site"],
      reader: { kinds: ["tl"], text: "tl" },
      rules: [
        { tool: "eslint", name: PLAIN },
        { tool: "eslint", name: ASTRO, classes: ["astro-site"] },
      ],
      judged: "v0.1",
      rationale: "r",
      fix: "f",
    };
    expect(entryOf(law).rules).toEqual([
      { tool: "eslint", name: PLAIN },
      { tool: "eslint", name: ASTRO, classes: ["astro-site"] },
    ]);
  });
});

const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: "" });

/** ESLint says the plain rule is at error for src/a.tsx, and the Astro rule is not enabled at all. */
const exec: Exec = (command) =>
  Promise.resolve(
    command === "git"
      ? ok("src/a.ts\0")
      : ok(
          JSON.stringify({
            ignored: { "src/a.ts": false },
            levels: { "src/a.ts": { [PLAIN]: 2 } },
          }),
        ),
  );

function context(className: "ui-components" | "astro-site"): LayerContext {
  const cwd = tempDir();
  symlinkSync(join(REPO, "node_modules"), join(cwd, "node_modules"));
  put(cwd, { "out/eslint.json": "[]\n", "out/tsc.json": "[]\n" });
  return {
    cwd,
    config: cfg({ class: className }),
    base: "origin/main",
    enforce: "hard",
    env: {},
    exec,
    outDir: join(cwd, ".web-tops", "out"),
    artifacts: new Map([
      ["eslint-json", join(cwd, "out/eslint.json")],
      ["tsc-diagnostics", join(cwd, "out/tsc.json")],
    ]),
  };
}

describe("the laws layer reads a rule only for the classes it holds for", () => {
  it("passes W-22 for a class the Astro rule does not hold for, though no file enables it", async () => {
    const result = await lawsLayer(() => [W22]).run(context("ui-components"));
    expect(result.findings.find((found) => found.rule === "law/W-22")?.verdict).toBe("pass");
    expect(result.verdict).toBe("pass");
  });

  it("refuses W-22 for astro-site, at the config, because the Astro rule is not enabled there", async () => {
    const result = await lawsLayer(() => [W22]).run(context("astro-site"));
    expect(result.findings.find((found) => found.rule === "law/W-22")?.verdict).toBe("refuse");
    expect(result.findings.find((found) => found.rule === ASTRO)).toMatchObject({
      verdict: "refuse",
      file: "eslint.config.js",
      message: `${ASTRO} is not enabled for any TypeScript file`,
    });
  });
});
