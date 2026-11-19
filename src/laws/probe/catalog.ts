import type { LawSource, ProbeLaw } from "./types.ts";

/**
 * The laws the probe proves, with what each maps (WEB_TOPS.md section 8.2, the laws judged by a lint rule or a compiler
 * flag). This is the interim source: `laws/W-NN.yaml` replaces it, and the probe reads that through `LawSource`.
 *
 * W-22 and W-26 are ticked but have no twin yet: their rules live in `eslint-plugin-jsx-a11y-x` and Stylelint, which
 * the kit does not install, so they join when the presets that enable them land.
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
  { id: "W-06", proofs: ["no-unsafe-assignment", "no-unsafe-member-access"] },
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
  { id: "W-34", proofs: ["no-focused-tests", "no-disabled-tests"] },
  {
    id: "W-35",
    proofs: [
      "require-description",
      "no-unlimited-disable",
      "ban-ts-comment",
      "unused-disable-directive",
    ],
  },
];

export const interimLaws: LawSource = () => TABLE;
