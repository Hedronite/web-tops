import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";
import { cleanTemp, put, tempDir } from "../laws/probe/testkit.ts";
import { failing, KIT, probeFrom, probeProcess } from "./test-support-probe.ts";

afterAll(cleanTemp);

/**
 * A real astro-site adopter: its tsconfig names its own sources and says nothing of `.web-tops/`, and its ESLint
 * config is the kit's astro preset, which parses a `.astro` file with the project's `tsconfig.json`. The probe's twins
 * are not in that project, so the probe gives ESLint a tsconfig that is.
 */
function adopter(): string {
  const dir = tempDir();
  symlinkSync(join(KIT, "node_modules"), join(dir, "node_modules"));
  put(dir, {
    "tsconfig.json": JSON.stringify({ extends: join(KIT, "tsconfig.json"), include: ["src/**/*"] }),
    "package.json": '{ "type": "module", "dependencies": { "astro": "5.0.0" } }\n',
    "src/page.astro": "---\nconst title = 'a';\n---\n<h1>{title}</h1>\n",
    "eslint.config.js": [
      `import { eslintPreset } from "${join(KIT, "src/presets/eslint.js")}";`,
      'export default await eslintPreset({ variant: "astro", tsconfigRootDir: import.meta.dirname, class: "astro-site" });',
      "",
    ].join("\n"),
  });
  return dir;
}

/** Real processes only: no mutant of a mutation run reaches them (R112). */
const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;

describe.skipIf(insideStryker)(
  "the Astro twins are proven in an adopter whose tsconfig does not include the probe's directory",
  () => {
    it(
      "W-49 passes over its .astro twins, none skipped and none not evaluated",
      () => {
        const run = probeFrom(
          probeProcess(adopter(), "--class", "astro-site", "--law", "W-49", "--json"),
        );
        expect(failing(run.report)).toEqual([]);
        expect(run.code).toBe(0);
        expect(run.report.skipped).toEqual([]);
      },
      REAL_TOOL_TIMEOUT,
    );
  },
);
