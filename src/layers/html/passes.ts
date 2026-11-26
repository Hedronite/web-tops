/** One html-validate run over every page: the law its findings break, and the whole configuration it runs with. */
export interface Pass {
  readonly law: "W-20" | "W-22";
  readonly config: {
    readonly root: true;
    readonly extends: readonly string[];
    readonly rules?: Readonly<Record<string, unknown>>;
  };
}

/**
 * The runs of WEB_TOPS.md section 7: W-20 is the WHATWG validity rules and the whole-document checks, W-22 the
 * accessibility preset on built pages. The `recommended` preset is house style and is never used.
 *
 * One option is narrowed. `require-sri` asks for `integrity` on every script and stylesheet by default, the page's
 * own included, and Astro emits none for its own `/_astro/` files, so it is asked of cross-origin files only: the
 * ones another party can change.
 */
export const passes = (): readonly Pass[] => [
  {
    law: "W-20",
    config: {
      root: true,
      extends: ["html-validate:standard", "html-validate:document"],
      rules: { "require-sri": ["error", { target: "crossorigin" }] },
    },
  },
  { law: "W-22", config: { root: true, extends: ["html-validate:a11y"] } },
];
