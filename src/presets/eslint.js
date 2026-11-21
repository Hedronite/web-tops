import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

// The ESLint preset behind `web-tops/eslint` (WEB_TOPS.md section 8.2). Every rule below is the reader
// behind a judged law and stays at "error"; weaken one only through a protocol-change PR. A project's
// eslint.config.js only names its variant (written by `webtops init`). This file is plain JavaScript:
// the tools run under Node, and Node does not strip types from a file inside node_modules.

const IGNORES = ["node_modules/", "coverage/", "dist/", ".astro/", ".web-tops/"];

/** The rules behind the type-safety, error-handling and suppression laws. */
const LAW_RULES = {
  // W-01 no `any`, and no unchecked flow of an `any` value (also W-06 at the boundary)
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-member-access": "error",
  "@typescript-eslint/no-unsafe-call": "error",
  "@typescript-eslint/no-unsafe-return": "error",
  "@typescript-eslint/no-unsafe-argument": "error",
  // W-02 no `as`, no `<T>x`, no `!`; `as const` stays allowed
  "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
  "@typescript-eslint/no-non-null-assertion": "error",
  // W-10 switch over a union is exhaustive
  "@typescript-eslint/switch-exhaustiveness-check": "error",
  // W-11 no floating or misused promises; await only thenables
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/no-misused-promises": "error",
  "@typescript-eslint/await-thenable": "error",
  // W-13 caught values are unknown (useUnknownInCatchVariables is in tsconfig `strict`); a rethrow
  // keeps its cause through preserve-caught-error, which @eslint/js 10 recommends at "error"
  "@typescript-eslint/use-unknown-in-catch-callback-variable": "error",
  // W-14 only Error objects are thrown or used as rejections
  "@typescript-eslint/only-throw-error": "error",
  "@typescript-eslint/prefer-promise-reject-errors": "error",
  // W-15 type-only imports are marked
  "@typescript-eslint/consistent-type-imports": "error",
  // W-35 every suppression names its rule and says why
  "@typescript-eslint/ban-ts-comment": [
    "error",
    {
      "ts-expect-error": "allow-with-description",
      "ts-ignore": true,
      "ts-nocheck": true,
      "ts-check": false,
      minimumDescriptionLength: 5,
    },
  ],
  "@eslint-community/eslint-comments/require-description": "error",
  "@eslint-community/eslint-comments/no-unlimited-disable": "error",
};

const TSX = ["**/*.jsx", "**/*.tsx"];

const PLUGIN_SOURCE = join(
  import.meta.dirname,
  "../../packages/eslint-plugin-webtops/src/index.ts",
);

/**
 * `eslint-plugin-webtops`, which ships inside this package: a published package has its build, and
 * a checkout of the kit has the source, which Node reads as it is, so a test run needs no build.
 */
async function loadWebtops() {
  const loaded = existsSync(PLUGIN_SOURCE)
    ? await import(pathToFileURL(PLUGIN_SOURCE).href)
    : await import("../../packages/eslint-plugin-webtops/dist/index.js");
  return loaded.default;
}

const webtops = await loadWebtops();

const ASTRO = ["**/*.astro"];

/** eslint-plugin-astro lints each `<script>` of a page as a file of its own, `page.astro/0.ts`. */
const ASTRO_SCRIPTS = ["**/*.astro/*.ts", "**/*.astro/*.js"];

const LAW_CLASSES = ["ts-library", "ui-components", "astro-site", "web-app", "node-service"];

/** The class a project without a `web-tops.yaml` is read as: the one that maps the fewest laws. */
const DEFAULT_CLASS = "ts-library";

/**
 * Each rule of `eslint-plugin-webtops`, where it applies, and the classes whose laws map it
 * (WEB_TOPS.md section 8.2). A preset enables exactly the rules of the laws its class maps, and the
 * class-rules test keeps this table equal to the law files.
 */
const WEBTOPS_RULES = [
  // W-36 no unsanitized HTML in `set:html`, `dangerouslySetInnerHTML`, `innerHTML` and the like
  { rule: "webtops/no-unsanitized-html", classes: LAW_CLASSES },
  // W-37 only public env reaches client code: the client modules and the `<script>` blocks of a
  // page, never .astro frontmatter, which is server code
  {
    rule: "webtops/public-env-only",
    files: [...TSX, ...ASTRO_SCRIPTS],
    classes: ["ui-components", "astro-site", "web-app"],
  },
  // W-23 Tailwind class names are complete strings, in every file
  { rule: "webtops/complete-tailwind-classes", classes: ["astro-site", "web-app"] },
  // W-28 `client:load` needs an acknowledgement: a comment, or an entry in the ack ledger for the file
  {
    rule: "webtops/astro-client-load-ack",
    files: ASTRO,
    classes: ["astro-site", "web-app"],
    acks: "W-28",
  },
  // W-30 images go through astro:assets, and W-31 frontmatter stays short
  { rule: "webtops/astro-assets-image", files: ASTRO, classes: ["astro-site"] },
  { rule: "webtops/astro-frontmatter-size", files: ASTRO, classes: ["astro-site"] },
];

/** The class `web-tops.yaml` declares at the project root, or undefined when there is none. */
function declaredClass(root) {
  try {
    const text = readFileSync(join(root, "web-tops.yaml"), "utf8");
    return /^class:\s*["']?([\w-]+)/mu.exec(text)?.[1];
  } catch {
    return undefined;
  }
}

/** Whether the project's package.json lists astro, so it has .astro files to read. */
function dependsOnAstro(root) {
  try {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    return ["dependencies", "devDependencies", "peerDependencies"].some(
      (field) => manifest[field]?.astro !== undefined,
    );
  } catch {
    return false;
  }
}

/** Whether the class maps a rule that reads .astro pages, which only the Astro parser can read. */
const readsAstroPages = (className) =>
  WEBTOPS_RULES.some((entry) => entry.files === ASTRO && entry.classes.includes(className));

/**
 * The files the ack ledger covers for a law, which the gate passes in `WEBTOPS_ACKED_FILES` as JSON, `{ "W-28":
 * ["src/page.astro"] }`: it reads the ledger once and ESLint, which runs under Node, cannot import the kit's
 * TypeScript. An editor's ESLint, run without the gate, has no such list, so it does not honour the ledger and
 * flags a file the ledger acknowledges; only a comment acknowledges there. A list that is not one is no files.
 */
function ackedFilesOf(law) {
  try {
    const files = JSON.parse(process.env.WEBTOPS_ACKED_FILES ?? "{}")[law];
    return Array.isArray(files) ? files.filter((file) => typeof file === "string") : [];
  } catch {
    return [];
  }
}

/** A rule's setting: at error, and with the ledger's files when its law takes an acknowledgement and some are listed. */
function settingOf(entry) {
  const files = entry.acks === undefined ? [] : ackedFilesOf(entry.acks);
  return files.length === 0 ? "error" : ["error", { ackedFiles: files }];
}

/** The plugin's rules the class's laws map, each at error. */
function webtopsConfigs(className) {
  return WEBTOPS_RULES.filter((entry) => entry.classes.includes(className)).map((entry) => ({
    ...(entry.files === undefined ? {} : { files: entry.files }),
    plugins: { webtops },
    rules: { [entry.rule]: settingOf(entry) },
  }));
}

const BASE_PACKAGES = [
  "@eslint-community/eslint-plugin-eslint-comments",
  "@eslint/js",
  "@vitest/eslint-plugin",
  "eslint",
  "typescript-eslint",
];

/** The one default export of a plugin package, which may be CommonJS or ESM. */
async function load(name) {
  const loaded = await import(name);
  return loaded.default;
}

async function reactConfigs() {
  const [a11y, hooks] = await Promise.all([
    load("eslint-plugin-jsx-a11y-x"),
    load("eslint-plugin-react-hooks"),
  ]);
  return [
    // W-22 semantic elements, alt text, labels
    { files: TSX, ...a11y.configs.strict },
    {
      // W-47 rules of hooks
      files: TSX,
      plugins: { "react-hooks": hooks },
      rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "error",
      },
    },
  ];
}

function astroParserOptions(tsconfigRootDir) {
  return [
    {
      // astro-eslint-parser does not take `projectService`; it reads `project` (the file is parsed
      // as `project: true`, which fails on the template without this)
      files: ASTRO,
      languageOptions: {
        parserOptions: {
          projectService: false,
          project: "./tsconfig.json",
          tsconfigRootDir,
          extraFileExtensions: [".astro"],
        },
      },
    },
    {
      // A `<script>` block is a file of its own with no project: only the rules that need no types
      files: ASTRO_SCRIPTS,
      extends: [tseslint.configs.disableTypeChecked],
      languageOptions: { parserOptions: { projectService: false, project: null } },
    },
  ];
}

async function astroConfigs(tsconfigRootDir) {
  const [astro, a11y] = await Promise.all([
    load("eslint-plugin-astro"),
    load("eslint-plugin-jsx-a11y-x"),
  ]);
  return [
    // W-22 semantic elements, alt text, labels (also inside .astro files)
    ...astro.configs["flat/recommended"],
    ...astro.configs["flat/jsx-a11y-strict"],
    { files: TSX, ...a11y.configs.strict },
    ...astroParserOptions(tsconfigRootDir),
  ];
}

/** The Astro parser alone, for a class whose variant is not astro but whose laws read .astro pages. */
async function astroParserConfigs(tsconfigRootDir) {
  const astro = await load("eslint-plugin-astro");
  return [...astro.configs["flat/base"], ...astroParserOptions(tsconfigRootDir)];
}

const PLUGIN_CONFIGS = { base: async () => [], react: reactConfigs, astro: astroConfigs };

/** The variants a class can name: the plugin set added on top of the base law rules. */
export const VARIANTS = Object.keys(PLUGIN_CONFIGS);

/** Every package a variant imports, so a class's tool list can be checked against it. */
export const PACKAGES = {
  base: BASE_PACKAGES,
  react: [...BASE_PACKAGES, "eslint-plugin-jsx-a11y-x", "eslint-plugin-react-hooks"],
  astro: [...BASE_PACKAGES, "eslint-plugin-astro", "eslint-plugin-jsx-a11y-x"],
};

/**
 * The variant's plugin set. A class that maps an .astro-scoped rule also gets the Astro parser when
 * the project depends on astro, whatever its variant, or ESLint could not read its pages.
 */
async function pluginConfigs(variant, className, root) {
  const plugins = await PLUGIN_CONFIGS[variant](root);
  const needsParser = variant !== "astro" && readsAstroPages(className) && dependsOnAstro(root);
  return needsParser ? [...plugins, ...(await astroParserConfigs(root))] : plugins;
}

/**
 * The flat config for one class: the base law rules plus the plugin set the variant adds.
 * `tsconfigRootDir` is the project root, so type-aware rules find its tsconfig. `class` names the
 * project's class; left out, the project's `web-tops.yaml` says which it is.
 */
export async function eslintPreset({ variant, tsconfigRootDir, class: className }) {
  if (!Object.hasOwn(PLUGIN_CONFIGS, variant)) {
    throw new RangeError(`web-tops/eslint has no variant "${variant}"; use ${VARIANTS.join(", ")}`);
  }
  const resolved = className ?? declaredClass(tsconfigRootDir) ?? DEFAULT_CLASS;
  const plugins = await pluginConfigs(variant, resolved, tsconfigRootDir);
  const laws = webtopsConfigs(resolved);
  return defineConfig(
    { ignores: IGNORES },
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    {
      languageOptions: { parserOptions: { projectService: true, tsconfigRootDir } },
      // W-35: an unused suppression fails.
      linterOptions: { reportUnusedDisableDirectives: "error" },
      plugins: { "@eslint-community/eslint-comments": eslintComments },
      rules: LAW_RULES,
    },
    {
      // W-34 no focused or skipped tests committed
      files: ["**/*.test.ts", "**/*.test.tsx"],
      plugins: { vitest },
      rules: { "vitest/no-focused-tests": "error", "vitest/no-disabled-tests": "error" },
    },
    ...plugins,
    ...laws,
    {
      // Plain JavaScript config files sit outside tsconfig: no type-aware rules there.
      files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
      extends: [tseslint.configs.disableTypeChecked],
    },
  );
}
