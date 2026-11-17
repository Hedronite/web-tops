# W-22 proof (P3 G6)

Does a reader that runs on ESLint 10 implement every rule of `eslint-plugin-jsx-a11y` 6.10.2
that is not deprecated upstream? `run.ts` answers it with one bad and one clean fixture for each
of the 39 rules the plugin exports, through three engines: ESLint 10.15 with
`eslint-plugin-jsx-a11y-x`, `oxlint` with its jsx-a11y plugin, and a control (ESLint 9.39.5 with
`jsx-a11y` 6.10.2) that must pass all 39 rows or the fixtures are wrong. A candidate qualifies
only when every one of the 36 rules not deprecated upstream passes (a rule it does not implement
is a failing row) and both claim rows pass: the unlabeled `<input type="text">` makes a rule fire,
and an a11y rule fires on the `.astro` page through its Astro path (a candidate that does not lint
`.astro` fails that row). The verdict line is `W-22 reader: jsx-a11y-x | oxlint | none`: the first
qualifying candidate, in that order. A self-check runs every time: five planted failures (a failing
bar row, a failing claim, and the two oxlint cases) must each change the verdict as stated, or
`run.ts` fails.

```sh
cd probes/w22
bun install --frozen-lockfile
bun run.ts          # writes RESULT.json and RESULT.md, prints the table
```

- `fixtures/rules/<rule>.{bad,clean}.tsx`: the rule rows. Each rule runs at `error` with its
  default options; "fires on bad" is a message from that rule, "quiet on clean" is none.
- `fixtures/claims/`: the claim rows, which a candidate must pass to qualify: an unlabeled
  `<input type="text">` through each engine, and an `.astro` page through `eslint-plugin-astro`.
- `fixtures/observations/`: inputs run through `control-has-associated-label`, recorded and not
  in the verdict. The rule fires on a bare `<input>` and also on labeled ones (a `<label htmlFor>`
  beside it, a wrapping `<label>`, `type="submit"` with a value), because it does not follow label
  association; the plugin's own configs leave it off and ignore `input`. Only `aria-label` stays quiet.
- `fixtures/stack/`: typed rules and `eslint-comments` running on ESLint 10.
- `worker.ts` runs the ESLint engines under Node, as the protocol's R29 requires; `bun` only
  orchestrates.
- The three deprecated rules (`accessible-emoji`, `label-has-for`, `no-onchange`) keep their
  fixtures and are listed in `RESULT.md` with their upstream status and replacement
  (`label-has-for` is replaced by `label-has-associated-control`, whose row is in the bar), but
  they are outside the bar.

The control plugin is installed under the alias `jsx-a11y-control`, so that
`eslint-plugin-astro` (which prefers `eslint-plugin-jsx-a11y` when it can resolve it) finds only
the fork: the Astro claim row runs through the fork, not through 6.10.2. `oxlint` lints the
frontmatter script of an `.astro` file and not its template (a `debugger;` in a frontmatter is
reported, an `<img>` without `alt` in the template is not), so the Astro claim shows nothing for it.
