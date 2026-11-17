import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

// Every rule below is the reader behind a judged law (WEB_TOPS.md section 8.2) and stays at
// "error". Presets are repeated here so the mapping survives a preset change.
export default defineConfig(
  {
    ignores: [
      "node_modules/",
      "coverage/",
      "dist/",
      ".web-tops/",
      ".astro/",
      // Reserved: the W-22 proof package and the deliberate cheats (WEB_TOPS.md section 6.7).
      "probes/",
      "fixtures/probe/",
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    // W-35: an unused suppression fails.
    linterOptions: { reportUnusedDisableDirectives: "error" },
    plugins: { "@eslint-community/eslint-comments": eslintComments },
    rules: {
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
      // W-13 caught values are unknown (useUnknownInCatchVariables is in tsconfig `strict`)
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
      // The ts-library CRAP cap (WEB_TOPS.md section 5.2) is 4 until the native CRAP gate lands in
      // M2; a function over 4 is split by responsibility, never exempted.
      complexity: ["error", 4],
    },
  },
  {
    // W-34 no focused or skipped tests committed
    files: ["**/*.test.ts", "**/*.test.tsx"],
    plugins: { vitest },
    rules: {
      "vitest/no-focused-tests": "error",
      "vitest/no-disabled-tests": "error",
    },
  },
  {
    // The config files are plain JavaScript outside tsconfig: no type-aware rules there.
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // CommonJS config files, such as .dependency-cruiser.cjs.
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { module: "readonly", require: "readonly" },
    },
  },
);
