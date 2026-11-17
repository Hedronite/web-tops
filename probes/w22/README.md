# W-22 proof (P3 G6)

Does a reader that runs on ESLint 10 implement every rule of `eslint-plugin-jsx-a11y` 6.10.2?
`run.ts` answers it with one bad and one clean fixture for each of the 39 rules the plugin
exports, through three engines: ESLint 10.15 with `eslint-plugin-jsx-a11y-x`, `oxlint` with its
jsx-a11y plugin, and a control (ESLint 9.39.5 with `jsx-a11y` 6.10.2) that must pass every row
or the fixtures are wrong. A reader passes only if every rule row passes; a rule it does not
implement is a failing row. The verdict line is `W-22 reader: jsx-a11y-x | oxlint | none`.

```sh
cd probes/w22
bun install --frozen-lockfile
bun run.ts          # writes RESULT.json and RESULT.md, prints the table
```

- `fixtures/rules/<rule>.{bad,clean}.tsx`: the rule rows. Each rule runs at `error` with its
  default options; "fires on bad" is a message from that rule, "quiet on clean" is none.
- `fixtures/claims/`: claim rows, recorded and not part of the bar: an unlabeled
  `<input type="text">` through each engine, and an `.astro` page through `eslint-plugin-astro`.
- `fixtures/stack/`: typed rules and `eslint-comments` running on ESLint 10.
- `worker.ts` runs the ESLint engines under Node, as the protocol's R29 requires; `bun` only
  orchestrates.
- The deprecated rules (`accessible-emoji`, `label-has-for`, `no-onchange`) are rule rows too.
  `RESULT.json` also gives the verdict over the other 36 rows, marked informational.

The control plugin is installed under the alias `jsx-a11y-control`, so that
`eslint-plugin-astro` (which prefers `eslint-plugin-jsx-a11y` when it can resolve it) finds only
the fork: the Astro claim row runs through the fork, not through 6.10.2. `oxlint` lints the
frontmatter script of an `.astro` file and not its template (a `debugger;` in a frontmatter is
reported, an `<img>` without `alt` in the template is not), so the Astro claim shows nothing for it.
