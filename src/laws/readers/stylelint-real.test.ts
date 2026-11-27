import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { realExec } from "../../gate/exec.ts";
import { REAL_TOOL_TIMEOUT } from "../../gate/test-support-timeouts.ts";
import { cfg } from "../../gate/testkit.ts";
import { ROOT, bin, run, scratchProject } from "../../presets/test-support-scratch.ts";
import { stylelintReader } from "./stylelint.ts";
import { inputFor, lawOf } from "./testkit.ts";
import type { LawReading } from "./types.ts";

/** W-26 with the real Stylelint and the kit's preset: gate 1's run, then the reader over what it wrote. */

/** A child-process run adds nothing a stand-in does not, and is too slow to repeat for each mutant (R112). */
const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;

const LAW = lawOf("W-26", [
  { tool: "stylelint", name: "color-no-invalid-hex" },
  { tool: "stylelint", name: "block-no-empty" },
]);

const PRESET = 'export { default } from "web-tops/stylelint";\n';

async function judged(config: string, css: string): Promise<LawReading | undefined> {
  const dir = scratchProject({ "stylelint.config.js": config, "src/a.css": css });
  // The reader imports the Stylelint of the project it is asked about.
  symlinkSync(join(ROOT, "node_modules", "stylelint"), join(dir, "node_modules", "stylelint"));
  mkdirSync(join(dir, ".web-tops", "out", "hygiene"), { recursive: true });
  const json = join(dir, ".web-tops", "out", "hygiene", "stylelint.json");
  const args = ["--formatter", "json", "--output-file", json, "--allow-empty-input", "**/*.css"];
  run(bin("stylelint"), args, dir);
  const input = inputFor([LAW], {
    cwd: dir,
    tracked: ["src/a.css"],
    artifacts: { "stylelint-json": json },
  });
  const ctx = { ...input.ctx, config: cfg({ class: "web-app" }), exec: realExec };
  const [reading] = await stylelintReader({ ...input, ctx });
  return reading;
}

describe.skipIf(insideStryker)(
  "W-26 with the real Stylelint",
  { timeout: REAL_TOOL_TIMEOUT },
  () => {
    it("passes clean CSS under the preset", async () => {
      expect(await judged(PRESET, "a {\n  color: #ffffff;\n}\n")).toEqual({
        law: "W-26",
        verdict: "pass",
        findings: [],
      });
    });

    it("refuses a planted invalid colour at its file and line", async () => {
      const reading = await judged(PRESET, "a {\n  color: #ggg;\n}\n");
      expect(reading?.verdict).toBe("refuse");
      expect(reading?.findings).toEqual([
        expect.objectContaining({ rule: "color-no-invalid-hex", file: "src/a.css", line: 2 }),
      ]);
    });

    it("refuses a config that switches one of the law's rules off", async () => {
      const off =
        'import preset from "web-tops/stylelint";\nexport default { ...preset, rules: { ...preset.rules, "block-no-empty": null } };\n';
      const reading = await judged(off, "a {\n  color: #ffffff;\n}\n");
      expect(reading?.verdict).toBe("refuse");
      expect(reading?.findings.map((finding) => [finding.rule, finding.file])).toEqual([
        ["block-no-empty", "stylelint.config.js"],
      ]);
    });
  },
);
