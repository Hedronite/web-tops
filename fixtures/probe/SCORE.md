# fixtures/probe: the M2 score

Each case in `EXPECTED.yaml` is scored against the engines the kit has at the end of M2: the CRAP layer, the coverage layer with its hints, the suppression census readers (`src/census`), the diff engine, the mutation layer and the baseline ratchet. A case is **caught** when the kit gives the outcome `EXPECTED.yaml` states: the verdict it names, and under `ratchet` the refusal it names for a census count above the baseline.

**Score: 19 of 21 cases caught. The two that are not, `census-axe-disable-rules` and `census-axe-exclude`, name axe settings, and the axe layer that reads them is milestone M4 (R75).**

| Case | Stated outcome | The kit gives it | Held by |
|---|---|---|---|
| `e2-one-line-arrow` | `crap` fails, CRAP 20 | yes | `src/layers/crap/crap.test.ts` (reads `EXPECTED.yaml`), `src/crap/crap.test.ts` |
| `e3-v8-ignore` | coverage passes; census `v8-ignore` 1; ratchet refuses | yes: the hint is a `coverage-hint/v8` finding, and a count above the baseline is `ratchet-census-up` | `src/layers/coverage/probe.test.ts`, `src/baseline/compare.test.ts` |
| `e4-unimported-file` | coverage fails, `no-coverage-record` on the file | yes | `src/layers/coverage/probe.test.ts` |
| `no-coverage-survivors` | `mutation` fails, 6 survivors (NoCoverage counts) | yes, and with the real Stryker | `src/layers/mutation/read.test.ts`, `layer.test.ts`, `e7.test.ts` |
| `test-only-diff` | scope holds `src/sum.ts::sum`; `mutation` fails, 2 survivors | yes | `src/diff/scope.test.ts` (reads `EXPECTED.yaml`), `src/layers/mutation/read.test.ts` |
| `assertion-free-test` | coverage passes, `mutation` fails, 2 survivors | yes | `src/layers/mutation/layer.test.ts`, `read.test.ts` |
| `census-istanbul-ignore`, `census-c8-ignore` | census `istanbul-ignore` 1, `c8-ignore` 1 | yes: `coverage-hint/istanbul` and `coverage-hint/c8` | `src/layers/coverage/hints.ts`, run on each case |
| `stryker-disable` | `mutation` passes with 0 survivors; census `stryker-disable` 1; ratchet refuses | yes: the four `Ignored` mutants are excluded, and the comment is a `census/stryker-disable` finding | `src/layers/mutation/read.test.ts`, `src/census/probe.test.ts` |
| `rule-off-override` | census `eslint-rule-off` 1; ratchet refuses | yes: the effective ESLint level per tracked file, from the real ESLint | `src/census/probe.test.ts` |
| `census-eslint-disable` | census `eslint-disable` 3 | yes | `src/census/probe.test.ts` |
| `census-ts-expect-error`, `census-ts-ignore`, `census-ts-nocheck` | census of each directive | yes | `src/census/probe.test.ts` |
| `census-stylelint-disable`, `census-html-validate-disable`, `census-biome-ignore` | census of each directive | yes | `src/census/probe.test.ts` |
| `census-eslint-ignores`, `census-tsconfig-exclude` | census of each config-level exclusion | yes: ESLint's `isPathIgnored` and the program TypeScript builds | `src/census/probe.test.ts` |
| `census-axe-disable-rules`, `census-axe-exclude` | census of each axe setting | **no, M4**: the axe layer (W-21, W-44) reads them | |

The census is the coverage hints (`v8`, `istanbul`, `c8`, reported by the coverage layer) and the eleven kinds `src/census` reads: eight directive comments and three config-level kinds. The coverage layer reports them as `census/<kind>` findings, and the baseline counts them by kind (`src/baseline/census.ts`).

## Reproduce

```
bunx vitest run src/layers/crap src/crap src/layers/coverage src/census src/baseline/compare.test.ts \
  src/diff/scope.test.ts src/layers/mutation src/survivors src/layers/probe.test.ts
```

`src/layers/probe.test.ts` holds each case's stated facts to its recordings, so a fixture cannot drift from what it claims.
