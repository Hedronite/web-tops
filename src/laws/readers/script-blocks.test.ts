import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { realExec } from "../../gate/exec.ts";
import { REAL_TOOL_TIMEOUT } from "../../gate/test-support-timeouts.ts";
import { ROOT, TSCONFIG, configFor, scratchProject } from "../../presets/test-support-scratch.ts";
import { askEslint } from "./eslint-facts.ts";
import { readLaw } from "./eslint-judge.ts";
import { lawOf } from "./testkit.ts";

/**
 * A page's `<script>` block has no type information, so the preset cannot run a type-aware rule there. Such a rule says
 * nothing about that path; every other rule is judged on it, and a type-aware rule lowered anywhere else still refuses.
 */

/** The real ESLint, in a process of its own: it adds nothing a stand-in does not (R112). */
const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;

const TYPED = "@typescript-eslint/no-unsafe-return";
const UNTYPED = "@typescript-eslint/no-explicit-any";
const ASKED = ["src/page.astro", "src/page.astro/0.ts", "src/page.astro/0.js", "src/a.ts"];

const LAW = lawOf("W-01", [
  { tool: "eslint", name: TYPED },
  { tool: "eslint", name: UNTYPED },
]);

async function levels(config: string): Promise<ReadonlyMap<string, ReadonlyMap<string, number>>> {
  const dir = scratchProject({
    "eslint.config.js": config,
    "tsconfig.json": TSCONFIG,
    "src/page.astro": "---\nconst a = 1;\n---\n<p>{a}</p>\n",
    "src/a.ts": "export const a = 1;\n",
  });
  // The question imports the ESLint of the project it is asked about.
  symlinkSync(join(ROOT, "node_modules", "eslint"), join(dir, "node_modules", "eslint"));
  const runner = { cwd: dir, env: process.env, exec: realExec, outDir: `${dir}/.web-tops/out` };
  const read = await askEslint(runner, ASKED);
  if (!read.ok) throw new Error(read.message);
  return read.facts.levels;
}

const evidence = (found: ReadonlyMap<string, ReadonlyMap<string, number>>) => ({
  levels: found,
  counts: new Map<string, number>(),
  config: [{ file: "eslint.config.js", text: "" }],
  configFile: "eslint.config.js",
  held: false,
});

describe.skipIf(insideStryker)(
  "rules that need types, on a page's script block",
  { timeout: REAL_TOOL_TIMEOUT },
  () => {
    it("say nothing there, and are judged everywhere else", async () => {
      const found = await levels(configFor("astro"));
      const level = (file: string, rule: string): number | undefined => found.get(file)?.get(rule);
      const blocks = ["src/page.astro/0.ts", "src/page.astro/0.js"];
      expect(blocks.map((file) => level(file, TYPED))).toEqual([undefined, undefined]);
      expect(blocks.map((file) => level(file, UNTYPED))).toEqual([2, 2]);
      expect(["src/page.astro", "src/a.ts"].map((file) => level(file, TYPED))).toEqual([2, 2]);
      expect(readLaw(evidence(found), LAW)).toMatchObject({ law: "W-01", verdict: "pass" });
    });

    it.each([
      ["a type-aware rule off for a source file", "src/a.ts", TYPED],
      ["a rule that needs no types off for a script block", "**/*.astro/*.ts", UNTYPED],
    ])("still refuses %s", async (_name, files, rule) => {
      const config = configFor("astro").replace(
        "export default await eslintPreset(",
        `const preset = await eslintPreset(`,
      );
      const lowered = `${config}export default [...preset, { files: ["${files}"], rules: { "${rule}": "off" } }];\n`;
      const reading = readLaw(evidence(await levels(lowered)), LAW);
      expect(reading.verdict).toBe("refuse");
      expect(reading.findings.map((finding) => finding.rule)).toContain(rule);
    });
  },
);

describe("W-22's JSX rules on a project with no .tsx file", () => {
  it("pass on the probe path, and say so", () => {
    const law = lawOf("W-22", [{ tool: "eslint", name: "jsx-a11y-x/alt-text" }]);
    const found = new Map([
      ["src/page.astro", new Map<string, number>()],
      ["src/__webtops_probe__.tsx", new Map([["jsx-a11y-x/alt-text", 2]])],
    ]);
    expect(readLaw(evidence(found), law)).toEqual({
      law: "W-22",
      verdict: "pass",
      findings: [],
      note: "jsx-a11y-x/alt-text judged on a probe path: the project has no .tsx file",
    });
  });
});
