# W-22 proof result

eslint-plugin-jsx-a11y 6.10.2: 39 rules exported, 3 deprecated upstream, 36 in the bar.

| rule | deprecated | jsx-a11y-x bad | jsx-a11y-x clean | jsx-a11y-x | oxlint bad | oxlint clean | oxlint | control bad | control clean | control |
|---|---|---|---|---|---|---|---|---|---|---|
| accessible-emoji | yes, not in bar | n/i | n/i | n/i | n/i | n/i | n/i | fires | quiet | ok |
| alt-text |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| anchor-ambiguous-text |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| anchor-has-content |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| anchor-is-valid |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| aria-activedescendant-has-tabindex |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| aria-props |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| aria-proptypes |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| aria-role |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| aria-unsupported-elements |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| autocomplete-valid |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| click-events-have-key-events |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| control-has-associated-label |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| heading-has-content |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| html-has-lang |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| iframe-has-title |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| img-redundant-alt |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| interactive-supports-focus |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| label-has-associated-control |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| label-has-for | yes, not in bar | n/i | n/i | n/i | n/i | n/i | n/i | fires | quiet | ok |
| lang |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| media-has-caption |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| mouse-events-have-key-events |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| no-access-key |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| no-aria-hidden-on-focusable |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| no-autofocus |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| no-distracting-elements |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| no-interactive-element-to-noninteractive-role |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| no-noninteractive-element-interactions |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| no-noninteractive-element-to-interactive-role |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| no-noninteractive-tabindex |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| no-onchange | yes, not in bar | n/i | n/i | n/i | n/i | n/i | n/i | fires | quiet | ok |
| no-redundant-roles |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| no-static-element-interactions |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| prefer-tag-over-role |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| role-has-required-aria-props |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| role-supports-aria-props |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| scope |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |
| tabindex-no-positive |  | fires | quiet | ok | fires | quiet | ok | fires | quiet | ok |

- claim, unlabeled <input type=text> fires, jsx-a11y-x (ESLint 10 with the fork): control-has-associated-label, pass
- claim, unlabeled <input type=text> fires, oxlint (oxlint): nothing fired, FAIL
- claim, unlabeled <input type=text> fires, control (ESLint 9.39 with jsx-a11y 6.10.2): control-has-associated-label, pass
- claim, Astro a11y fires on .astro, jsx-a11y-x (eslint-plugin-astro on ESLint 10, via the fork): alt-text, pass
- claim, Astro a11y fires on .astro, oxlint (frontmatter script only): nothing fired, FAIL

- ESLint 10 stack, @typescript-eslint/no-floating-promises: pass
- ESLint 10 stack, @typescript-eslint/no-unnecessary-condition: pass
- ESLint 10 stack, @eslint-community/eslint-comments/disable-enable-pair: pass
- ESLint 10 stack, @eslint-community/eslint-comments/no-unlimited-disable: pass
- ESLint 10 stack, @eslint-community/eslint-comments/require-description: pass

Deprecated upstream (listed, outside the bar):
- accessible-emoji: deprecated upstream, not in the bar; here: jsx-a11y-x not-implemented, oxlint not-implemented, control pass; no replacement upstream
- label-has-for: deprecated upstream, not in the bar; here: jsx-a11y-x not-implemented, oxlint not-implemented, control pass; replaced upstream by label-has-associated-control (jsx-a11y-x pass, oxlint pass, control pass)
- no-onchange: deprecated upstream, not in the bar; here: jsx-a11y-x not-implemented, oxlint not-implemented, control pass; no replacement upstream

Self-check (a planted failure must change the verdict):
- a bar row fails on the fork: verdict none, expected none, ok
- the unlabeled-input claim fails on the fork: verdict none, expected none, ok
- the Astro claim fails on the fork: verdict none, expected none, ok
- a bar row fails on the fork and both oxlint claims pass: verdict oxlint, expected oxlint, ok
- a bar row fails on the fork and oxlint's Astro claim fails: verdict none, expected none, ok

W-22 reader: jsx-a11y-x
