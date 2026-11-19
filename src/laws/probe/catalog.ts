import type { LawSource, ProbeLaw } from "./types.ts";

/** The classes with JSX and CSS: they map W-22 and W-26 (section 5.2). */
const UI_CLASSES = ["ui-components", "astro-site", "web-app"];

/**
 * The laws the probe proves, with what each maps (WEB_TOPS.md section 8.2, the laws judged by a lint rule or a compiler
 * flag). This is the interim source: `laws/W-NN.yaml` replaces it, and the probe reads that through `LawSource`.
 *
 * W-22 and W-26 are mapped by the classes that have JSX and CSS (section 5.2): their rules live in
 * `eslint-plugin-jsx-a11y-x` and Stylelint, which a `ts-library` does not run, so the probe proves them under a class
 * that maps them (`--class`).
 */
const TABLE: readonly ProbeLaw[] = [
  {
    id: "W-01",
    proofs: [
      "no-explicit-any",
      "no-unsafe-assignment",
      "no-unsafe-member-access",
      "no-unsafe-call",
      "no-unsafe-return",
      "no-unsafe-argument",
      "noImplicitAny",
    ],
  },
  { id: "W-02", proofs: ["consistent-type-assertions", "no-non-null-assertion"] },
  {
    id: "W-04",
    proofs: [
      "strict",
      "noUncheckedIndexedAccess",
      "exactOptionalPropertyTypes",
      "noImplicitOverride",
      "noFallthroughCasesInSwitch",
      "verbatimModuleSyntax",
      "isolatedModules",
      "erasableSyntaxOnly",
    ],
  },
  { id: "W-05", proofs: ["erasableSyntaxOnly"] },
  {
    id: "W-06",
    proofs: [
      "no-unsafe-assignment",
      "no-unsafe-member-access",
      "no-unsafe-call",
      "no-unsafe-return",
      "no-unsafe-argument",
    ],
  },
  { id: "W-10", proofs: ["switch-exhaustiveness-check"] },
  { id: "W-11", proofs: ["no-floating-promises", "no-misused-promises", "await-thenable"] },
  {
    id: "W-13",
    proofs: [
      "useUnknownInCatchVariables",
      "use-unknown-in-catch-callback-variable",
      "preserve-caught-error",
    ],
  },
  { id: "W-14", proofs: ["only-throw-error", "prefer-promise-reject-errors"] },
  { id: "W-15", proofs: ["verbatimModuleSyntax", "consistent-type-imports"] },
  {
    id: "W-22",
    classes: UI_CLASSES,
    proofs: [
      "alt-text",
      "click-events-have-key-events",
      "no-static-element-interactions",
      "label-has-associated-control",
      "anchor-is-valid",
    ],
  },
  {
    id: "W-26",
    classes: UI_CLASSES,
    proofs: [
      "at-rule-no-unknown",
      "property-no-unknown",
      "block-no-empty",
      "color-no-invalid-hex",
      "unit-no-unknown",
      "declaration-block-no-duplicate-properties",
      "no-duplicate-selectors",
      "selector-pseudo-class-no-unknown",
    ],
  },
  { id: "W-34", proofs: ["no-focused-tests", "no-disabled-tests"] },
  {
    id: "W-35",
    proofs: [
      "require-description",
      "no-unlimited-disable",
      "ban-ts-comment",
      "reportUnusedDisableDirectives",
    ],
  },
];

export const interimLaws: LawSource = () => TABLE;

/** The laws a class maps: those with no class list are mapped by every class. */
export const lawsOfClass = (laws: readonly ProbeLaw[], className: string): ProbeLaw[] =>
  laws.filter((law) => law.classes === undefined || law.classes.includes(className));
