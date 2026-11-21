import { spawnSync } from "node:child_process";
import { symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemp, put, tempDir } from "../probe/testkit.ts";

/**
 * The laws layer on a real astro-site, with the kit's own astro preset and a `.astro` page: the rules of the Astro laws
 * are set on `.astro` files only, and are judged there. The layer runs in a child process, so this covers the process
 * boundary and the tools; it is not run inside a Stryker worker, and covers none of the code under mutation.
 */

afterAll(cleanTemp);

const KIT = resolve(import.meta.dirname, "../../..");
const SLOW = 120_000;
const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;
const LAWS = ["W-28", "W-30", "W-31", "W-37"];
const IMAGE = "webtops/astro-assets-image";

function layerScript(): string {
  return [
    `const root = process.env.WT_KIT;`,
    `const { realExec } = await import(root + "/src/gate/exec.ts");`,
    `const { lawsLayer } = await import(root + "/src/laws/layer/index.ts");`,
    `const { yamlCatalog } = await import(root + "/src/laws/layer/catalog.ts");`,
    `const { cfg } = await import(root + "/src/gate/testkit.ts");`,
    `const cwd = process.argv[1];`,
    `const ids = JSON.parse(process.env.WT_LAWS);`,
    `const laws = yamlCatalog().filter((law) => ids.includes(law.id));`,
    `const result = await lawsLayer(() => laws).run({`,
    `  cwd, config: cfg({ class: "astro-site" }), base: "origin/main", enforce: "hard",`,
    `  env: { PATH: process.env.PATH ?? "" }, exec: realExec, outDir: cwd + "/.web-tops/out",`,
    `  artifacts: new Map([["eslint-json", cwd + "/out/e.json"], ["tsc-diagnostics", cwd + "/out/t.json"]]),`,
    `});`,
    `process.stdout.write(JSON.stringify(result.findings.map((found) => [found.rule, found.verdict, found.message, found.file, found.line])));`,
  ].join("\n");
}

function git(cwd: string, ...args: string[]): void {
  const done = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (done.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${done.stderr}`);
  }
}

/** An astro-site: the kit's astro preset, a TypeScript module and a page, and `extra` as one more config block. */
function astroSite(extra: string): string {
  const cwd = tempDir();
  symlinkSync(join(KIT, "node_modules"), join(cwd, "node_modules"));
  put(cwd, {
    "package.json": '{ "type": "module", "dependencies": { "astro": "5.0.0" } }\n',
    "tsconfig.json": JSON.stringify({ extends: join(KIT, "tsconfig.json"), include: ["src/**/*"] }),
    "src/a.ts": "export const a: number = 1;\n",
    "src/page.astro": "---\nconst title = 'a';\n---\n<h1>{title}</h1>\n",
    "out/e.json": "[]\n",
    "out/t.json": "[]\n",
    "eslint.config.js": [
      `import { eslintPreset } from "${join(KIT, "src/presets/eslint.js")}";`,
      'const base = await eslintPreset({ variant: "astro", tsconfigRootDir: import.meta.dirname, class: "astro-site" });',
      `export default [...base, ${extra}];`,
      "",
    ].join("\n"),
  });
  git(cwd, "init", "-q");
  git(cwd, "add", "-A");
  return cwd;
}

function findingsOf(cwd: string): unknown {
  const done = spawnSync("bun", ["-e", layerScript(), cwd], {
    cwd,
    env: { ...process.env, WT_KIT: KIT, WT_LAWS: JSON.stringify(LAWS) },
    encoding: "utf8",
  });
  if (done.status !== 0) {
    throw new Error(`the layer did not run: ${done.stderr}`);
  }
  const parsed: unknown = JSON.parse(done.stdout);
  return parsed;
}

describe.skipIf(insideStryker)("an astro-site with the preset and a .astro page", () => {
  it(
    "passes W-28, W-30, W-31 and W-37, the last on a probe path since the project has no .tsx file",
    () => {
      expect(findingsOf(astroSite(""))).toEqual([
        ["law/W-28", "pass", "W-28 pass", null, null],
        ["law/W-30", "pass", "W-30 pass", null, null],
        ["law/W-31", "pass", "W-31 pass", null, null],
        [
          "law/W-37",
          "pass",
          "W-37 pass: webtops/public-env-only judged on a probe path: the project has no .tsx file",
          null,
          null,
        ],
      ]);
    },
    SLOW,
  );

  it(
    "breaks W-30 at the config line of an override that sets its rule off for .astro files: severity A, so ack-missing",
    () => {
      // the override is on line 3 of the config: the import, the preset, then the export that holds it
      const override = `{ files: ["**/*.astro"], rules: { "${IMAGE}": "off" } }`;
      expect(findingsOf(astroSite(override))).toEqual([
        ["law/W-28", "pass", "W-28 pass", null, null],
        ["law/W-30", "ack-missing", "W-30 ack-missing: 1 place(s) listed", null, null],
        [
          IMAGE,
          "ack-missing",
          `${IMAGE} is below error for 1 file(s), such as src/page.astro`,
          "eslint.config.js",
          3,
        ],
        ["law/W-31", "pass", "W-31 pass", null, null],
        [
          "law/W-37",
          "pass",
          "W-37 pass: webtops/public-env-only judged on a probe path: the project has no .tsx file",
          null,
          null,
        ],
      ]);
    },
    SLOW,
  );
});
