// The kit's preset, as the exemplars are linted, plus two rules TS-POIRE proposes for it:
// method-signature-style (TS-11), and no-await-in-loop, which W-12 names but the base preset leaves off.
import { eslintPreset } from "web-tops/eslint";

export default [
  ...(await eslintPreset({
    variant: "base",
    tsconfigRootDir: import.meta.dirname,
    class: "ts-library",
  })),
  {
    rules: {
      "@typescript-eslint/method-signature-style": ["error", "property"],
      "no-await-in-loop": "error",
    },
  },
];
