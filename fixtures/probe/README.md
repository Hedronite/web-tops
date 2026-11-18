# fixtures/probe

One cheat per case: each directory is a small project that passes a check it should not, with the
real tool output recorded from it. `EXPECTED.yaml` states, for each case, the outcome section 6 of
`WEB_TOPS.md` gives.

This is data. The kit's engines are scored against `EXPECTED.yaml`, and [`SCORE.md`](SCORE.md) records the
score at the end of M2. `src/layers/probe.test.ts` holds each case's stated facts to its recordings.

| Case | The cheat | Section |
|---|---|---|
| `e2-one-line-arrow` | a one-line arrow nobody calls reads 100 % by line | 6.2 |
| `e3-v8-ignore` | a `v8 ignore` hint hides an untested throw | 6.7 |
| `e4-unimported-file` | a source file no test imports is absent from the profile | 6.1 |
| `no-coverage-survivors` | a function no test runs has only `NoCoverage` mutants | 6.4 |
| `test-only-diff` | a diff that only weakens a test | 6.4 |
| `rule-off-override` | a per-file override sets a rule to off | 6.7 |
| `stryker-disable` | a `Stryker disable` comment silences a line's mutants | 6.7 |
| `assertion-free-test` | a test that runs the code and asserts nothing | 6.4 |

One more small case per census kind the cheats above do not cover (section 6.7): `census-eslint-disable`,
`census-ts-expect-error`, `census-ts-ignore`, `census-ts-nocheck`, `census-stylelint-disable`,
`census-istanbul-ignore`, `census-c8-ignore`, `census-html-validate-disable`, `census-biome-ignore`,
`census-axe-disable-rules`, `census-axe-exclude`, `census-eslint-ignores` and `census-tsconfig-exclude`.
With `e3-v8-ignore`, `stryker-disable` and `rule-off-override`, every kind in the census table has a case,
and the test counts each case's directives and recorded facts against the census `EXPECTED.yaml` states.

## How the recordings were made

Vitest 5.1.0 with `@vitest/coverage-v8` 5.1.0, TypeScript 6.0.3 and StrykerJS 10.1.1 (Vitest runner,
TypeScript checker, per-test coverage), on Node 26. The configuration is in `_run/`. For each case:

```
vitest run --coverage --coverage.include='src/**/*.{ts,tsx}' --coverage.exclude='**/*.test.ts'
stryker run --mutate <the case's source file>      # the mutation cases only
```

The config-level cases record what the tools say, with ESLint 10.15.0 and `typescript-eslint` 8.73.0:
`rule-off-override` the effective level of the rule per file from `calculateConfigForFile`,
`census-eslint-ignores` the result of `isPathIgnored` per file, and `census-tsconfig-exclude` the files
`tsc --listFilesOnly` puts in the program.

`e4-unimported-file` is recorded twice, with and without `--coverage.include`. Absolute paths in
`coverage-final.json` were made relative, and Stryker's `system`, `framework` and `performance`
blocks were dropped, so a recording holds no machine path.
