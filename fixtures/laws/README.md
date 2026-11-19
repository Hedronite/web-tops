# fixtures/laws

Every law that a lint rule or a compiler flag judges has a pair of twins here: a **bad** twin that breaks it on
purpose, and a **clean** twin that does not. `webtops laws probe` lints and compiles them under the project's own
ESLint config and tsconfig, and fails a law whose reader stays quiet on its bad twin, or speaks on its clean one
(`WEB_TOPS.md` section 8.1, "Every delegated rule is proven to fire").

```
fixtures/laws/W-NN/
  bad/    files that break the law; every line that must report carries a marker
  clean/  files that keep the law; no marker, and no finding of the law's rules
```

## Markers

A `// expect: <name>[, <name>]` comment at the end of a line says what that line must report. A comment that stands
alone on its line is about the line below it: a suppression directive cannot carry a marker, because the marker would
become the directive's description.

A name is one of:

- a rule, as its plugin names it without the prefix: `no-explicit-any` for `@typescript-eslint/no-explicit-any`,
  `require-description` for `@eslint-community/eslint-comments/require-description`, `no-fallthrough` for the core rule;
- a compiler flag, such as `erasableSyntaxOnly` or `noUncheckedIndexedAccess`: the line must report a diagnostic that
  flag raises (`src/laws/probe/proofs.ts` has the codes);
- `unused-disable-directive`, for ESLint's report of a directive nobody needs (W-35).

A file whose name starts with `_` only supports the twins beside it (a type to import). It carries no marker and is
judged like the rest: it must report nothing of the law.

## What the probe fails

| Failure | Meaning |
|---|---|
| `silent` | a marked name did not report on its line: the reader is off, or the twin does not break the rule |
| `unexpected` | a rule of the law reported on a bad twin line that no marker names |
| `noisy` | a rule of the law reported on a clean twin: the reader is too loud |
| `unproven` | the law maps a rule or flag that no bad twin marks |
| `no-bad-twin`, `no-clean-twin`, `no-marker`, `marker-in-clean` | the pair is incomplete or mis-marked |

A finding on a twin that no rule of the law explains and no marker names is counted, and never fails the law.

## Writing a pair

1. Write the bad twin first. Break the law, put a marker on each line that must report, and break one thing at a time:
   a flag shared with another flag's code (`noUncheckedIndexedAccess` and `strictNullChecks` both raise `TS18048`) needs a
   twin that compiles with the other on.
2. Write the clean twin as the same code, done right. Keep it free of every marker.
3. Make each file an ES module (it imports or exports), so the twins do not share globals in the one compile.
4. Run `webtops laws probe --law W-NN`.

The twins are data. The kit's own lint, type and format checks skip this directory, because a bad twin is broken on
purpose, and the probe copies the twins into `.web-tops/out/laws-probe/` and reads them there with `--no-ignore`.

## Classes, and the tools a twin needs

`webtops laws probe` proves the laws the project's class maps (`--class`, else `class` in `web-tops.yaml`, else
`ts-library`), or the one law `--law W-NN` names, whatever the class. W-22 and W-26 are mapped by `ui-components`,
`astro-site` and `web-app`, so a `ts-library` does not probe them: their rules live in `eslint-plugin-jsx-a11y-x` and
Stylelint, which that class does not run.

- A `.ts` or `.tsx` twin is linted and compiled once, with the whole probe. ESLint is told to ignore nothing
  (`--no-ignore`), so a project's own `ignores` do not hide a twin.
- A `.css` twin is read by Stylelint under the project's own config, with an empty ignore file. Its marker is a block
  comment: `/* expect: block-no-empty */`.
- A `.tsx` twin is compiled under the project's tsconfig. A project with no JSX types reports the elements as compiler
  findings that no rule of W-22 explains; the probe counts them as unrelated and never fails the law for them.

The laws that no lint rule or flag judges (dependency-cruiser, `publint`, `attw`, the audit, the secrets scanner, the
lock, `knip`) are proven by their own planted violations, not by twins; the Astro rules have `.astro` twins in G5.
