import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { realExec } from "../../gate/exec.ts";
import { off } from "../../gate/testkit.ts";
import { REAL_TOOL_TIMEOUT } from "../../gate/test-support-timeouts.ts";
import { HYGIENE_STEPS, type HygieneStep } from "../../gate/types.ts";
import { completeFindings } from "../../report/findings.ts";
import { prepare, runHygiene, type Prepared } from "./testkit.ts";

/** G1c over a real ESLint run: a finding keeps its fingerprint through an edit elsewhere in the file. */

const prepared: Prepared[] = [];

afterEach(() => {
  for (const item of prepared.splice(0)) {
    item.project.cleanup();
  }
});

const CONFIG = 'export default [{ files: ["**/*.js"], rules: { "no-unused-vars": "error" } }];\n';
const SOURCE = "export const a = 1;\nconst unused = 2;\nexport const b = 3;\n";

const ONLY_ESLINT = Object.fromEntries(
  HYGIENE_STEPS.filter((step) => step !== "eslint").map(
    (step): [HygieneStep, ReturnType<typeof off>] => [step, off("not under test")],
  ),
);

/** The fingerprint ESLint's unused-variable finding gets for a project holding `source`. */
async function fingerprintFor(source: string): Promise<string | undefined> {
  const item = prepare({ "eslint.config.js": CONFIG, "src/bad.js": source }, { real: true });
  prepared.push(item);
  const result = await runHygiene(item, realExec, {
    env: { PATH: process.env["PATH"] ?? "" },
    steps: ONLY_ESLINT,
    settings: { eslintConfig: "eslint.config.js" },
  });
  const done = completeFindings(result.findings, (file) =>
    readFileSync(join(item.project.dir, file), "utf8"),
  );
  return done.find((finding) => finding.rule === "no-unused-vars")?.fingerprint;
}

describe("G1c a real ESLint finding keeps its fingerprint through an unrelated edit", () => {
  it(
    "survives lines added above and an edit below, and changes when the flagged line changes",
    async () => {
      const base = await fingerprintFor(SOURCE);
      expect(base).toMatch(/^fp1:[0-9a-f]{16}$/u);
      expect(await fingerprintFor(`// header\n// another\n${SOURCE}`)).toBe(base);
      expect(
        await fingerprintFor(SOURCE.replace("export const b = 3;", "export const b = 4;")),
      ).toBe(base);
      expect(
        await fingerprintFor(SOURCE.replace("const unused = 2;", "const unused = 3;")),
      ).not.toBe(base);
    },
    REAL_TOOL_TIMEOUT,
  );
});
