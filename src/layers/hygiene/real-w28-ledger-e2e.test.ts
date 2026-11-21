import { spawnSync } from "node:child_process";
import { symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemp, put, tempDir } from "../../laws/probe/testkit.ts";

/**
 * The hygiene `eslint` step on a real astro-site with a page that loads a component with `client:load`: the finding of
 * W-28, and what silences it, a comment above the element or a valid entry in the ack ledger. The layer runs in a child
 * process with real ESLint, so this covers the process boundary, the environment the step builds and the preset that
 * reads it; it is not run inside a Stryker worker, and covers none of the code under mutation.
 */

afterAll(cleanTemp);

const KIT = resolve(import.meta.dirname, "../../..");
const SLOW = 120_000;
const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;
const RULE = "webtops/astro-client-load-ack";

const PAGE = (comment: string): string =>
  [
    "---",
    "const Widget = (): null => null;",
    "---",
    ...(comment === "" ? [] : [comment]),
    "<Widget client:load />",
    "",
  ].join("\n");

const LEDGER = (file: string, expires: string): string =>
  [
    "version: 1",
    "acks:",
    "  - law: W-28",
    `    file: ${file}`,
    "    reason: the widget is the first screen",
    "    owner: web team",
    `    expires: ${expires}`,
    "",
  ].join("\n");

function script(): string {
  return [
    `const root = process.env.WT_KIT;`,
    `const { realExec } = await import(root + "/src/gate/exec.ts");`,
    `const { hygieneLayer } = await import(root + "/src/layers/hygiene/index.ts");`,
    `const { HYGIENE_STEPS } = await import(root + "/src/gate/types.ts");`,
    `const { cfg } = await import(root + "/src/gate/testkit.ts");`,
    `const cwd = process.argv[1];`,
    `const steps = Object.fromEntries(HYGIENE_STEPS.map((name) => [name, name === "eslint" ? { enabled: true } : { enabled: false, reason: "not this test" }]));`,
    `const result = await hygieneLayer.run({`,
    `  cwd, config: cfg({ class: "astro-site", hygiene: { auditFailOn: "high", steps } }), base: "origin/main", enforce: "hard",`,
    `  env: { PATH: process.env.PATH ?? "" }, exec: realExec, outDir: cwd + "/.web-tops/out", artifacts: new Map(),`,
    `});`,
    `process.stdout.write(JSON.stringify(result.findings.filter((found) => found.verdict === "fail").map((found) => [found.rule, found.file, found.line])));`,
  ].join("\n");
}

/** An astro-site with the kit's preset and a page at `src/page.astro`, and `extra` files beside them. */
function site(page: string, extra: Readonly<Record<string, string>> = {}): string {
  const cwd = tempDir();
  symlinkSync(join(KIT, "node_modules"), join(cwd, "node_modules"));
  put(cwd, {
    "package.json": '{ "type": "module", "dependencies": { "astro": "5.0.0" } }\n',
    "tsconfig.json": JSON.stringify({ extends: join(KIT, "tsconfig.json"), include: ["src/**/*"] }),
    "src/a.ts": "export const a: number = 1;\n",
    "src/page.astro": page,
    "eslint.config.js": [
      `import { eslintPreset } from "${join(KIT, "src/presets/eslint.js")}";`,
      'export default await eslintPreset({ variant: "astro", tsconfigRootDir: import.meta.dirname, class: "astro-site" });',
      "",
    ].join("\n"),
    ...extra,
  });
  return cwd;
}

function findingsOf(cwd: string): unknown {
  const done = spawnSync("bun", ["-e", script(), cwd], {
    cwd,
    env: { ...process.env, WT_KIT: KIT },
    encoding: "utf8",
  });
  if (done.status !== 0) {
    throw new Error(`the layer did not run: ${done.stderr}`);
  }
  const parsed: unknown = JSON.parse(done.stdout);
  return parsed;
}

const FLAGGED = [[RULE, "src/page.astro", 4]];

describe.skipIf(insideStryker)("W-28 through the hygiene eslint step on a real astro-site", () => {
  it(
    "flags client:load with no acknowledgement, at the opening tag",
    () => {
      expect(findingsOf(site(PAGE("")))).toEqual([[RULE, "src/page.astro", 4]]);
    },
    SLOW,
  );

  it(
    "does not flag it under a comment on the line above",
    () => {
      expect(findingsOf(site(PAGE("<!-- webtops-ack W-28: the first screen -->")))).toEqual([]);
    },
    SLOW,
  );

  it(
    "does not flag it for a file the ledger covers, whatever the line",
    () => {
      const cwd = site(PAGE(""), { ".web-tops/acks.yaml": LEDGER("src/page.astro", "2999-01-01") });
      expect(findingsOf(cwd)).toEqual([]);
    },
    SLOW,
  );

  it.each([
    ["an entry past its expiry", LEDGER("src/page.astro", "2020-01-01")],
    ["an entry for another file", LEDGER("src/other.astro", "2999-01-01")],
    ["a ledger that cannot be read", "acks: [unclosed\n"],
  ])(
    "still flags it with %s",
    (_name, ledger) => {
      expect(findingsOf(site(PAGE(""), { ".web-tops/acks.yaml": ledger }))).toEqual(FLAGGED);
    },
    SLOW,
  );

  it(
    "flags a comment that gives no reason even where the ledger covers another file",
    () => {
      const cwd = site(PAGE("<!-- webtops-ack W-28: . -->"), {
        ".web-tops/acks.yaml": LEDGER("src/other.astro", "2999-01-01"),
      });
      expect(findingsOf(cwd)).toEqual([[RULE, "src/page.astro", 5]]);
    },
    SLOW,
  );
});
