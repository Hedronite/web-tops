import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Linter } from "eslint";
import { afterAll, describe, expect, it } from "vitest";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";
import { PACKAGES, VARIANTS, eslintPreset } from "./eslint.js";
import type { EslintVariant } from "./eslint.js";

const ROOT = resolve(import.meta.dirname, "../..");
const scratches: string[] = [];

/**
 * A project outside the kit that reaches it only as `node_modules/web-tops`, the way an inited
 * project does. `files` are written relative to the project; it is an ES module project.
 */
function scratchProject(files: Readonly<Record<string, string>> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-preset-"));
  scratches.push(dir);
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(ROOT, join(dir, "node_modules", "web-tops"));
  // eslint-plugin-astro finds the TypeScript parser from the project it lints, as an adopter has it.
  symlinkSync(
    join(ROOT, "node_modules", "typescript-eslint"),
    join(dir, "node_modules", "typescript-eslint"),
  );
  const all = { "package.json": '{ "type": "module" }\n', ...files };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const presetOf = (variant: EslintVariant): Promise<Linter.Config[]> =>
  eslintPreset({ variant, tsconfigRootDir: "<project>" });

const levelOf = (setting: unknown): unknown => (Array.isArray(setting) ? setting[0] : setting);

/** The rules a config sets to error. */
function errorRules(config: readonly Linter.Config[]): ReadonlySet<string> {
  return new Set(
    config.flatMap((entry) =>
      Object.entries(entry.rules ?? {})
        .filter(([, setting]) => levelOf(setting) === "error")
        .map(([rule]) => rule),
    ),
  );
}

/** The plugin names a config registers. */
const pluginNames = (config: readonly Linter.Config[]): ReadonlySet<string> =>
  new Set(config.flatMap((entry) => Object.keys(entry.plugins ?? {})));

afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
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
        configs: 10,
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

  it(
    "the plugin's rules are live through web-tops/eslint: client code is flagged, server code is not",
    () => {
      const dir = scratchProject({
        "web-tops.yaml": "class: web-app\n",
        "eslint.config.js":
          'import { eslintPreset } from "web-tops/eslint";\nexport default await eslintPreset({\n  variant: "react",\n  tsconfigRootDir: import.meta.dirname,\n});\n',
        "tsconfig.json":
          '{ "extends": "web-tops/tsconfig/strict.json", "compilerOptions": { "noEmit": true, "jsx": "preserve" } }\n',
        "client.tsx":
          "export const A = (p: { c: string; h: string }) => (\n  <div className={`bg-${p.c}-500`} dangerouslySetInnerHTML={{ __html: p.h }}>{process.env.SECRET}</div>\n);\n",
        "server.ts": "export const s: unknown = process.env.SECRET;\n",
      });
      const client = run(bin("eslint"), ["client.tsx"], dir);
      for (const rule of ["complete-tailwind-classes", "no-unsanitized-html", "public-env-only"]) {
        expect(client.output, rule).toContain(`webtops/${rule}`);
      }
      const server = run(bin("eslint"), ["server.ts"], dir);
      expect(server.output).not.toContain("webtops/public-env-only");
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "the Astro rules are live through web-tops/eslint: a page is flagged, its frontmatter may read server env",
    () => {
      const frontmatter = Array.from(
        { length: 11 },
        (_, i) => `const s${String(i)} = ${String(i)};`,
      );
      const dir = scratchProject({
        "web-tops.yaml": "class: astro-site\n",
        "eslint.config.js":
          'import { eslintPreset } from "web-tops/eslint";\nexport default await eslintPreset({\n  variant: "astro",\n  tsconfigRootDir: import.meta.dirname,\n});\n',
        "tsconfig.json":
          '{ "extends": "web-tops/tsconfig/strict.json", "compilerOptions": { "noEmit": true }, "include": ["src"] }\n',
        "src/page.astro": [
          "---",
          'import { Image } from "astro:assets";',
          'import Widget from "../Widget";',
          "const secret: unknown = import.meta.env.SECRET;",
          ...frontmatter,
          "---",
          '<img src="a.png" alt="" />',
          '<Image src="a.png" alt="" />',
          "<Widget client:load />",
          "<script>",
          "  const client: unknown = import.meta.env.SECRET;",
          "</script>",
          "",
        ].join("\n"),
      });
      const page = run(bin("eslint"), ["src/page.astro"], dir);
      for (const rule of [
        "astro-assets-image",
        "astro-client-load-ack",
        "astro-frontmatter-size",
      ]) {
        expect(page.output, rule).toContain(`webtops/${rule}`);
      }
      expect(page.output.split("webtops/public-env-only")).toHaveLength(2);
      expect(page.output).toMatch(/\n\s+21:27\s+error\s+SECRET[^\n]*webtops\/public-env-only/u);
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
    // The preset imports the plugin's build once published, so the build ships beside it.
    const files: unknown = Reflect.get(exported ?? {}, "files");
    expect(files).toEqual(
      expect.arrayContaining([
        "packages/eslint-plugin-webtops/package.json",
        "packages/eslint-plugin-webtops/dist",
      ]),
    );
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
    const imported = [...PRESET_SOURCE.matchAll(/(?:from|load\()\s*"((?!node:)[^".][^"]*)"/g)].map(
      (match) => (match[1] ?? "").replace(/^eslint\/config$/, "eslint"),
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

  const W36 = "webtops/no-unsanitized-html";
  const W37 = "webtops/public-env-only";
  const W23 = "webtops/complete-tailwind-classes";
  const W28 = "webtops/astro-client-load-ack";
  const W30 = "webtops/astro-assets-image";
  const W31 = "webtops/astro-frontmatter-size";
  const ALL = [W36, W37, W23, W28, W30, W31];

  it.each([
    ["ts-library", "base", [W36]],
    ["node-service", "base", [W36]],
    ["ui-components", "react", [W36, W37]],
    ["web-app", "react", [W36, W37, W23, W28]],
    ["astro-site", "astro", ALL],
    ["cli", "base", []],
  ] as const)("class %s (%s) enables exactly the plugin rules %j", async (cls, variant, has) => {
    const config = await eslintPreset({ variant, tsconfigRootDir: "<project>", class: cls });
    const rules = errorRules(config);
    for (const name of ALL) {
      if (has.some((wanted) => wanted === name)) expect(rules, name).toContain(name);
      else expect(rules, name).not.toContain(name);
    }
    expect(pluginNames(config).has("webtops")).toBe(has.length > 0);
  });

  it("reads the class from the project's web-tops.yaml, and falls back to the loosest class", async () => {
    const root = scratchProject({ "web-tops.yaml": 'protocol: "0.3.0"\nclass: "web-app"\n' });
    const declared = errorRules(await eslintPreset({ variant: "react", tsconfigRootDir: root }));
    expect(ALL.filter((name) => declared.has(name))).toEqual([W36, W37, W23, W28]);
    const none = scratchProject();
    const fallback = errorRules(await eslintPreset({ variant: "react", tsconfigRootDir: none }));
    expect(ALL.filter((name) => fallback.has(name))).toEqual([W36]);
    const unquoted = scratchProject({ "web-tops.yaml": "class: ui-components\n" });
    const read = errorRules(await eslintPreset({ variant: "react", tsconfigRootDir: unquoted }));
    expect(ALL.filter((name) => read.has(name))).toEqual([W36, W37]);
  });

  it("scopes public-env-only (W-37) to the client modules and the <script> blocks, never the frontmatter", async () => {
    const config = await eslintPreset({
      variant: "astro",
      tsconfigRootDir: ".",
      class: "astro-site",
    });
    const scopes = config
      .filter((entry) => Object.hasOwn(entry.rules ?? {}, W37))
      .map((entry) => entry.files);
    expect(scopes).toEqual([["**/*.jsx", "**/*.tsx", "**/*.astro/*.ts", "**/*.astro/*.js"]]);
  });

  it("scopes the Astro rules (W-28, W-30, W-31) to .astro files", async () => {
    const config = await eslintPreset({
      variant: "astro",
      tsconfigRootDir: ".",
      class: "astro-site",
    });
    for (const name of [W28, W30, W31]) {
      const scopes = config
        .filter((entry) => Object.hasOwn(entry.rules ?? {}, name))
        .map((entry) => entry.files);
      expect(scopes, name).toEqual([["**/*.astro"]]);
    }
  });

  it("lints .astro files with a project, and their <script> blocks without types", async () => {
    const config = await eslintPreset({ variant: "astro", tsconfigRootDir: "/some/project" });
    const parserOptions = (files: string): unknown[] =>
      config
        .filter((entry) => entry.files?.includes(files) === true)
        .map((entry) => entry.languageOptions?.parserOptions)
        .filter((options) => options !== undefined);
    expect(parserOptions("**/*.astro")).toContainEqual({
      projectService: false,
      project: "./tsconfig.json",
      tsconfigRootDir: "/some/project",
      extraFileExtensions: [".astro"],
    });
    expect(parserOptions("**/*.astro/*.ts")).toContainEqual({
      projectService: false,
      project: null,
    });
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
