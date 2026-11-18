/**
 * The exact version of every tool Web-TOPS pins (WEB_TOPS.md section 2), as read from the npm
 * registry on 2026-11-16 where section 2 gives only a minor. A tool the kit also installs must
 * match its own `package.json` (a test holds the two together).
 */
export const TOOL_PINS = {
  "@arethetypeswrong/cli": "0.18.5",
  "@astrojs/check": "0.9.12",
  "@axe-core/playwright": "4.14.0",
  "@eslint-community/eslint-plugin-eslint-comments": "4.8.1",
  "@eslint/js": "10.0.1",
  "@lhci/cli": "0.16.1",
  "@playwright/test": "1.65.1",
  "@stryker-mutator/core": "10.1.1",
  "@stryker-mutator/typescript-checker": "10.1.1",
  "@stryker-mutator/vitest-runner": "10.1.1",
  "@vitest/coverage-v8": "5.1.0",
  "@vitest/eslint-plugin": "1.6.28",
  astro: "7.4.12",
  "dependency-cruiser": "18.8.0",
  eslint: "10.15.0",
  "eslint-plugin-astro": "3.2.1",
  "eslint-plugin-jsx-a11y-x": "0.2.0",
  "eslint-plugin-react-hooks": "7.1.1",
  "fast-check": "4.10.2",
  "html-validate": "11.21.1",
  knip: "6.45.1",
  prettier: "3.10.1",
  publint: "0.3.25",
  "size-limit": "14.3.0",
  stylelint: "18.0.0",
  tailwindcss: "4.3.5",
  typescript: "6.0.3",
  "typescript-eslint": "8.73.0",
  vitest: "5.1.0",
  zod: "4.6.7",
} as const satisfies Readonly<Record<string, string>>;

export type PinnedTool = keyof typeof TOOL_PINS;

/**
 * The Node range every class's tools run in (WEB_TOPS.md section 2): where the pinned tools' engine
 * ranges meet. The lock records it as `node`; `lock --verify` and `doctor` check the running Node
 * against it.
 */
export const NODE_RANGE = "^22.23.4 || ^24.15.0 || >=26";

/**
 * The one exact Node the generated workflow installs: the latest 24.x LTS in the nodejs.org dist
 * index on 2026-11-17 (v24.22.3). `actions/setup-node` takes a version, not a range, so the range
 * above is never handed to it. A test holds it inside `NODE_RANGE`.
 */
export const NODE_CI = "24.22.3";
