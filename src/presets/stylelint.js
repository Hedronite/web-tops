// The Stylelint preset behind `web-tops/stylelint` (WEB_TOPS.md sections 7 and 8.2). W-26: raw CSS
// passes Stylelint, with Tailwind 4 at-rules allowed. W-24 and W-25 are counted by the laws layer
// from this output. Plain JavaScript: the tools run under Node, which does not strip types in node_modules.
export default {
  rules: {
    "at-rule-no-unknown": [
      true,
      {
        ignoreAtRules: [
          "apply",
          "config",
          "custom-variant",
          "layer",
          "plugin",
          "reference",
          "source",
          "tailwind",
          "theme",
          "utility",
          "variant",
        ],
      },
    ],
    "block-no-empty": true,
    "color-no-invalid-hex": true,
    "declaration-block-no-duplicate-properties": true,
    "declaration-no-important": true,
    "no-duplicate-selectors": true,
    "property-no-unknown": true,
    "selector-pseudo-class-no-unknown": true,
    "unit-no-unknown": true,
  },
};
