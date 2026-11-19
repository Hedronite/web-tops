import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ESLint } from "eslint";
import { afterAll, describe, expect, it } from "vitest";
import plugin from "./index.ts";

const root = resolve(import.meta.dirname, "..");
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A value the test needs to be there. */
function need<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
  return value;
}

const JSX_RULES = ["complete-tailwind-classes", "no-unsanitized-html", "public-env-only"];
const ASTRO_RULES = ["astro-assets-image", "astro-client-load-ack", "astro-frontmatter-size"];
const RULES = [...ASTRO_RULES, ...JSX_RULES];

describe("G6a: eslint-plugin-webtops", () => {
  it("names itself and holds the rules of W-23, W-28, W-30, W-31, W-36 and W-37", () => {
    expect(plugin.meta).toEqual({ name: "eslint-plugin-webtops" });
    expect(Object.keys(plugin.rules ?? {}).sort()).toEqual(RULES);
  });

  it.each(RULES)("%s says which law it judges, and has a message and a schema", (name) => {
    const meta = need(need(need(plugin.rules)[name]).meta);
    expect(need(meta.docs).description).toMatch(/\(W-\d+\)$/u);
    expect(Object.keys(need(meta.messages))).not.toHaveLength(0);
    expect(need(meta.schema)).toBeDefined();
  });

  it("has a manifest that exports the built entry and asks for ESLint 10", () => {
    const manifest: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(manifest).toMatchObject({
      name: "eslint-plugin-webtops",
      type: "module",
      exports: { ".": { default: "./dist/index.js" } },
      peerDependencies: { eslint: ">=10.15.0" },
    });
  });

  it("is live in ESLint: a flat config that names the rules gets each of them reported", async () => {
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: {
        files: ["**/*.jsx"],
        plugins: { webtops: plugin },
        languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
        rules: {
          "webtops/complete-tailwind-classes": "error",
          "webtops/no-unsanitized-html": "error",
          "webtops/public-env-only": "error",
        },
      },
    });
    const code = [
      "export const A = ({ c, h }) => <div className={`bg-${c}-500`} dangerouslySetInnerHTML={{ __html: h }} />;",
      "export const B = import.meta.env.SECRET;",
    ].join("\n");
    const [result] = await eslint.lintText(code, { filePath: "a.jsx" });
    expect(result?.messages.map((message) => message.ruleId).sort()).toEqual(
      JSX_RULES.map((name) => `webtops/${name}`),
    );
  });

  it("builds with tsc (types are checked by the gate's own tsc run), and the built package loads under Node", () => {
    const out = mkdtempSync(join(tmpdir(), "wt-plugin-"));
    made.push(out);
    const tsc = resolve(root, "../../node_modules/.bin/tsc");
    const build = spawnSync(tsc, ["-p", "tsconfig.build.json", "--noCheck", "--outDir", out], {
      cwd: root,
      encoding: "utf8",
    });
    expect(build.status, build.stdout + build.stderr).toBe(0);
    const entry = JSON.stringify(join(out, "index.js"));
    const script = `const p = (await import(${entry})).default; console.log(Object.keys(p.rules).sort().join());`;
    const load = spawnSync("node", ["--input-type=module", "--eval", script], {
      encoding: "utf8",
    });
    expect(load.status, load.stderr).toBe(0);
    expect(load.stdout.trim()).toBe(RULES.join());
  }, 60_000);
});
