import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";
import { PACKAGES, VARIANTS, eslintPreset } from "./eslint.js";
import {
  ROOT,
  errorRules,
  pluginNames,
  presetOf,
  scratchDirs,
  scratchProject,
} from "./test-support.ts";

afterAll(() => {
  for (const dir of scratchDirs()) rmSync(dir, { recursive: true, force: true });
});

const PRESET_SOURCE = readFileSync(join(ROOT, "src/presets/eslint.js"), "utf8");
const KIT_CONFIG = readFileSync(join(ROOT, "eslint.config.js"), "utf8");

/** The rules a config file writes at "error", read from its text. */
const writtenRules = (source: string): ReadonlySet<string> =>
  new Set(
    [...source.matchAll(/"((?:@[\w-]+\/)?[\w-]+(?:\/[\w-]+)?)":\s*\[?\s*"error"/g)].map(
      (match) => match[1] ?? "",
    ),
  );

function run(
  command: string,
  args: readonly string[],
  cwd: string,
): { status: number | null; output: string } {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const bin = (name: string): string => join(ROOT, "node_modules", ".bin", name);

describe("G2a: each preset imports from a scratch project", () => {
  it(
    "web-tops/eslint, web-tops/stylelint and web-tops/depcruise load under Node",
    () => {
      const dir = scratchProject();
      const script = [
        'import { createRequire } from "node:module";',
        'const eslint = await import("web-tops/eslint");',
        'const stylelint = await import("web-tops/stylelint");',
        'const depcruise = createRequire(import.meta.url)("web-tops/depcruise");',
        "console.log(JSON.stringify({",
        "  variants: eslint.VARIANTS,",
        "  configs: (await eslint.eslintPreset({ variant: 'base', tsconfigRootDir: '.' })).length,",
        "  stylelint: Object.keys(stylelint.default.rules).length,",
        "  depcruise: depcruise.forbidden.map((rule) => rule.name),",
        "}));",
      ].join("\n");
      const result = run("node", ["--input-type=module", "--eval", script], dir);
      expect(result.status, result.output).toBe(0);
      const seen: unknown = JSON.parse(result.output);
      expect(seen).toEqual({
        variants: ["base", "react", "astro"],
        configs: 9,
        stylelint: 9,
        depcruise: ["no-circular", "no-unresolvable"],
      });
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "web-tops/tsconfig/strict.json is found by `extends` and turns the W-04 flags on",
    () => {
      const dir = scratchProject({
        "tsconfig.json": '{ "extends": "web-tops/tsconfig/strict.json" }\n',
        "a.ts": "export const a = 1;\n",
      });
      const result = run(bin("tsc"), ["--showConfig"], dir);
      expect(result.status, result.output).toBe(0);
      const shown: unknown = JSON.parse(result.output);
      expect(shown).toMatchObject({
        compilerOptions: { strict: true, noUncheckedIndexedAccess: true, erasableSyntaxOnly: true },
      });
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "web-tops/stylelint is live: it flags an invalid hex color and passes clean CSS",
    () => {
      const dir = scratchProject({
        "stylelint.config.js": 'export { default } from "web-tops/stylelint";\n',
        "bad.css": "a {\n  color: #ggg;\n}\n",
        "good.css": "a {\n  color: #ffffff;\n}\n",
      });
      const bad = run(bin("stylelint"), ["bad.css"], dir);
      expect(bad.status).toBe(2);
      expect(bad.output).toContain("color-no-invalid-hex");
      expect(run(bin("stylelint"), ["good.css"], dir).status).toBe(0);
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "web-tops/eslint is live: it flags an `any` and passes typed code",
    () => {
      const dir = scratchProject({
        "eslint.config.js":
          'import { eslintPreset } from "web-tops/eslint";\nexport default await eslintPreset({\n  variant: "base",\n  tsconfigRootDir: import.meta.dirname,\n});\n',
        "tsconfig.json":
          '{ "extends": "web-tops/tsconfig/strict.json", "compilerOptions": { "noEmit": true } }\n',
        "bad.ts": "export function f(x: any): number {\n  return x as number;\n}\n",
        "good.ts": "export function g(x: number): number {\n  return x + 1;\n}\n",
      });
      const bad = run(bin("eslint"), ["bad.ts"], dir);
      expect(bad.status).toBe(1);
      expect(bad.output).toContain("@typescript-eslint/no-explicit-any");
      expect(run(bin("eslint"), ["good.ts"], dir).status, "good.ts").toBe(0);
    },
    REAL_TOOL_TIMEOUT,
  );

  it("exports plain JavaScript and JSON, which Node loads from inside node_modules", () => {
    const exported: unknown = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const text = JSON.stringify(exported);
    for (const target of [
      "./src/presets/eslint.js",
      "./src/presets/stylelint.js",
      "./src/presets/depcruise.cjs",
      "./src/presets/tsconfig/strict.json",
    ]) {
      expect(text, target).toContain(`"${target}"`);
    }
    expect(text).not.toMatch(/src\/presets\/[\w/]+\.ts"/);
  });
});

describe("the ESLint preset", () => {
  it("names its variants, and refuses one it does not have", async () => {
    expect(VARIANTS).toEqual(["base", "react", "astro"]);
    // @ts-expect-error: a variant the preset does not have
    const refused = eslintPreset({ variant: "vue", tsconfigRootDir: "." });
    await expect(refused).rejects.toThrow(
      'web-tops/eslint has no variant "vue"; use base, react, astro',
    );
  });

  it("lists every package its source imports, and no other", () => {
    const imported = [...PRESET_SOURCE.matchAll(/(?:from|load\()\s*"([^"]+)"/g)].map((match) =>
      (match[1] ?? "").replace(/^eslint\/config$/, "eslint"),
    );
    const listed = new Set(Object.values(PACKAGES).flat());
    expect(new Set(imported)).toEqual(listed);
  });

  it.each([
    ["base", ["@typescript-eslint", "vitest"], ["react-hooks", "jsx-a11y-x", "astro"]],
    ["react", ["react-hooks", "jsx-a11y-x"], ["astro"]],
    ["astro", ["astro", "jsx-a11y-x"], ["react-hooks"]],
  ] as const)("%s registers its plugins and no other class's", async (variant, has, hasNot) => {
    const plugins = pluginNames(await presetOf(variant));
    for (const name of has) expect(plugins, name).toContain(name);
    for (const name of hasNot) expect(plugins, name).not.toContain(name);
  });

  it("sets the kit's own law rules, and no more, to error in every variant", async () => {
    const kit = writtenRules(KIT_CONFIG);
    expect(kit.size).toBeGreaterThanOrEqual(15);
    // The hooks rules belong to the react variant alone; the rest is the kit's own set.
    const written = [...writtenRules(PRESET_SOURCE)].filter(
      (rule) => !rule.startsWith("react-hooks/"),
    );
    expect(new Set(written)).toEqual(kit);
    for (const variant of VARIANTS) {
      const rules = errorRules(await presetOf(variant));
      for (const rule of kit) expect(rules, `${variant} ${rule}`).toContain(rule);
    }
  });

  it.each(VARIANTS)(
    "%s reports unused suppressions and ignores the usual output",
    async (variant) => {
      const config = await presetOf(variant);
      expect(config.some((e) => e.linterOptions?.reportUnusedDisableDirectives === "error")).toBe(
        true,
      );
      const ignores = config.flatMap((entry) =>
        entry.files === undefined ? (entry.ignores ?? []) : [],
      );
      for (const entry of ["node_modules/", "coverage/", "dist/", ".astro/", ".web-tops/"]) {
        expect(ignores, entry).toContain(entry);
      }
    },
  );

  it("points type-aware rules at the project root it is given", async () => {
    const config = await eslintPreset({ variant: "base", tsconfigRootDir: "/some/project" });
    const roots = config.map((entry): unknown =>
      Reflect.get(entry.languageOptions?.parserOptions ?? {}, "tsconfigRootDir"),
    );
    expect(roots).toContain("/some/project");
  });
});
