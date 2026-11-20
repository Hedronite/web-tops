import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";
import { cleanTemp, put, tempDir } from "../laws/probe/testkit.ts";
import { failing, KIT, messages, probeFrom, probeProcess } from "./test-support-probe.ts";
import type { ProbeReport } from "../laws/probe/types.ts";

afterAll(cleanTemp);

/**
 * An astro-site project that is not the kit: the kit's own ESLint preset for the astro variant, read from its
 * source, and the kit's tools through a symlink. `off` is a rule its config turns off for `.astro` files.
 */
function astroSite(off?: string): string {
  const dir = tempDir();
  symlinkSync(join(KIT, "node_modules"), join(dir, "node_modules"));
  const turned =
    off === undefined ? "[]" : `[{ files: ["**/*.astro"], rules: { "${off}": "off" } }]`;
  put(dir, {
    // The astro preset parses a .astro file with `project: ./tsconfig.json`, and a wildcard include skips the
    // hidden `.web-tops/`, so the project's tsconfig names the directory the probe copies its twins to.
    "tsconfig.json": JSON.stringify({
      extends: join(KIT, "tsconfig.json"),
      include: [".web-tops/out/laws-probe/**/*"],
    }),
    "package.json": '{ "type": "module", "dependencies": { "astro": "5.0.0" } }\n',
    "eslint.config.js": [
      `import { eslintPreset } from "${join(KIT, "src/presets/eslint.js")}";`,
      'const base = await eslintPreset({ variant: "astro", tsconfigRootDir: import.meta.dirname, class: "astro-site" });',
      `export default [...base, ...${turned}];`,
      "",
    ].join("\n"),
  });
  return dir;
}

function probe(dir: string, law: string): { code: number; report: ProbeReport } {
  return probeFrom(probeProcess(dir, "--class", "astro-site", "--law", law, "--json"));
}

describe("G5 the Astro twins are proven under the astro preset, and each rule is the one its twin proves", () => {
  it(
    "W-22 and W-49 pass over their .astro and .tsx twins, none skipped",
    () => {
      const dir = astroSite();
      const [w22, w49] = [probe(dir, "W-22"), probe(dir, "W-49")];
      expect([w22.code, w49.code]).toEqual([0, 0]);
      expect([failing(w22.report), failing(w49.report)]).toEqual([[], []]);
      expect([w22.report.skipped, w49.report.skipped]).toEqual([[], []]);
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "a config that turns one Astro rule off fails the law red on that rule's twin, and on no other",
    () => {
      const result = probe(astroSite("astro/no-deprecated-astro-resolve"), "W-49");
      expect(result.code).toBe(1);
      expect(messages(result.report)).toEqual([
        "W-49/bad/astro-no-deprecated-astro-resolve.astro:3 stayed quiet: astro/no-deprecated-astro-resolve did not fire on its bad twin",
      ]);
    },
    REAL_TOOL_TIMEOUT,
  );
});
