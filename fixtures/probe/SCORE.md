# fixtures/probe: the M2 score

Each case in `EXPECTED.yaml` is scored against the engines the kit has at the end of M2 (the CRAP layer, the coverage layer with its hints, the diff engine, the mutation layer and the baseline ratchet). A case is **caught** when the kit gives the outcome `EXPECTED.yaml` states: the verdict it names, and under `ratchet` the refusal it names for a census count above the baseline.

**Score: 8 of 21 cases caught. All 6 cases that cheat coverage or mutation by what they run are caught; 13 cases name a suppression census kind that nothing in the kit reads yet.**

| Case | Stated outcome | The kit gives it | Held by |
|---|---|---|---|
| `e2-one-line-arrow` | `crap` fails, CRAP 20 | yes | `src/layers/crap/crap.test.ts` (reads `EXPECTED.yaml`), `src/crap/crap.test.ts` |
| `e3-v8-ignore` | coverage passes; census `v8-ignore` 1; ratchet refuses | yes: the hint is a `coverage-hint/v8` finding, and a count above the baseline is `ratchet-census-up` | `src/layers/coverage/probe.test.ts`, `src/baseline/compare.test.ts` |
| `e4-unimported-file` | coverage fails, `no-coverage-record` on the file | yes | `src/layers/coverage/probe.test.ts` |
| `no-coverage-survivors` | `mutation` fails, 6 survivors (NoCoverage counts) | yes, and with the real Stryker | `src/layers/mutation/read.test.ts`, `layer.test.ts`, `e7.test.ts` |
| `test-only-diff` | scope holds `src/sum.ts::sum`; `mutation` fails, 2 survivors | yes | `src/diff/scope.test.ts` (reads `EXPECTED.yaml`), `src/layers/mutation/read.test.ts` |
| `assertion-free-test` | coverage passes, `mutation` fails, 2 survivors | yes | `src/layers/mutation/layer.test.ts`, `read.test.ts` |
| `census-istanbul-ignore` | census `istanbul-ignore` 1 | yes: `coverage-hint/istanbul` | `src/layers/coverage/hints.ts`, run on the case |
| `census-c8-ignore` | census `c8-ignore` 1 | yes: `coverage-hint/c8` | `src/layers/coverage/hints.ts`, run on the case |
| `stryker-disable` | `mutation` passes with 0 survivors; census `stryker-disable` 1; ratchet refuses | **no**: the four `Ignored` mutants are excluded and the layer passes, but nothing counts the comment | `src/layers/mutation/read.test.ts` holds the first half |
| `rule-off-override` | census `eslint-rule-off` 1; ratchet refuses | **no**: no reader of the effective ESLint level per file | |
| `census-eslint-disable` | census `eslint-disable` 3 | **no** | |
| `census-ts-expect-error`, `census-ts-ignore`, `census-ts-nocheck` | census `ts-expect-error`, `ts-ignore`, `ts-nocheck` | **no** | |
| `census-stylelint-disable`, `census-html-validate-disable`, `census-biome-ignore` | census of each directive | **no** | |
| `census-axe-disable-rules`, `census-axe-exclude` | census of each axe setting | **no** | |
| `census-eslint-ignores`, `census-tsconfig-exclude` | census of each config-level exclusion | **no** | |

The census in M2 is the coverage hints (`v8`, `istanbul`, `c8`): protocol 0.3.0 states every kind, and the baseline holds a count per kind, but only the coverage layer reports the hints that a baseline counts (`src/baseline/census.ts`). The other 13 kinds need a reader each (the text directives, the axe and ESLint settings, the two config exclusions), and that is not in an M2 step.

## Reproduce

```
bunx vitest run src/layers/crap src/crap src/layers/coverage src/baseline/compare.test.ts \
  src/diff/scope.test.ts src/layers/mutation src/survivors src/layers/probe.test.ts
```

`src/layers/probe.test.ts` holds each case's stated facts to its recordings, so a fixture cannot drift from what it claims.
