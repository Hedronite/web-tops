// Written by `webtops init`, plus one line: fixtures/ holds the counter-examples (a data tree,
// WEB_TOPS.md section 17), which their own test lints under fixtures/lint/eslint.config.js. The rules live in web-tops/eslint and stay at error.
import { eslintPreset } from "web-tops/eslint";

export default [
  { ignores: ["fixtures/**"] },
  ...(await eslintPreset({ variant: "base", tsconfigRootDir: import.meta.dirname })),
];
