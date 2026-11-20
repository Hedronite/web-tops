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

async function astroConfigs() {
  const [astro, a11y] = await Promise.all([
    load("eslint-plugin-astro"),
    load("eslint-plugin-jsx-a11y-x"),
  ]);
  return [
    // W-22 semantic elements, alt text, labels (also inside .astro files)
    ...astro.configs["flat/recommended"],
    ...astro.configs["flat/jsx-a11y-strict"],
    { files: TSX, ...a11y.configs.strict },
  ];
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
 * The flat config for one class: the base law rules plus the plugin set the variant adds.
 * `tsconfigRootDir` is the project root, so type-aware rules find its tsconfig.
 */
export async function eslintPreset({ variant, tsconfigRootDir }) {
  if (!Object.hasOwn(PLUGIN_CONFIGS, variant)) {
    throw new RangeError(`web-tops/eslint has no variant "${variant}"; use ${VARIANTS.join(", ")}`);
  }
  const plugins = await PLUGIN_CONFIGS[variant]();
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
    {
      // Plain JavaScript config files sit outside tsconfig: no type-aware rules there.
      files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
      extends: [tseslint.configs.disableTypeChecked],
    },
  );
}
