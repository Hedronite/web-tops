import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import webtops from "../../packages/eslint-plugin-webtops/dist/index.js";

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
  // W-36 no unsanitized HTML in `set:html`, `dangerouslySetInnerHTML`, `innerHTML` and the like
  "webtops/no-unsanitized-html": "error",
};

const TSX = ["**/*.jsx", "**/*.tsx"];

// The rules of `eslint-plugin-webtops` beyond W-36. The plugin ships inside this package (its build
// is in `files`), so an adopter has one dependency and no separate pin. A preset enables exactly the
// rules of the laws its class maps (the class-rules test), which is why there are two groups.

/** W-37 only public env reaches client code, for the classes with a UI (ui-components, astro-site, web-app). */
const WEBTOPS_CLIENT = [
  // The scope is the client modules, not .astro frontmatter, which is server code (an Astro client
  // script block is read in the Astro rules)
  { files: TSX, plugins: { webtops }, rules: { "webtops/public-env-only": "error" } },
];

/** W-23 Tailwind class names are complete strings, in every file, for astro-site and web-app. */
const WEBTOPS_TAILWIND = [
  { plugins: { webtops }, rules: { "webtops/complete-tailwind-classes": "error" } },
];

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

/** The React plugin set; the web-app variant adds the Tailwind rule on top of the library's. */
const reactConfigs = (extra) => async () => {
  const [a11y, hooks] = await Promise.all([
    load("eslint-plugin-jsx-a11y-x"),
    load("eslint-plugin-react-hooks"),
  ]);
  return [
    // W-22 semantic elements, alt text, labels
    { files: TSX, ...a11y.configs.strict },
    ...extra,
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
};

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
    ...WEBTOPS_CLIENT,
    ...WEBTOPS_TAILWIND,
  ];
}

const PLUGIN_CONFIGS = {
  base: async () => [],
  react: reactConfigs(WEBTOPS_CLIENT),
  "react-app": reactConfigs([...WEBTOPS_CLIENT, ...WEBTOPS_TAILWIND]),
  astro: astroConfigs,
};

/** The variants a class can name: the plugin set added on top of the base law rules. */
export const VARIANTS = Object.keys(PLUGIN_CONFIGS);

const REACT_PACKAGES = [...BASE_PACKAGES, "eslint-plugin-jsx-a11y-x", "eslint-plugin-react-hooks"];

/** Every package a variant imports, so a class's tool list can be checked against it. */
export const PACKAGES = {
  base: BASE_PACKAGES,
  react: REACT_PACKAGES,
  "react-app": REACT_PACKAGES,
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
      plugins: { "@eslint-community/eslint-comments": eslintComments, webtops },
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
