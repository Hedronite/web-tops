# Web-TOPS: Web Testing and Optimization Protocol Suite

**Spec status:** Draft 0.3.0 · **Date:** 2026-11-17 · **Owner:** Hedronite
**Supersedes:** the TS-TOPS 0.1.0 sketch (renamed: the protocol covers the web stack, not only TypeScript)
**Modeled on:** [Rust-TOPS](https://github.com/Hedronite/rust-tops) and [Go-TOPS](https://github.com/Hedronite/go-tops) 0.3.0

> **How to read this.** Web-TOPS reuses the shape of Rust-TOPS and Go-TOPS: a written spec, a
> JSON Schema, per-class profiles, an orchestrator CLI, a CI floor, and a laws layer. It starts
> from Go-TOPS 0.3.0, so the review fixes made there apply from day one: one CRAP cap per class,
> `not-run` fails, ratchet for adopters, laws check that their tool config is live, no formal
> layer. Values labeled **proposed** are defaults to tune on real code. **[verify]** marks a tool
> behavior or flag not yet confirmed at pin time. Versions in §2 are npm `latest` as read on
> 2026-11-16, except where §2 says why a pin holds back. 0.2.0 folds in what the first adopter,
> LuminosiTS, proved in practice (§20). 0.2.1 adds what the M1 configuration schema needed:
> `enabled` and `reason` on every gate and layer, a coverage exclusion key, and run counts in the report. 0.3.0 gives the report one verdict vocabulary, required items and the shape the M2 baseline reads.

---

## 1. What Web-TOPS is

**Web-TOPS** is a protocol and drop-in kit for web work that is correct, dense, accessible and
fast. **TypeScript is the foundational language.** HTML, CSS, Tailwind CSS and Astro complement
it:

| Layer | Role | Ships to the browser as |
|---|---|---|
| TypeScript | Logic, data, types; build-time frontmatter and client islands | JavaScript, or nothing |
| HTML | Structure and semantics | HTML |
| CSS | Presentation | CSS |
| Tailwind CSS | Utility classes, design tokens via `@theme` | Only the CSS that is used |
| Astro | Components, routing, build; zero JS by default | HTML, CSS, and island JS |

It has three parts: the written spec (this document, `WEB_TOPS.md`), a JSON
Schema (`schema/web-tops.schema.json` plus a gate-report schema), and per-class profiles
(`profiles/*.yaml`). There is also a practice layer in `AGENTS.md` and an orchestrator CLI,
**`webtops`**.

### 1.1 Goals

- Make "done" measurable: a change is acceptable when the gate passes, and the gate is the same
  for humans and agents.
- **Judge what ships.** The browser receives HTML, CSS and JavaScript, not `.astro` or `.tsx`.
  The gate checks the source (types, lint) *and* the build output (HTML validity, accessibility,
  bytes per page).
- Catch what coverage cannot: complexity-weighted risk (CRAP) and mutation survival on changed
  code.
- Encode the web stack's real hazards as checkable **laws**: TypeScript escape hatches,
  unvalidated external data, floating promises, inaccessible markup, Tailwind classes built at
  runtime, and JavaScript shipped where none was needed.
- Be hermetic: pinned tools, frozen lockfile, reproducible results.
- Be honest: a layer that was not evaluated is reported as not evaluated, never as a pass.

### 1.2 Non-goals

- Not a test framework. Web-TOPS runs Vitest, Playwright, Stryker and friends; it does not
  replace them.
- Not a style guide. Formatting belongs to Prettier or Biome; Web-TOPS only requires that the
  check passes.
- Not a design system. The protocol enforces correctness, density, accessibility and budgets,
  never an aesthetic. Visual language belongs to the project (see §20).
- Not a replacement for review.

### 1.3 Name and binary

- Protocol: **Web-TOPS**. Binary: **`webtops`**. Repo: `github.com/Hedronite/web-tops`.
- Bun installs dependencies and starts `webtops`: `bunx webtops gate`, or a workspace script.
  The tools the gate runs (Vitest with v8 coverage, ESLint, Stylelint, Stryker, `html-validate`,
  dependency-cruiser, Playwright) are Node programs, so every class needs Node in the range §2
  pins. Vitest supports v8 coverage only on Node; on Bun its counts differ.

---

## 2. Pins

| Item | Value |
|---|---|
| Protocol version | **0.3.0** (draft) |
| Package version | 0.4.0 (private; a GitHub release, not published to npm) |
| TypeScript | **6.0.x** pinned (6.0.3 current); the gate runs the pin, and `erasableSyntaxOnly` needs 5.8 or later. See below |
| Runtime | Bun ≥ 1.4 installs and runs `webtops`; Node `^22.23.4 \|\| ^24.15.0 \|\| >=26` runs the tools, in every class (where the pinned tools' engine ranges meet). The range is recorded in `web-tops.lock` (§10) and in `engines` of the kit's `package.json`, beside Bun |
| Tool lock | `web-tops.lock`; dependency lock `bun.lock`, installed with `--frozen-lockfile` |
| Lint | `eslint` **10.15**, `@eslint/js` 10.0, `typescript-eslint` 8.73, `eslint-plugin-astro` **3.2**, `eslint-plugin-jsx-a11y-x` 0.2, `@eslint-community/eslint-plugin-eslint-comments` 4.8 |
| Law readers | Beyond the lint row: `@vitest/eslint-plugin` 1.6 (W-34), `fast-check` 4.10 (property tests, §7), `eslint-plugin-react-hooks` 7.1.1 (W-47), `knip` 6.45.1 (W-48); the secrets scanner (W-39) is `secretlint` 14.0.1 with `@secretlint/secretlint-rule-preset-recommend` 13.1.0; the internal link check (§7) is native over parsed `dist/` |
| Rule tests | ESLint's own `RuleTester`, exported by `eslint` (no extra pin), run under Vitest for the custom rules of `eslint-plugin-webtops` (§8.1) |
| Tests and coverage | Vitest 5.1, `@vitest/coverage-v8` 5.1 |
| Mutation | StrykerJS 10.1 (`@stryker-mutator/core`, `vitest-runner`, `typescript-checker`) |
| Astro, Tailwind, validation | Astro 7.4, `@astrojs/check` 0.9, Tailwind CSS 4.3, Zod 4.6 |
| Build output | `html-validate` 11.21.1, `@playwright/test` 1.65.1, `@axe-core/playwright` 4.14.0, Stylelint 18.0.0 with `postcss-html` 2.0.1 (the `<style>` blocks of `.astro` files), `size-limit` 14.3.0, `@size-limit/file` 14.3.0, `@lhci/cli` 0.16 (tier 2) |
| Boundaries and packages | `dependency-cruiser` 18, `publint` 0.3, `@arethetypeswrong/cli` 0.18 |
| Format | Prettier 3.10 or Biome 2.6, one per repo |

**Why TypeScript 6.0 and not 7.0.** `typescript` 7.0.2 (the native compiler) is npm `latest`.
But `typescript-eslint` 8.73 declares `typescript >=4.8.4 <6.1.0`, and `@astrojs/check` 0.9
declares `^5.0.0 || ^6.0.0`. The laws layer depends on type-aware lint, so the gate's type
checker is the pinned 6.0.x. A TypeScript 7 `tsc --noEmit` leg may be added as advisory for
speed (§16, open). The pin moves when both peers accept 7.

**Why secretlint.** W-39 needs a secrets scanner that installs from npm, so `web-tops.lock` can pin it, and that runs under Bun and under the Node range on both CI legs. `secretlint` 14.0.1 (`node >=22`) with `@secretlint/secretlint-rule-preset-recommend` 13.1.0 carries its rules in one JavaScript package: no binary download and no network. The kit's tests run it under Node and under Bun: it exits 1 on a secret, exits 0 on clean text, and masks the secret in its output. Its test patterns are documented fakes, never real secrets: the sample secret access key of the AWS documentation (the same page's `AKIAIOSFODNN7EXAMPLE` pair is on the rule's allow list, so it is not a probe). `gitleaks` and `trufflehog` are Go binaries outside npm: the lock cannot pin them, and Bun does not run them.

**Why ESLint 10.** ESLint 10.15 is npm `latest`. 0.1.0 pinned it beside `eslint-plugin-jsx-a11y` 6.10
and `eslint-plugin-astro` 3.2, and that set cannot install: `jsx-a11y` 6.10.2, still its latest,
declares `eslint ^3 || … || ^9`, and `eslint-plugin-astro` 3.x requires `eslint >=10`. W-22's reader
is therefore `eslint-plugin-jsx-a11y-x` 0.2 (`eslint ^9 || ^10`, an optional peer of
`eslint-plugin-astro` 3.2), the fork of `jsx-a11y`. `probes/w22/` is the proof: through the fork
on ESLint 10, every `jsx-a11y` 6.10.2 rule that upstream has not deprecated fires on its bad fixture
and stays quiet on its clean one, and both claim rows pass (an unlabeled `<input type="text">`, and
the Astro a11y rules on an `.astro` fixture). `typescript-eslint` 8.73 and `eslint-plugin-eslint-comments` 4.8 accept ESLint 10, and
`@eslint/js` 10 adds three recommended rules (`no-unassigned-vars`, `no-useless-assignment`,
`preserve-caught-error`), at `error`. `eslint-plugin-jsx-a11y` is not pinned: it does not run on
ESLint 10.

Protocol and package versions are separate planes. A protocol change bumps the protocol version
and the schema together.

---

## 3. Protocol model

### 3.1 Gate order

Gates run in this order. A failing gate stops the run unless `--keep-going` is set.

| # | Gate | Command(s) | Pass condition |
|---|---|---|---|
| 1 | **Hygiene** | `bun install --frozen-lockfile`; `tsc -b --noEmit` (pinned 6.0) **[verify `-b` with `--noEmit`]**; `astro check` (Astro projects, §9); `eslint` type-aware, once, JSON output; `stylelint` on CSS and `<style>` blocks; format check; `dependency-cruiser`; `publint` and `attw` on the packed tarball (package classes); dependency audit | All clean; no high or critical advisory in production dependencies |
| 2 | **Tests** | **one run**: `vitest run --coverage --sequence.shuffle --sequence.seed <n>`; the gate passes the seed, the v8 provider, the coverage `include` and `exclude`, the `json` + `lcov` coverage reporters, the reports directory, Vitest's default reporter beside `json`, and the JSON results path (`--outputFile.json`) itself; it runs Vitest through a kit config that drops the project's coverage thresholds (§6.1) | All pass; no focused or skipped tests; zero tests is a failure; Vitest's own run failure (an unhandled error) fails too. Judged from the JSON results and the exit code (§6.1) |
| 3 | **Coverage** | from the run in gate 2; **`test -s`** on the LCOV | Profile non-empty; class floor or ratchet met |
| 4 | **CRAP** | native CRAP over the LCOV and the TypeScript AST (§6.2) | Cap or ratchet met |
| 5 | **Mutation (diff)** | Stryker on lines changed against the merge base (§6.4) | Unexplained survivors ≤ max |
| 6 | **Build output** | `astro build` or `vite build`, then on `dist/`: `html-validate`, axe via Playwright, internal link check, bytes per page or route, `size-limit` per package entry | Per class (§7) |
| ★ | **Laws** | maps findings from gates 1 and 6 to law IDs, then runs the custom `webtops` rules (§8) | No `refuse` or `ack-missing`; `not-evaluated` never counts as a pass and fails on a required law |

★ The laws layer runs at the tier of the layers it reads (tier 1: gates 1 and 6) and executes
last. It does not run ESLint, tsc or Stylelint a second time: it reads the JSON those tools wrote
in gate 1. A gate that fails stops every later layer except this one: once hygiene has run, the
laws layer still judges what ran (§6.5).

**Tools and hand-offs.** Every tool resolves from the project's own `node_modules` (the
installed package's `bin`), never from `PATH`. A tool not installed there is missing: its layer
is `fail` (a tool error, §3.3), and the tool is not started. The runtimes are the exception: `bun` (install, audit)
and `node` come from `PATH`. `gate` exits 3 when Bun is below the §2 floor; `doctor` and
`lock --verify` check Node against the lock's range (§10), and CI pins an exact Node inside it
(§11). `gate` clears `.web-tops/out/` before the first layer, so no layer judges an earlier run's
artifact. Each layer declares the artifacts it produces and the ones it consumes, writes
them under `.web-tops/out/<layer>/`, and lists them in the report's `artifacts`; gate 3 consumes
the LCOV gate 2 produced. A layer whose input is missing because its producer failed or did not
run is `not-run` with reason `input <artifact> missing: <layer> <verdict>`. A layer whose input
exists is judged even when its producer failed (with `--keep-going`); the producer's failure
still fails the run.
A layer may declare an input optional: the runner passes it when the producer left it and skips it
when not, and the layer says what a missing one means for what it judges. The laws layer reads
`audit-json`, `install-json`, `publint-json`, `attw-json` and `dependency-cruiser-json` this way: a law
whose tool's artifact is missing is `not-evaluated`, and when the law is required that fails the run.

### 3.2 Tiers

| Tier | Purpose | Contents |
|---|---|---|
| **0** | Floor | Config, schema, lock and config liveness checks |
| **1** | **Merge gate** (default) | Gates 1–6, and the laws layer that reads them |
| **2** | Deep / nightly | Full-repo mutation; Lighthouse CI (median of several runs); visual regression; Playwright on Chromium, WebKit and Firefox |
| **3** | Release | `publint` and `attw` on the release tarball; changesets; provenance |

### 3.3 Verdicts

One vocabulary, lower case and hyphenated, for layers, laws and findings alike. This table is
the **shared-core seam** (X1): `schema/core.schema.json` holds the same eight verdicts, the
enforcement modes and the ends-the-run column as data, and the gate report and the config schema
reference it. No other section defines a verdict.

| Verdict | Meaning | Ends the run non-zero |
|---|---|---|
| `pass` | Evaluated and satisfied | no |
| `fail` | A threshold missed: a coverage floor, a CRAP cap, a survivor count, a byte budget, a failing test, a tool error | **yes** |
| `refuse` | A hard law or rule broken | **yes** |
| `ack-missing` | A soft rule broken with no recorded acknowledgement (`// webtops-ack W-NN: reason` or the ledger). An acknowledged one is `pass` with `ack` | **yes** |
| `skip` | The class does not map the item, or config sets `enabled: false` with a `reason` (§9) | no; printed with the reason |
| `not-run` | Enabled but no command is mapped, the run stopped before it, or its input is missing (§3.1); the reason says which | **yes** |
| `not-evaluated` | The reader or tool could not judge for a reason outside the project, or a law that is not required has its tool rule or flag off or below `error` (§8.1) | **yes** when the item is `required`; otherwise counted and printed |
| `vacuous` | Evaluated over nothing, such as an empty mutation diff | no; printed, and never a pass for any law |

**Required.** Every in-range layer is required. A law is required when §8.2 marks it judged (✓)
and the class maps it (§5.2). A class profile may mark a layer or law optional, with a reason; no
launch profile does. A required law whose tool rule is off or below `error` is `refuse`, with the
config line that disabled it, not `not-evaluated`.

**`fail` or `not-evaluated`.** `fail` is for a tool that ran, or should have, and reports or causes
a failure: a missed threshold, a failing test, a missing tool (§3.1), a crash, a run with no
results file (§6.1), empty output where output is required, or a layer that throws.
`not-evaluated` is only for a judgment that cannot be made for a reason outside the project: an
unreachable network service such as an audit registry, a law with no reader yet, a law judged
only by attestation, or a law that is not required whose tool rule or flag is off or below
`error`.

**Which verdict, and what counts.** A layer gets `skip` when `web-tops.yaml` sets
`enabled: false` (the reason is the config's), or when its class profile does not map it (the
reason names the class). Otherwise a layer with no command, or with a missing input (§3.1), is
`not-run`. A layer is **in range**
when it is enabled, mapped by the class, at or below `--max-tier`, and named by `--only` when
`--only` is given. `skip` layers are never in range. A layer has **run** when its verdict is `pass`,
`fail`, `refuse`, `ack-missing`, `not-evaluated` or `vacuous`; `not-run` and `skip` have not. The
run fails when fewer layers ran than are in range.

### 3.4 Stated rules

1. **Oracle first.** Write the oracle from the contract before the code.
2. **Scar-guard.** Do not split functions only to lower a CRAP score.
3. **Do not weaken a law**, lint setting, tsconfig flag or budget so a check passes.
4. **Schema precedence.** Fix the schema first, then the prose.
5. **No silent empties.** An empty LCOV, report, test run or build output fails.
6. **No dry gates in CI.** `--dry-run` is refused when `CI=true`.
7. **Judge what ships.** Browser-facing checks run on the build output.
8. **One gate.** `webtops gate` is the verification command. Running its tools separately is
   not "done".
9. **Explain every accepted mutation survivor**, with a reason, an owner and an optional expiry.
10. **Every suppression names its rule and a reason** (W-35). No `@ts-ignore` or `@ts-nocheck`.
11. **Agent-authored code meets the same gate and the same cap** as human code.
12. **Do not edit generated files.** Fix the generator.
13. **Prefer deleting code to adding configuration.**
14. **Never edit `.web-tops/baseline.json` by hand**, and never wrap old findings in suppressions to
    zero a count.

---

## 4. Quick start

```bash
bunx webtops init --class astro-site
bunx webtops check
bunx webtops gate
```

`init` writes:
- `web-tops.yaml`, `web-tops.lock`;
- thin importers, with the rules in the kit's presets and none in the project: `tsconfig.strict.json`
  (extends `web-tops/tsconfig/strict.json`), `eslint.config.js` (calls `web-tops/eslint` with the
  class's variant: base, react or astro), `stylelint.config.js` (re-exports `web-tops/stylelint`) and
  `.dependency-cruiser.cjs` (requires `web-tops/depcruise`); and `stryker.config.json` once the
  mutation layer ships;
- the class CI workflow, with the jobs whose commands exist (§11);
- the Web-TOPS section of `AGENTS.md`. If `AGENTS.md` exists, `init` replaces only the text
  between `<!-- web-tops:begin -->` and `<!-- web-tops:end -->`. The section names only the
  commands this kit version has and the layers the written config enables; it claims no check
  that does not run.

`init` writes `enabled: false` for layers the class does not map. It never writes a baseline;
only `webtops baseline` does (§6.7). It refuses to overwrite without `--force`.

---

## 5. Classes and profiles

### 5.1 Class catalog

| Class | Typical code | Launch profile? |
|---|---|---|
| `ts-library` (default) | Pure TypeScript package; no DOM or JSX dependency | **Yes** |
| `ui-components` | TSX (React) or `.astro` component packages; dual entries such as `.` and `./react` | **Yes** |
| `astro-site` | Astro site: content, marketing, docs; static or hybrid | **Yes** |
| `web-app` | Interactive app: Vite + React SPA, or Astro SSR with islands | **Yes** |
| `node-service` | API or backend on Bun or Node | **Yes** |
| `cli` | Command-line tool | No |
| `workspace-root` | Bun workspace / Turborepo root; checks boundaries, delegates to members | No (high priority) |
| `config-only` | Schema or configuration packages | No |

The TS-TOPS sketch's `monorepo-package` is dropped: a package in a monorepo has the class of what
it is, and the root is `workspace-root`. `react-component` is folded into `ui-components`, and
`app` is split into `astro-site` and `web-app`, because a content site and an interactive app
have different budgets.

### 5.2 Proposed floors by class

| | `ts-library` | `ui-components` | `astro-site` | `web-app` | `node-service` |
|---|---|---|---|---|---|
| Line coverage floor | 85% | 80% | 70% | 70% | 80% |
| CRAP cap | 4 | 5 | 6 | 6 | 5 |
| `unexplained_survivors_max` | **0** | 1 | 2 | 2 | 1 |
| Package exports (`publint`, `attw`) | tier 1 | tier 1 | no | no | no |
| `size-limit` per entry | required | required | no | no | no |
| HTML validity, axe, links | no | on fixture pages | required | required | no |
| JS per page or route (brotli) | n/a | n/a | 0 KB unless the page has islands; ≤ 50 KB with | ≤ 170 KB per route | n/a |
| Extra laws | W-18 | W-18, W-22, W-37, W-47; W-27 when Astro | W-20–W-31, W-37, W-42–W-46, W-47, W-49 | W-20–W-29, W-37, W-42–W-46, W-47; W-27 when Astro | W-06 strict |
| Required layers | hygiene, tests, coverage, crap, mutation, build-output, laws | hygiene, tests, coverage, crap, mutation, build-output, laws | hygiene, tests, coverage, crap, mutation, build-output, laws | hygiene, tests, coverage, crap, mutation, build-output, laws | hygiene, tests, coverage, crap, mutation, laws |

There is one CRAP cap per class, the same for every author; there is no per-author cap. The cap
binds new and changed functions: under `ratchet` (§6.7) it applies to them, and the ratchet holds
legacy functions at their baseline, so they must not get worse.
All numbers except the caps are **proposed**.
The caps were measured in M2.5 over LuminosiTS and the kit, and kept. `ts-library` keeps 4: the kit
meets it, and 162 of the 194 sampled library functions do (83.5 %), against 173 at 6.
`ui-components` keeps 5: 90.9 % of its functions pass at 4, 93.5 % at 5 and 97.4 % at 6. `web-app`
keeps 6: 71 of 126 functions pass at 6 and the same 71 at 8, so a higher cap admits nothing today.
`astro-site` and `node-service` keep theirs: the sample has 6 functions, none with coverage, for
the first, and none for the second.
A function counts as §6.3 says, with callbacks folded into their container.
A second adopter, an `astro-site` with tests or a `node-service` reopens the question.

**Required.** A class requires every built-in layer it maps (§3.3): the gates, `crap`, `mutation`
and `laws`, and build output only where the class maps a build-output layer. It requires the judged
laws it maps (§8.2, the tick column): the laws no class gates, plus its "Extra laws" row, with
W-27 only when the project depends on Astro. `W-06 strict` for `node-service` is a reading of W-06,
which every class maps, as it does W-48 (unused exports, files and dependencies). A law a class maps but that has no reader yet (W-42 to W-48) is
required when it is judged. Under `hard`, `check` refuses a coverage floor below, and a CRAP cap or
`unexplained_survivors_max` above, the class's value in this table (§9, §12).

Coverage counts `.ts` and `.tsx` modules. `.astro` components are judged by `astro check`,
`html-validate`, axe, and W-31, which moves frontmatter logic into testable modules.

---

## 6. Scoring and reporting

### 6.1 Coverage

- From the single Vitest run in gate 2 (v8 provider), LCOV plus JSON. Workspace packages merge
  into one profile.
- Excluded by default: `*.d.ts`, test files (`*.test.*`, `*.spec.*`), generated code, `.astro/`
  type output, config files. Anything
  else is excluded only by an explicit, reasoned entry in `web-tops.yaml` (`gates.coverage.exclude`, §9).
- An empty or missing profile fails.
- A coverage hint (`v8 ignore`, `istanbul ignore`, `c8 ignore`) removes lines from the profile,
  so the floor never sees them. The suppression census (§6.7) counts each one.
- The gate, not the project's Vitest config, chooses what is measured. It passes
  `--coverage.include` (the class source globs; `src/**/*.{ts,tsx}` for the launch classes),
  `--coverage.exclude` (the defaults above plus `gates.coverage.exclude`; a test helper that is
  not a `*.test.*` file needs a reasoned entry there),
  `--coverage.reporter=json --coverage.reporter=lcov` and
  `--coverage.reportsDirectory=.web-tops/out/tests/coverage` (the `tests` layer produces the LCOV, §3.1). Every tracked file the include selects,
  less the exclusions, has an `SF:` record in the LCOV; a missing record fails the coverage layer,
  because a file no test imports would otherwise leave the denominator. The floor comes from the
  class profile, or the baseline under `ratchet`, never from `thresholds` in the Vitest config.
  The floor is computed over in-scope records only; any other `SF:` record is ignored. The
  `tests` layer is judged from Vitest's JSON results (every test passed, none focused or skipped,
  more than zero), so a project `thresholds` miss does not fail it. The gate runs Vitest with a
  kit config, written to `.web-tops/out/tests/vitest.config.mjs`, that loads the project's Vitest
  config and removes `test.coverage.thresholds` whole, so no threshold form (global keys, glob
  keys, `100: true`) can make Vitest exit non-zero. The exit code then tells the rest apart. With no
  results file, the run crashed. With results that show no failing test and a non-zero exit, Vitest
  failed the run itself, for example on an unhandled rejection or an error thrown after a test
  ended: the `tests` layer is `fail` with reason `vitest-run-failed`, quoting Vitest's stderr. The
  gate runs Vitest's default reporter beside `json`, so that stderr names the error.

### 6.2 CRAP

```
CRAP(f) = comp(f)² × (1 − cov(f))³ + comp(f)          cov(f) ∈ [0,1]
```

- Native, so the formula, the counting rule and the caps are under protocol control. No mature
  TypeScript CRAP tool exists; existing ones are cross-checks at most.
- `cov(f)` is **statement coverage inside the body of `f`**, read from `coverage-final.json`
  (the `json` reporter of gate 2, §6.1). It is the fraction of the statements that start inside
  `f`'s span with a non-zero hit count; the statements of a nested function count in the function
  that contains it (§6.3). **When `f`'s own hit count is 0, `cov(f)` is 0**, whatever else shares its
  line. A body with no statement is 1 when the function ran and 0 when it did not.
- The LCOV stays the interchange format and the package line floor (§5.2), but it does not score a
  function. A declaration runs when its module loads, so a one-line arrow that nothing calls reads
  100% by line and 0 by statement: with complexity 4 its CRAP is 20, not 4.
- A function is keyed as §6.7 says: file, container chain, name.
- **Cap:** one per class (§5.2). Drop-in default 6.0. No authorship marking.
- **Scope:** the functions the diff touches (`gates.crap.scope: diff`, the default), or every function with
  `--all` or `gates.crap.scope: all`, for tier 2 trends and for a kit that holds itself to the cap. The functions are
  those the diff engine reports as changed (§6.4): a changed line, or a deletion taken from them. A diff that touches
  no function is `vacuous`, and a diff that cannot be computed fails the layer.
- **Unit:** the counter's scored unit (module-level functions and class members, §6.3); its `cov(f)` is read from
  the coverage function whose body starts in it. Code outside every function is scored as `<module>` only when it
  branches. A function the coverage run never reported has `cov(f) = 0`.
- Under `ratchet` the layer is `not-evaluated` until a baseline exists (§6.7); a function over the cap still fails.

### 6.3 Complexity counting rule

Counted from the TypeScript AST, McCabe style:

- **+1 each:** `if`; the conditional operator `?:`; each non-`default` `case`; `for`, `for…in`,
  `for…of`, `while`, `do`; `catch`; `&&`; `||`; `&&=`; `||=`.
- **Not counted:** `default:`, so an n-way `switch` adds n − 1.
- **Nested functions** (arrow callbacks, function expressions) count in the function that
  contains them, so a callback is not a place to hide branches. Module-level functions and
  class methods are scored on their own.
- **Templates:** a ternary or `&&` inside JSX or an Astro template counts in its component.

**Nullish handling is weight 0.** `??`, `??=` and `?.` are TypeScript's safe way to handle
`undefined`, and `noUncheckedIndexedAccess` produces many of them. Counting them would make the
banned shortcuts, `!` and `as`, cheaper than handling the case. The profile key
`complexity.nullish_discount` defaults to **`true`** in every class. Rust-TOPS learned this from
`?`, and Go-TOPS from error guards.

### 6.4 Mutation

- **Engine:** StrykerJS with the Vitest runner and per-test coverage, run on the gate's own Vitest config (§6.2: the project's, coverage thresholds removed) and on a Stryker config the gate writes for each run, never the project's. The TypeScript checker plugin
  drops mutants that do not type-check: their status is `CompileError`, and they are neither killed
  nor counted as survivors.
- **Scope:** the lines changed against the merge base, **plus every function covered by a changed
  test file at the merge base or at HEAD**, so a change that only weakens a test, or drops the call
  to a function, is mutated. `webtops` computes the line ranges and passes them as Stryker `mutate`
  entries, `file:start-end` (confirmed on Stryker 10.1.1). It maps each changed test file to the
  functions it covers by running the changed test files under Vitest, with the gate's own configuration
  (the project's, coverage thresholds removed) and the gate's coverage include and exclude (§6.1),
  once for the versions at HEAD and once for the versions at the merge base, each in one run of up to 100 files (a function
  is covered when any file ran it; a group whose run gives nothing runs file by file, so the file that cannot run is
  found); a deleted test file is in the second only. The functions that ran are added, with their whole ranges. Each range is then widened to the scored units it reaches into (§6.7), and a range that touches module-level code to all of the file's module-level lines, so the occurrence in a survivor's key does not depend on the diff. A HEAD version that
  cannot run is `fail`; a merge-base version that cannot run against HEAD adds nothing. The diff is
  taken without rename detection, so a renamed file counts as new and every function in it is
  judged. A pure deletion belongs to the smallest function that holds the lines on both sides of
  it, else to the file's `<module>` (§6.7). The data trees of §17, `fixtures/` and `probes/` at the top of the tree, are
  not part of the diff: a file changed under them is neither mutated nor run, because it breaks rules on purpose. Nor
  is a file under `examples/<name>/` when that folder holds its own `web-tops.yaml`: such an example is a project that
  gates itself, with its own tools and tests. Any other file under `examples/` is part of the diff.
- **Statuses.** Stryker's status of each mutant decides what counts:

| Status | Counts as |
|---|---|
| `Killed`, `Timeout` | killed |
| `Survived`, `NoCoverage` | survivor |
| `CompileError`, `RuntimeError`, `Ignored` | excluded |

  `NoCoverage` counts with `Survived`: a function that no test runs has only `NoCoverage` mutants,
  and counting `Survived` alone would score it best. Stryker classes `CompileError` and `RuntimeError` as invalid mutants, so both are
  excluded. A status the table does not list makes the layer `fail`, with that status in the reason.
- **Timeouts.** A mutant that Stryker stops as timed out counts as killed (the table above), but a run in
  which more than a tenth of the judged mutants, and more than two, timed out is `not-evaluated`, with
  "N of M mutants timed out: the machine was starved or a mutant looped" as the reason and the rule
  `mutation-timeouts`; a survivor still fails the layer. A starved machine times out the mutants a weak test would
  have let live, and a pass from such a run proves nothing. The gate sets Stryker's `concurrency` to the CPUs the
  process can use (`os.availableParallelism()` and a control-group CPU limit, whichever is less) minus one, at least
  one, and `timeoutFactor` to 3, and `dryRunTimeoutMinutes` to 15, because the initial test run is the whole suite in
  one runner with per-test coverage and a shared CI runner can pass the default five minutes. The message of the layer counts the mutants by every status (§6.6 `metrics.mutation`).
- **Diff outcomes:** a diff that fails (no merge base, shallow clone) is `fail`, with no
  exemption. A diff with no changed source line and no function covered by a changed test is
  `vacuous` (§3.3); a diff that changes only tests is not. CI checks out with `fetch-depth: 0`.
- **Survivors** are killed by a new test or listed in `.web-tops/survivors.yaml` with `reason`,
  `owner` and optional `expires`. Only unexplained survivors count.
- **Survivor key.** A survivor is keyed by `file`, `function` (the §6.7 key), `mutator`,
  `original`, `replacement` and `occurrence`: the 1-based order, in source order, of the same
  mutator, original and replacement within that function. Never by Stryker's mutant id, which is a
  run ordinal, and never by a line number, so a ledger entry survives edits elsewhere in the file.
  A ledger entry carries those six fields beside `reason`, `owner` and `expires`.
- **Time budget.** `gates.mutation.time_budget_minutes`, 30 by default (applied per shard when sharded): the largest M2 diff, about 1,330
  mutants, fit on both CI legs. The budget sits under the 45-minute job limit, so an over-budget run reports
  `not-evaluated` and does not become a cancelled job; a project that raises its budget raises its job limit
  with it. The kit's own gate runs 4 shards with a 30-minute per-shard budget under a 45-minute job limit. A run that passes the budget is stopped, with the
  processes it started, and the layer is `not-evaluated`, with the budget in the reason: a stopped run writes no
  report, so it names no count of mutants judged. A run cut short is never a pass.
- **Sharding.** Large suites may partition mutation across up to 4 shards (`--shard i/n`, 4 by default in the kit's workflow) and unify them with `--join <dir>`:
  - `shardOf(entries, i, n)` splits the snapped `mutate` entries (`file:start-end`) deterministically by line weight, heaviest first on the lightest shard, never cutting a scored unit so survivor `occurrence` keys match an unsharded run.
  - Under `--shard i/n`, layers 1–4 run in full, layer 5 runs Stryker only on shard `i` and writes `.web-tops/out/mutation/partial.json` carrying `shard`, `shards`, `base`, canonical `entriesHash`, status counts, raw survivors, and timeout/starvation/vacuous state. Per-shard runs never write `.web-tops/baseline.json` or `.web-tops/survivors.yaml` and do not judge per-shard survivors against `unexplained_survivors_max` alone.
  - Under `--join <dir>`, the gate fails closed on any missing or duplicate shard, mismatched `n`, mismatched `base`, or mismatched `entriesHash`; sums all status counts; applies the timeout starvation rule to the summed counts and propagates any shard `not-evaluated` (timeout or starvation); unions survivors; and evaluates `.web-tops/survivors.yaml` and `unexplained_survivors_max` once.

### 6.5 Law verdicts

Laws use the §3.3 vocabulary. `refuse` and `ack-missing` fail; `not-evaluated` fails when the law
is `required` by the class and is counted otherwise; it is never a pass. The report names each
law's reader. A law runs at the tier of the layer it reads (§3.2). Under `ratchet`, `refuse` means
a finding above the baseline (§6.7); under `hard`, any finding is `refuse`.

The laws layer reads what gate 1 wrote and runs no tool again. For each law it takes the readings of every tool the
law maps and the worst of them is the law's verdict; a tool with no reader is `not-evaluated` for the law, and a law
passes only when every reader passes. The ESLint reader reads each tracked TypeScript and `.astro` file's effective
configuration (`eslint --print-config`, for every file in one process), so a per-directory override is seen, and a
required rule that an override sets to `off` or `warn` is `refuse` at the config line that does it (X3), for a law of
severity `R`, and `ack-missing` for one of severity `A`. A rule is judged over every file that sets it, so a rule only
`.astro` files carry, such as the Astro laws' rules, is judged on them. For a file type the project has none of, such
as `.tsx` in an astro-site, ESLint is asked about a probe path of that type under `src/`, and a rule the config holds at
`error` there passes with a note that says it was judged on a probe path; the note is the difference from a silent pass.
A page's script blocks are linted as files of their own (`page.astro/0.ts`, `page.astro/0.js`), and the rules the preset
sets for client scripts are set on those paths, so ESLint is asked about them for each tracked `.astro` file, and for a
probe page (`src/__webtops_probe__.astro`) when the project has none; a rule below `error` on one is `refuse` at the
config line that does it, and a refusal that rests on a probe path names it as the probe path of its type, never as a
real file.
A script block has no type information, so a rule whose own metadata says it needs types (`requiresTypeChecking`) says
nothing about a script-block path, and is judged on every other path as any rule is; a rule that needs no types is judged
on script blocks too.
A rule no file and no probe path has at `error` is `refuse` as not enabled; this includes a config whose block for a type
matches no path under `src/` (a `files` pattern such as `app/**/*.tsx`) in a project with no file of that type. A project whose ESLint config reaches no
TypeScript or Astro file is `not-evaluated`, never a pass. The compiler reader reads every
checked tsconfig project, `tsconfig.json` and the projects it references, through the `extends` chain: `strict` must
be on, no member of its family may be `false` beside it, and every flag W-04 lists must be set. File-set completeness: a checked project is `tsconfig.json` and the projects it references, followed
transitively, and nothing else; a nested tsconfig that no reference reaches is not checked, and its files are in no
project. A tracked source file (`.ts`, `.tsx`, `.mts`, `.cts`) in no checked project's program is `refuse` at that
file. The same holds for ESLint, over `.ts`, `.tsx`, `.mts`, `.cts` and `.astro` files: a tracked source file that no config block reaches, or that an `ignores` entry drops,
is a `refuse` file-set finding, because no lint law judges it. A nested project reaches ESLint through its own
`eslint.config`, which ESLint looks up from each file's directory: ESLint finds the nearest config for each file, so a nested `eslint.config.js` governs its folder, and law-diff reads each tracked file, so it sees a nested config that is weaker than the root's. The data trees `fixtures/` and `probes/`
(section 17) are the only exemption from both, fixed here and in the code; no ESLint `ignores` entry, no `exclude`
and no configuration adds to it. A rule entry of a law may list `classes`, a subset of the law's: a rule outside the run's class is neither required nor refused, so a project is not refused for a rule that holds for another class only. A compiler diagnostic that names a flag (`TS7005` and `TS7006` for
`noImplicitAny`, and so on; gate 1 writes them as the `tsc-diagnostics` artifact) refuses the laws that map that flag:
a live flag with a failing diagnostic is never a pass. A code that many errors share names no flag.

A stopped run still judges the laws over what ran. The laws layer runs after a stop once hygiene
has run and counts as ran, and `webtops gate` prints its findings as a laws mapping that names
the layers it read from, beside the later layers that are `not-run` with `stopped: gate <n> failed`.

### 6.6 Report

`webtops gate` always writes `.web-tops/report.json` and prints text. The schema is
`schema/gate-report.schema.json`. Every layer is present; `skip` carries a reason; `not-run`
fails; `not_evaluated` is counted on its own. The report counts the layers in range and the
layers that ran; fewer ran than are in range fails the gate (§3.3, §11).

The report holds `protocol`, `class`, `enforce`, `enforced` (false only under `advisory`),
`max_tier`, `only` (or null), and `counts` with `in_range`, `ran`, `failed` and `not_evaluated`.
`failed` counts every verdict §3.3 marks as ending the run; `not_evaluated` is counted apart,
and fails the gate only on a required item.
Each entry in `layers` has `id` (`hygiene`, `tests`, `coverage`, `crap`, `mutation`,
`build-output`, `laws`, or a `custom` id), `gate`, `tier`, `verdict` and `findings`. A finding
has one shape in every layer: `tool`, `rule`, `law`, `verdict`, `message`, `file`, `line` and
`fingerprint`.

- `tool` is the tool that said it, from a closed set: `astro`, `attw`, `audit` (`bun audit`),
  `biome`, `bun` (install and pack), `dependency-cruiser`, `eslint`, `knip`, `prettier`, `publint`,
  `secretlint`, `stryker`, `stylelint`, `tsc` and `vitest`; `webtops` is the gate's own checks (coverage, a missing tool,
  a skipped step).
- A finding of the mutation layer may carry `survivor`: the six fields of its key (§6.4), which the survivor ledger matches it by. No other layer's finding has one.
- `rule` is the tool's rule id, or a kit id for a check of the gate's own. `law` is the `W-NN` the
  finding maps to, or `null` until a reader maps it (§8). `file` and `line` are `null` when the
  finding has no place, and a `line` has a `file`.
- `fingerprint` is the finding's key: `fp1:` and 16 hex characters of SHA-256 over `tool`,
  `rule`, `file`, an anchor and an occurrence. The anchor is the text of the flagged line, trimmed
  and with its whitespace collapsed (the message when the finding has no readable line), and the
  occurrence is the 1-based order, by line, among findings with the same tool, rule, file and
  anchor. It does not use the line number or the message, so it survives lines added or removed
  elsewhere in the file, a change of indentation and a reworded message; it changes when the
  flagged line, the file, the rule or the tool changes. A renamed file is a new finding. The `fp1`
  prefix names the algorithm. The baseline and the ratchet key a finding by it (§6.7).
- The report keeps every finding. The text report prints the first 100 of a layer's findings and
  says how many more there are, and folds the passing census findings (`census/<kind>`, one for each
  hit) into one line for each kind with its count, which it does not count toward the 100.

Verdicts are
spelled as in §3.3: `pass`, `fail`, `refuse`, `ack-missing`, `skip`, `not-run`, `not-evaluated`, `vacuous`. `skip` and
`not-run` carry a `reason`. A stopped run's `not-run` reason is `stopped: gate <n> failed`. An
acknowledged soft-rule finding is `pass` and carries `ack: { source: comment | ledger, reason }`;
an unacknowledged one is `ack-missing`. The report may carry more fields (run timing, artifact paths, the exit
code); `schema/gate-report.schema.json` lists every field, and the fields above are required.
The `tests` layer also carries `seed`, the shuffle seed the gate passed, and `run.seed` repeats it.
To replay a shuffled failure, rerun the suite with that seed: `vitest run --sequence.shuffle
--sequence.seed <run.seed>` gives the same order.

From 0.3.0 the report is the source the baseline is projected from, so it carries:

- `report_version`, the report format's own semver, separate from `protocol`; it was `1.0.0`
  for the shape above, `2.0.0` once findings had one shape, `2.1.0` once a mutation survivor carried an optional `survivor` object, `2.2.0` once the report said `crap_scope`, and is `2.3.0` once the mutation layer carried a count for each Stryker status, and is `2.4.0` since the report says how many laws were judged. It changes only when the report's shape does, so a protocol patch that leaves the report alone does not change it;
- `crap_scope`, `all` or `diff`: whether the CRAP layer judged every function, under `--all` or
  `gates.crap.scope: all`, or only the ones the diff changed;
- `subject`, the package and the root the run judged: `{package, root}`, the root being the
  project's directory relative to the git top level (`.` at the top level);
- `run`: git SHA, `bun` and `node` versions, the version of every tool that ran, read from its
  package in `node_modules`, and the shuffle seed. A value that could not be read (not a git
  repository, no `bun` on `PATH`) is `null` and changes no verdict, and `tools` lists only the
  tools whose version was read;
- on each layer, `required` (from the class profile, §5.2) and the §3.3 verdict; a law finding
  carries `required` too;
- on each layer, `metrics` shaped for `webtops baseline`: per function `{file, name, line,
  complexity, coverage, crap}` for CRAP; per file `{file, lines_found, lines_hit}` for coverage;
  per rule per file `{rule, file, count}` for findings, counted from the layer's own findings and never
  set by the layer (a count that differs from its findings fails the report); per page `{route, bytes}` for build
  output; one count for each Stryker status, `{killed, timeout, survived, no_coverage, runtime_error, compile_error, ignored}`, for mutation, so a status that reads differently on another machine is seen. A layer that has no metrics yet carries an empty object, never absent, and a layer carries only
  the metrics of its own kind: `crap` on the CRAP layer, `coverage` on coverage, `findings` on
  hygiene and laws, `mutation` on the mutation layer, `pages` on build output.

`.web-tops/baseline.json` is a projection of this report and takes no other input: CRAP per
function, coverage per package, finding counts per rule per file with the `fp1` of each counted
finding, suppression counts by census kind (§6.7) and bytes per page, with the report's
`report_version` and `subject` (`fixtures/report/shape/` holds an example of each).
The baseline holds every function, so it is projected from a run whose `crap_scope` is `all`.
`schema/baseline.schema.json` defines it, and it is written in one canonical form: sorted keys,
two-space indent, a trailing newline, so a regeneration with no change is no diff. The coverage
layer reports each coverage hint as a `coverage-hint/<kind>` finding (`v8`, `istanbul` or `c8`) with
tool `webtops`, verdict `pass`, a file, a line and an `fp1`, and the baseline counts those by kind
(`v8-ignore`, `istanbul-ignore`, `c8-ignore`).

The report carries `laws` when the laws layer ran: `{ class, of, judged, refused, not_evaluated }`, "N of M laws judged"
for the class. M (`of`) is the required laws the class maps, and N (`judged`) the ones a reader judged (`pass`, `refuse`
or `ack-missing`); `refused` and `not_evaluated` count those verdicts among them. The layer writes one finding for every
law it maps, rule `law/W-NN`, tool `webtops`, with the law's verdict and `required`, and `laws` is exactly the count of
those findings: a report whose `laws` differs from them fails validation, so any reader of the report can recount it.
A required law that no reader judged is `not-evaluated` and ends the run, so N below M fails the gate. The text report
prints `laws: N of M judged (class)`.

`counts` gains `required_not_evaluated`. `failed` counts every verdict §3.3 marks as ending the
run, a required `not-evaluated` included; `not_evaluated` counts every `not-evaluated`, and
`required_not_evaluated` the required ones, so a required one is counted in all three.

### 6.7 Enforcement modes

The top-level key `enforce` sets how floors and caps apply. Adopters default to `ratchet`.
Web-TOPS runs `hard` on itself.

| Mode | What fails |
|---|---|
| `hard` | Any function in scope above the cap; coverage below the floor; any finding; any budget overrun |
| `ratchet` | A new function above the cap; an existing function above its baseline; package coverage below its baseline; a per-rule, per-file finding count that rises; a page or route over its baseline bytes; a suppression count of any census kind that rises |
| `advisory` | Nothing; needs a dated exemption, and the report prints the run as not enforced |

Baseline rules:

- `.web-tops/baseline.json` holds CRAP per function, coverage per package, finding counts per
  rule per file, bytes per page or route, and suppression counts by census kind (below).
- Only `webtops baseline` writes it, from the last report, made at `HEAD` on a clean tree (the
  gate's own `.web-tops/` output aside). It refuses a config that runs `hard`, whose gate reads no
  baseline, a result that is looser than the baseline already there, and a report whose
  `crap_scope` is `diff`: the CRAP and coverage in it come from `gate --all` (with `--keep-going`, so that every layer runs), so that it holds
  every function and a legacy function over the cap is held at its CRAP, not judged new.
- Once a baseline exists, only a passing report replaces it. With none yet, the first baseline may
  come from a report that did not pass, if its only failures are what a baseline holds: a function
  over the CRAP cap, coverage under the floor, counted findings, a census count or unexplained
  survivors. A crashed or unrun layer, failing or missing tests, a tool that could not run, or a
  run that did not finish is refused. `check` allows `ratchet` with no baseline only in that
  state, and names `webtops gate --all --keep-going` and
  `webtops baseline`; deleting a baseline the merge base
  had is not that state, and fails. The file is tracked and clean against `HEAD`.
- Under `ratchet` with a baseline, the coverage, CRAP and mutation layers report what they
  measured without their absolute floor or cap, and the ratchet decides: coverage below its
  baseline, a new function over the cap, a function above its baseline CRAP. With no baseline yet
  they judge as under `hard`. Mutation stays diff-scoped: a survivor in a function that was never
  mutated is judged against the ledger only, and a legacy survivor outside the diff is not counted.
- The same holds for the layers that count findings, hygiene and laws: under `ratchet` with a
  baseline, a counted finding (a tool's own, with a file) at or under its baseline count per rule
  per file does not end the run, and a count above it is refused as `ratchet-findings-up`. Each
  finding stays in the report as the tool said it, because the baseline is projected from them,
  and the layer says how many it held (`ratchet-held`). A failure that is not a counted finding,
  such as a tool that cannot run, a config error or a step that failed, still fails. With no
  baseline yet, they fail as under `hard`.
- Its refusal for a work tree that is not clean names the uncommitted files.
- Across a change the baseline may only tighten. `check` under `ratchet` compares it with
  the merge base's copy: a higher finding count, a function with worse CRAP, lower coverage, a census count
  that rose or a new function above the class cap fails, so regenerating the baseline cannot
  launder a rise, and deleting it fails. The first baseline, with none at the merge base, is
  accepted: legacy findings stay in it. A shallow clone or a missing base is `fail`, as for the diff
  (§6.4).
- Under `ratchet`, what a run has above the baseline is a `refuse` finding on the layer it belongs
  to (`ratchet-crap-new`, `ratchet-crap-up`, `ratchet-coverage-down`, `ratchet-findings-up`,
  `ratchet-census-up`, `ratchet-pages-up`), and the run fails. The baseline's history is checked at
  the start of `gate`, as `check` does.
- Package coverage is compared exactly, as lines hit over lines found, with no tolerance. A census
  count that rises fails; the `fp1` of each directive names the new ones, and a directive that only
  moves to another line keeps its entry. A count per rule per file, not the fingerprints, decides
  a finding: one fixed and another added in the same file is a count that has not risen. Only
  findings whose verdict ends the run are counted; a `pass` finding, such as an explained
  survivor, is not.
- **A function is keyed by its file, its container chain and its name**: the file path, then the
  enclosing classes, namespaces and functions from the outside in, then the function's own name,
  taken from its declaration, its method or property name, or the variable it is bound to. An
  anonymous function takes its parent's key plus an ordinal, the 1-based order among that parent's
  anonymous functions in source order. Module top-level code is one pseudo-function per file, named
  `<module>`. A renamed function is new. A new file starts at 0 findings; a deleted file's
  allowance does not move.
- Legacy findings stay in the baseline. They are not wrapped in suppressions to zero the count.

**Suppression census (normative).** Every way to pass a gate without fixing the cause is counted
by kind. Each kind is counted, reported, held in the baseline and ratcheted: a count that rises
fails under `ratchet`.

| Kind | What is counted |
|---|---|
| `eslint-disable` | each ESLint directive comment that turns a rule off (block, `-line`, `-next-line`) |
| `ts-expect-error`, `ts-ignore`, `ts-nocheck` | each directive |
| `stylelint-disable` | each directive comment |
| `v8-ignore`, `istanbul-ignore`, `c8-ignore` | each coverage hint |
| `stryker-disable` | each `Stryker disable` comment |
| `html-validate-disable` | each html-validate disable directive |
| `biome-ignore` | each `biome-ignore` comment |
| `axe-disable-rules`, `axe-exclude` | each rule in `disableRules`; each selector in `exclude` |
| `eslint-ignores` | each tracked file in scope that an ESLint `ignores` entry leaves out |
| `eslint-rule-off` | each (rule, tracked file in scope) pair whose effective level, from ESLint's `calculateConfigForFile`, is `off` while the rule is on for another tracked file with the same extension: a per-file override that sets a rule off. A rule that is on only for files of another extension, as typed rules are on for `.ts` and off for `.js`, is not one |
| `tsconfig-exclude` | each tracked file in scope that `tsconfig.json` `exclude` leaves out of the program |
| `webtops-ack` | each comment that starts with `webtops-ack`, in any comment form of §8.1, well formed or not, and each entry of the ack ledger (§8.1) |

A rule that is off everywhere is not a census item: for a required law it is `refuse` (§8.1).

---

## 7. Build-output and class layers

| Layer | Tool | What fails | Tier |
|---|---|---|---|
| `.astro` type check | `astro check` | Any error | 1 |
| HTML validity | `html-validate` on `dist/**/*.html`, with the presets `html-validate:standard` and `html-validate:document` | Any error | 1 |
| Accessibility | axe-core via Playwright, on every built page (`astro-site`) or the declared routes (`web-app`), with the tags and the `target-size` rule set out below | Any serious or critical violation; moderate ones are ratcheted. An `incomplete` result is `not-evaluated` | 1 |
| Internal links | native check over parsed `dist/` (internal links, fragment anchors, local `src`/`href` assets) | A broken internal link, fragment anchor, or missing local asset | 1 |
| Bytes per page or route | `webtops` reads the page JavaScript (below) from `dist/` and compresses it with brotli | Over the class or page budget | 1 |
| Package entry size | `size-limit` per `exports` entry | Over budget | 1 |
| Package exports | `publint`, `@arethetypeswrong/cli` on the packed tarball | Any error | 1 |
| Property tests | `fast-check` in Vitest | Per class: schemas, parsers, registries | 1 |
| Lighthouse | `@lhci/cli`, median of N runs | Advisory, unless run on dedicated hardware | 2 |
| Rendered checks | Playwright on the declared routes at a desktop width and at 320 CSS px, once with `prefers-reduced-motion: reduce` emulated (`web-app`, `astro-site`) | W-43 to W-46 | 1 |
| Theme contrast | `webtops` reads the project's theme tokens and the color pairs its markup uses, and measures each pair in every theme and color scheme | W-42 | 1 when the project declares themes |
| Visual regression | Playwright screenshots | Opt-in per project | 2 |
| Cross-browser e2e | Playwright: Chromium, WebKit, Firefox | Any failure | 2 |
| Custom | `layers.custom: [{ id, command, tier, report }]` | Same rules: missing tool fails, empty report fails, unmapped is `not-run` | declared |

**Budgets are bytes, not scores.** Byte counts from `dist/` are the same on every run, so they
can gate a merge. Lighthouse scores vary between runs and machines, so they gate nothing at
tier 1. Rust-TOPS uses Callgrind instruction counts for the same reason.

**HTML presets.** W-20 runs `html-validate:standard`, the WHATWG validity rules, plus
`html-validate:document`, the whole-document checks (`missing-doctype`, `heading-level`,
`no-missing-references`, `input-missing-label`, `require-sri`). `require-sri` MUST be run for
cross-origin files only (`target: crossorigin`): a page's own scripts and stylesheets need no
`integrity`, so compiled Astro output passes untouched with its `/_astro/` files. The default `recommended` preset adds
house-style rules (`no-inline-style`, `void-style`, `attr-quotes`, `no-trailing-whitespace`) that say
nothing about validity, so it is not used. The `html-validate:a11y` preset also runs on built pages,
and its findings are W-22's.

**Page JavaScript** is what a page makes the browser run, read from `dist/` and never from a
browser:

- the body of every inline `<script>` that holds JavaScript (a `type` of `application/json`,
  `application/ld+json` or `importmap` is data and is not counted);
- every external `<script src>`;
- every `<link rel="modulepreload">` target;
- the static import closure of each of these: every module reached by `import … from`,
  `export … from` or a bare `import "…"`, followed through `dist/` until no new file appears.

Each file counts once per page. Its size is the brotli size at quality 11 with a window of 22 bits,
the same bytes on Bun and Node. A dynamic `import()` is not in the closure: the chunk it names is a
lazy chunk.

**Route JavaScript** (`web-app`) is measured in a browser. Headless Chromium loads each declared
route, and the route's JavaScript is every script of its own origin that it requests while it loads,
with the inline scripts of its document, each sized from `dist/` as above. A lazy chunk therefore
counts in full toward each route that requests it, and a chunk two routes request counts toward
both. The load ends once the network has been quiet for 500 ms: a chunk requested only on an
interaction, or after that quiet, is not counted.

**axe.** The run is limited to the tags `wcag2a`, `wcag2aa`, `wcag21aa` and `wcag22aa`.
`target-size` (impact `serious`, tag `wcag22aa`) is off by default, so the run enables it by id. A
result axe lists under `incomplete` is one it could not decide: it is `not-evaluated`, counted in the
report, and never `pass`.

Project-specific budgets, such as polygon counts and texture sizes for 3D assets, are custom
layers (§20).

**Canvas and WebGL pages under Playwright.** Headless Chromium on CI has no GPU. Pages that
draw with WebGL need `--use-angle=swiftshader --enable-unsafe-swiftshader`, and their first
frame is slow enough that CI needs longer expect and test timeouts than a laptop. WebGPU needs
a secure context and an adapter, so a CI run on `localhost` or plain HTTP exercises a
renderer's WebGL 2 fallback. A project that renders with WebGPU states which backend its gate
proves; proving WebGPU needs a runner with an adapter (§16, open).

**Why rendered checks and a theme matrix.** axe on one page in one theme misses what LuminosiTS
found in practice: a canvas that kept animating under reduced motion, 13 px checkbox targets,
and two color pairs that failed contrast in 1 to 4 of 30 theme schemes while passing in the
default one. Each needs the page laid out, or every theme measured, not the source alone.

---

## 8. The Laws layer

### 8.1 Model

Laws are numbered rules, `W-NN`. Most are delegated to a tool the stack already has: TypeScript
compiler flags, `typescript-eslint`, `eslint-plugin-astro`, `jsx-a11y`, Stylelint,
`dependency-cruiser`, `html-validate`, axe. The rest are custom rules in `eslint-plugin-webtops`
or `webtops` readers. There is no formal (Bend or Lean) layer.

Readers:

- **`tl`** (tool): mapped from that tool's JSON output. A `tl` reader reads the tool's
  effective configuration first (`tsc --showConfig`, `eslint --print-config`,
  `stylelint --print-config`). With the rule or flag off or below `error`, the law is `refuse`
  when it is required (§3.3), and the finding carries the config line that turns it off or lowers
  it; when it is not required, the law is `not-evaluated`. It is never `pass`.
- **`an`** (analyzer): a custom `webtops` rule or reader.
- **`at`** (attested): judged by review; `not-evaluated` until attested.
- **`tbd`**: not yet implemented; `not-evaluated`.

Every delegated rule is proven to fire. `fixtures/laws/W-NN/{bad,clean}/` holds a pair of twins per
law: the bad twin breaks each enabled rule on purpose, with an `// expect: <rule>` marker on the
line, and the clean twin stays quiet. A test fails if a marked rule stays quiet on the bad twin or
an unmarked one fires. Custom ESLint rules are tested with ESLint's `RuleTester`.

**Acknowledgements.** A soft law (**A**, §8.2) that a file breaks is `ack-missing` unless the break is acknowledged, and an acknowledged break is `pass` and carries `ack: { source, reason }` (§3.3, §6.6). There are two forms:

- **A comment** in the file: `// webtops-ack W-NN: reason`, or the same text in a block, CSS or `<!-- -->` comment. It covers a finding of that law on its own line or on the line below it. The reason holds a letter or a digit.
- **A ledger entry** in `.web-tops/acks.yaml` (`laws.ack_ledger`, §9), which `schema/acks.schema.json` defines: `version: 1` and `acks`, each entry with `law`, `file`, `reason` and `owner`, and an optional `expires` (`YYYY-MM-DD`, UTC, valid through that day). It covers every finding of that law in that file; a file has one entry for each law. An expired entry acknowledges nothing.

An acknowledgement fails, with a finding at its comment line or ledger file, when it gives no reason (`ack-no-reason`), does not read as above (`ack-malformed`), names a hard law (**R**), whose break is `refuse` and which nothing turns into a pass (`ack-not-needed`), or names no law (`ack-unknown-law`); an unreadable ledger fails too (`ack-ledger-unreadable`). `webtops check` reads the ledger and reports each of these for its entries (exit 2), and `webtops acks` lists them for the comments too (exit 1), and marks a ledger entry `expires YYYY-MM-DD` or `expired`. A ledger file that is empty, or only comments, is an empty ledger. An acknowledgement of a hard law or of an id that is no law acknowledges nothing, whoever reads it. Acknowledgements are a suppression census kind, `webtops-ack` (§6.7): each comment and each ledger entry is counted, one of a hard law or of an id that is no law too though it acknowledges nothing, and baseline and ratchet hold the count. The gate reads the ledger the config names, or `.web-tops/acks.yaml`, whether or not the laws layer is enabled; one that cannot be read is a failing `ack-ledger-unreadable`. A law that an ESLint rule judges inside ESLint (W-28) honours an acknowledgement by suppressing its own finding, so the report carries no `ack` for it; the comment or ledger entry still counts in the census.

### 8.2 Law catalog (draft: 49 laws, W-01…W-49)

Severity: **R** = a break is `refuse`, **A** = a break needs an acknowledgement or is `ack-missing`. ✓ = judged in v0.1. Law IDs from the TS-TOPS sketch
(T-NN) are noted where they map. Laws added after W-46 take the next number; ids are not renumbered by
family before the 1.0 freeze.

These tables are generated from `laws/W-NN.yaml` (§8.3). Edit the file, not the table, then run
`webtops laws sync`; `webtops laws sync --check` and the kit's tests fail when they differ.

**Types**

| ID | Law | Sev | Reader | v0.1 |
|---|---|---|---|---|
| W-01 | No `any`, explicit or implicit, and no unchecked flow of an `any` value (T-01) | R | tl: `no-explicit-any`, `no-unsafe-assignment`, `-member-access`, `-call`, `-return`, `-argument`; `noImplicitAny` | ✓ |
| W-02 | No type assertions (`as`, `<T>x`) and no non-null `!`; `as const` is allowed (T-02) | R | tl: `consistent-type-assertions` (`assertionStyle: "never"`), `no-non-null-assertion` | ✓ |
| W-03 | User-defined type guards and assertion functions (`x is T`, `asserts x is T`) are derived from a schema or covered by a property test. The compiler trusts them like an `as` | A | an | |
| W-04 | Strict tsconfig: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`, `erasableSyntaxOnly` (T-03). `strict: true` beside a strict member set to `false` is `refuse` | R | an: reads every flag's resolved value through the `extends` chain, not `strict` alone; `tsc --showConfig` omits defaults and keeps `strict: true` beside a disabled member | ✓ |
| W-05 | No `enum`, `namespace` or parameter properties: only erasable syntax (T-04, now mechanical) | R | tl: `erasableSyntaxOnly` | ✓ |
| W-06 | External data is validated at the boundary: `response.json()`, `JSON.parse`, `FormData`, storage, `postMessage`, env (T-05) | R | tl: `response.json()`, `JSON.parse` and `MessageEvent.data` return `any`, so W-01's `no-unsafe-*` refuses unvalidated use. `FormData.get`, `Storage.getItem`, `URLSearchParams.get` and `process.env` are typed `string \| null` or `string \| undefined`, not `any`, so no rule sees them: `[review]`. an: env reads only through a schema (`astro:env` or a Zod module) | ✓ |
| W-07 | Derived types (`Pick`, `Omit`, `Partial`, `z.infer`) over duplicated shapes (T-06) | A | at | |
| W-08 | `satisfies` for literal config and route tables (T-07) | A | at | |
| W-09 | No unnecessary type parameters; no conditional-type chains deeper than 2 (T-08) | A | tl: `no-unnecessary-type-parameters`; an | |
| W-10 | `switch` over a union is exhaustive | R | tl: `switch-exhaustiveness-check` | ✓ |

**Async and errors**

| ID | Law | Sev | Reader | v0.1 |
|---|---|---|---|---|
| W-11 | No floating or misused promises; `await` only thenables (T-11) | R | tl: `no-floating-promises`, `no-misused-promises`, `await-thenable` | ✓ |
| W-12 | Concurrency is bounded: no `Promise.all` over input of unbounded size; independent awaits are not serialized in a loop | A | tl: `no-await-in-loop`; an | |
| W-13 | Caught values are `unknown` and narrowed, including `.catch` callbacks; a rethrow keeps `{ cause }` (T-10) | R | tl: `useUnknownInCatchVariables` (in `strict`), `use-unknown-in-catch-callback-variable`; `preserve-caught-error`, a core rule that `@eslint/js` 10 recommends at `error` | ✓ |
| W-14 | Only `Error` objects are thrown or used as rejections | R | tl: `only-throw-error`, `prefer-promise-reject-errors` | ✓ |

**Modules and boundaries**

| ID | Law | Sev | Reader | v0.1 |
|---|---|---|---|---|
| W-15 | Type-only imports are `import type` or inline `type` (T-09 and T-12, merged: `verbatimModuleSyntax` makes them the same check) | R | tl: `verbatimModuleSyntax`, `consistent-type-imports` | ✓ |
| W-16 | No import cycles; declared package boundaries hold | R | tl: `dependency-cruiser` | ✓ |
| W-17 | No deep imports into another package's internals (`pkg/dist/…`); imports go through `exports` | R | tl: `dependency-cruiser` | ✓ |
| W-18 | Published packages resolve and type every `exports` entry, including dual entries such as `.` and `./react` | R | tl: `publint`, `attw` | ✓ |
| W-19 | Optional peers (React, R3F) are imported only from entries that declare them | R | tl: `dependency-cruiser` | ✓ |

**HTML and accessibility**

| ID | Law | Sev | Reader | v0.1 |
|---|---|---|---|---|
| W-20 | Built HTML is valid | R | tl: `html-validate` on `dist/` | ✓ |
| W-21 | No serious or critical axe violations on built pages | R | tl: axe via Playwright | ✓ |
| W-22 | Interactive elements are semantic, images have `alt`, and a `<label>` is tied to its control | R | tl: `eslint-plugin-jsx-a11y-x` and `eslint-plugin-astro` a11y rules (§2; proof in `probes/w22/`); on built pages, `html-validate:a11y` and axe | ✓ |

**What W-22's lint rules prove about labels.** `label-has-associated-control` checks that a `<label>` has a control. It does not check that a control has a label. `control-has-associated-label` fires on a bare `<input type="text">`, but it also fires on labeled inputs, because it does not follow label association: a `<label htmlFor>` beside the input, a wrapping `<label>` and `type="submit"` with a value all trip it (`probes/w22/`, observations). The plugin's own configs leave it off and ignore `input`, and the template does the same. Whether a form control has a name is judged on the built page, by `html-validate:document` (`input-missing-label`) and axe (W-21).

**CSS and Tailwind**

| ID | Law | Sev | Reader | v0.1 |
|---|---|---|---|---|
| W-23 | Tailwind class names are complete strings. No class token built by interpolation (`` `bg-${c}-500` ``): Tailwind never sees it, and it is missing in production | R | an: custom ESLint rule | ✓ |
| W-24 | Arbitrary values (`w-[437px]`) and `!important` are counted and ratcheted | A | an; Stylelint `declaration-no-important` | |
| W-25 | Colors and spacing come from theme tokens (`@theme`), not raw hex in markup or CSS | A | an; Stylelint `color-no-hex` | |
| W-26 | Raw CSS passes Stylelint, with Tailwind 4 at-rules allowed | R | tl: Stylelint | ✓ |

**Astro**

| ID | Law | Sev | Reader | v0.1 |
|---|---|---|---|---|
| W-27 | `.astro` files type-check | R | tl: `astro check` | ✓ |
| W-28 | Islands ship JavaScript only when needed: `client:load` needs an ack; prefer `client:visible`, `client:idle`, or no directive | A | an | |
| W-29 | Each page or route stays within its JS and CSS byte budget | R | an: `dist/` reader | ✓ |
| W-30 | Images go through `astro:assets` (`<Image>`, `<Picture>`) with dimensions | A | an | |
| W-31 | Frontmatter logic beyond 10 statements moves to a `.ts` module, where it can be tested | A | an | |
| W-49 | Astro components use the Astro API correctly: no deprecated APIs, conflicting directives or exports from components | R | tl: `eslint-plugin-astro` `recommended` | |

**Tests, suppressions, security, build**

| ID | Law | Sev | Reader | v0.1 |
|---|---|---|---|---|
| W-32 | Oracle-first: tests derive from the contract, not the function body | A | at | |
| W-33 | Tests are deterministic: fake timers, no live network, seeded randomness | R | an (heuristic) | |
| W-34 | No focused or skipped tests committed | R | tl: `@vitest/eslint-plugin` (1.6) `no-focused-tests`, `no-disabled-tests` | ✓ |
| W-35 | Every suppression names its rule and says why: `eslint-disable` with a description, `@ts-expect-error` with a description, no `@ts-ignore` or `@ts-nocheck`; unused directives fail | R | tl: `eslint-comments/require-description`, `no-unlimited-disable`; `ban-ts-comment` (`allow-with-description`); `reportUnusedDisableDirectives: "error"`. The suppression census in §6.7 lists every kind that is counted and ratcheted | ✓ |
| W-36 | No `set:html`, `dangerouslySetInnerHTML` or `innerHTML` with unsanitized input | R | an | |
| W-37 | Only public env reaches client code (`PUBLIC_` vars, `astro:env` client fields) | R | an: custom ESLint rule, on `**/*.{jsx,tsx}` and `.astro` client script blocks (frontmatter is server code) | |
| W-38 | No high or critical advisories in production dependencies | R | tl: dependency audit **[verify `bun audit` output]** | ✓ |
| W-39 | No secrets in source or fixtures | R | tl: secrets scanner **[verify]** | |
| W-40 | `bun.lock` is committed and installs with `--frozen-lockfile` | R | tl | ✓ |
| W-41 | Installed tool versions match `web-tops.lock` | R | an | ✓ |

**Rendered interface** (added in 0.2.0; judged once M5's rendered layer and theme reader land)

| ID | Law | Sev | Reader | v0.1 |
|---|---|---|---|---|
| W-42 | Text and non-text contrast hold in **every** theme and color scheme the project ships: 4.5:1 for text, 3:1 for large text and for UI parts and focus indicators. Each pair is measured against its nearest painted background | R | an: theme reader over the token source and the class pairs in markup | |
| W-43 | Motion honors `prefers-reduced-motion`: with reduce emulated, no canvas keeps rendering frames on its own and no CSS animation keeps running unless essential; anything that moves for more than 5 s has a visible pause (WCAG 2.2.2) | R | an: Playwright emulation, canvas frame counters, `document.getAnimations()` | |
| W-44 | Pointer targets are at least 24 × 24 CSS px (WCAG 2.5.8); a control wrapped in its label counts the label; inline links in text are exempt | R | an: rendered | |
| W-45 | Every element reached by keyboard shows a visible focus indicator | R | an: Tab through the page, read computed outline and box-shadow | |
| W-46 | Pages reflow at 320 CSS px with no horizontal scroll (WCAG 1.4.10); tables, code and maps exempt | R | an: rendered | |

LuminosiTS's `lumin-ui` skill implements all five against its catalog and is the reference for
the readers.

**React and dead code** (added in 0.3.0)

| ID | Law | Sev | Reader | v0.1 |
|---|---|---|---|---|
| W-47 | React hooks follow the rules of hooks: called only at the top level of a component or custom hook, with complete dependency arrays | R | tl: `eslint-plugin-react-hooks` `rules-of-hooks`, `exhaustive-deps` | |
| W-48 | No unused exports, files or dependencies | A | tbd: `knip` over all three (M3) | |

**v0.1 target:** 26 of 49 laws judged. Most are delegated, because the TypeScript and web
ecosystem already ships the checks. Class-specific laws are `skip` for other classes.

### 8.3 Law metadata

Each law lives in `laws/W-NN.yaml`, valid against `schema/law.schema.json`; a file that is not valid
fails the catalog, and so every `laws` command. Fields:

- `id`, and `title`, the law text of §8.2;
- `family`, the §8.2 table the law is listed in, and `severity`, `R` or `A`;
- `classes`, the launch classes that map the law (§5.2), and `conditional_classes`, those among them
  that map it only when the project depends on Astro;
- `reader`: `kinds`, from `tl`, `an`, `at` and `tbd` (§8.1), and `text`, the Reader cell of §8.2;
- `rules`: each tool rule, flag or check the law maps, as a `tool` and a `name`, and an optional
  `classes`, the classes among the law's that the rule applies to (absent: every class the law maps);
- `judged`: `v0.1` for a law ticked in §8.2, `m3` for a law M3 gives a reader, `m4` for a law M4 gives a reader, `no` for the rest;
- `rationale`, `fix` and an optional `note`.

A class requires the laws it maps that are judged (§5.2): `webtops laws list --class <c> --required`
prints them. §8.2 is generated from these files by `webtops laws sync`.

---

## 9. Configuration: `web-tops.yaml`

```yaml
protocol: "0.3.0"
version: "0.1.0"
package: "@hedronite/lts-core"      # or the site name
class: ts-library
enforce: ratchet                    # hard | ratchet | advisory (§6.7)
baseline: .web-tops/baseline.json
# exemption: { until: "2027-01-31", reason: "..." }   # required under advisory

toolchain:
  typescript: "6.0.3"
  runtime: bun                      # bun | node: what the shipped code runs on; tools run on Node either way

gates:
  hygiene:
    eslint: { config: eslint.config.js }
    format: { tool: prettier }      # prettier | biome; one per repo
    stylelint: { enabled: false, reason: "no raw CSS in this package" }
    audit: { fail_on: high }
  tests:
    runner: vitest
    shuffle: true
  coverage:
    lines_floor: 85
    exclude:
      - { glob: "src/generated/**", reason: "written by the schema compiler" }
  crap:
    cap: 4
    scope: diff
    complexity: { nullish_discount: true }
  mutation:
    engine: stryker
    scope: diff
    base: origin/main
    unexplained_survivors_max: 0
    time_budget_minutes: 30
    ledger: .web-tops/survivors.yaml

# build: { command: "bun run build", dir: "dist" }              # web-app, astro-site, ui-components
# routes: ["/"]                                                  # declared routes for web-app axe & route-bytes
# budgets:                                                       # brotli byte budgets (default from class §5.2)
#   page_js_bytes: 51200
#   static_page_js_bytes: 0
#   route_js_bytes: 174080
#   pages: { "/docs/": 51200 }
#   routes: { "/": 174080 }
#   entries: { ".": 10240 }

layers:
  size_limit: { tier: 1 }                                        # or skip_private: "<reason>" for a "private": true package; default_bytes / entries
  package_exports: { tier: 1 }                                   # or skip_private: "<reason>" for a "private": true package
  html_validate: { enabled: false, reason: "ts-library: no HTML output" }
  axe: { enabled: false, reason: "ts-library: no pages" }
  rendered: { enabled: false, reason: "ts-library: no pages" }   # web-app, astro-site: routes, widths, reduced_motion (W-43 to W-46)
  themes: { enabled: false, reason: "ts-library: no themes" }    # mechanism, schemes, tokens for W-42
  custom: []

laws:
  select: default                   # default | all
  ack_ledger: .web-tops/acks.yaml

report:
  path: .web-tops/report.json
```

**Switching a layer off.** Every entry under `gates` and `layers`, and `laws` itself, takes
`enabled` (default `true`) and `reason`. `enabled: false` requires a non-empty `reason`, and the
report prints it with the `skip` verdict (§3.3). A comment is not a reason. Under `laws`, `select`
chooses which laws run and `enabled: false` turns the layer off.

- `enabled` and `reason` apply to each gate (`gates.hygiene`), each step inside a gate
  (`gates.hygiene.stylelint`) and each named entry under `layers`. A `layers.custom` item is
  `{ id, tier, command, report }` (§7; `report` optional). Its `id` is unique and is not a built-in
  layer id. To switch one off, remove it.
- Gate 1 steps: `install`, `tsc`, `astro_check`, `eslint`, `stylelint`, `format`,
  `dependency_cruiser`, `audit`. `astro_check` is mapped for `astro-site`, and for `web-app` and
  `ui-components` when the `package.json` beside `web-tops.yaml` lists `astro` in `dependencies`,
  `devDependencies` or `peerDependencies`; otherwise it is `skip`. `layers.package_exports` runs `publint` and `attw` inside gate 1.
- `build` configures the M4 build invocation (`command`, non-blank) and output directory (`dir`, relative path defaulting to `dist`). `routes` lists the declared app routes (paths starting `/`, unique). `budgets` sets brotli byte ceilings: `page_js_bytes` and `static_page_js_bytes` (astro-site), `route_js_bytes` (web-app), plus per-path maps `pages`, `routes`, and `entries` (keys starting `.`); `layers.size_limit.entries` overrides `budgets.entries` per key while keeping budget-only keys, and an empty `entries: {}` adds no overrides so any unmapped key falls back to `layers.size_limit.default_bytes` and then the 50 KiB default.
- `layers.package_exports.skip_private` and `layers.size_limit.skip_private` take a reason. When the `package.json` beside
  `web-tops.yaml` says `"private": true`, the layer is `skip` with that reason, and `hard` does not
  refuse it. Any other package cannot set it: `check` exits 2 at that key. It is for adopters whose
  package is never published; this kit keeps both checks live.
- `layers.rendered` and `layers.themes` have reserved shapes, validated now and read from M5 (§7).
  `rendered` takes `routes` (paths starting `/`), `widths` (CSS px, each at least 320) and
  `reduced_motion` (boolean). `themes` takes `switch` (`mechanism`: `attribute`, `class` or `media`,
  and its `name`), `schemes` and `tokens` (custom properties starting `--`). Each is optional, and
  an unknown key under either is refused.
- `format.tool` is `prettier` or `biome`. Without the key, the gate reads the one formatter config
  in the repo; none or both is `refuse`.
- `audit.fail_on`: `low`, `moderate`, `high` or `critical`. `tests.runner`: `vitest`.
- `laws.select`: `default` (the judged set) or `all`.
- Under `hard`, a gate or step the class (and, for `astro_check`, the project) maps at tier 1 or below cannot be switched off, except
  `crap`, `mutation`, build output and `laws`, the layers that land after the first CLI release;
  `check` exits 2. Steps that are not mapped (such as `astro_check` in a project without Astro)
  stay `skip`. Under `advisory`, `exemption` is required; `until` is an ISO 8601 date
  (`YYYY-MM-DD`), compared in UTC, and the exemption holds through that day.
- Under `hard`, `check` also exits 2 at `gates.coverage.lines_floor` below the class profile's,
  `gates.crap.cap` above it (while `crap` is on) and `gates.mutation.unexplained_survivors_max`
  above it (while `mutation` is on). Under `ratchet` and `advisory` a config may be looser.
- Keys a config omits take the class profile's value (§5.2). The `crap` and `mutation` checks in
  §12 apply when that gate is enabled.

---

## 10. Tool lock: `web-tops.lock`

`web-tops.lock` pins the tools listed in §2 and `webtops` itself, by exact version. `bun.lock`
pins the dependency graph and provides integrity hashes. `webtops lock --verify` compares
installed versions with the lock (W-41). `webtops lock --update` is a reviewed change, never an
automatic one. The lock also records the Node range from §2 as `node`; `lock --verify` exits 2
and `doctor` exits 3 when the running Node is outside it.

---

## 11. CI floor

The drop-in workflow `.github/workflows/web-tops.yml`:

| Job | Content |
|---|---|
| `gate` | `actions/setup-node`, pinned by SHA, with one exact `node-version` inside the lock's range; Bun; `bun install --frozen-lockfile`; Playwright browsers for the classes that need them; `bunx webtops gate --max-tier 1`. It fails if fewer layers ran than are in range (§3.3) |
| `nightly` | `bunx webtops gate --max-tier 2` on a schedule |
| `release-verify` | Tier 3, on release |
| `law-diff` | Fails a PR that weakens or removes a law, rule, tsconfig flag or budget without the `protocol-change` label |

`webtops law-diff <base> <head>` compares the merge base of the two refs with the head, surface by surface, and lists every
surface with how many parts it compared, whether or not any moved: the effective level and options of every ESLint rule
for each TypeScript, JavaScript and Astro file, where a file ESLint no longer reaches (an ignore, a narrower `files`) is
weaker, and a ceiling rule (`complexity`, `max-lines`, `max-depth`, `max-params`, `max-statements`,
`max-nested-callbacks`) whose number rose is weaker; the same for each CSS file under Stylelint; the rules and severities
of dependency-cruiser; the rules, allow lists and ignore files of secretlint (W-39), where a rule or preset removed or
disabled, a lowered severity, or an `allows`, `allowMessageIds` or `.secretlintignore` pattern added is weaker, and knip's
(W-48) ignore lists, `entry` and `project` patterns, rule levels and issue types, where an added ignore or exclude, a
widened `entry`, a narrowed `project`, a rule turned down or off, or a plugin turned off is weaker, and anything it cannot
read as data (a knip config written as code) is `changed`, for review; the `include`, `exclude`, `files`, `references` and program of each checked tsconfig project and
its W-04 flags; the gate's switches, floors, caps, coverage exclusions, exemption and shuffling; the law catalog; the
class profile; and the tool versions of `web-tops.lock` and `package.json`, where a removed or unpinned tool is weaker and
a new version is listed as `changed`, for review. The base is asked about the head's files as well as its own, and a
renamed file is held to the path it came from. A surface that cannot be read at a ref is weaker, never a pass. The
report ends with what it does not compare, and why: size budgets until M4, package scripts, CI workflow files, tsconfig
options beyond the flags, dependency-cruiser options beyond `exclude` and `doNotFollow`, secretlint configuration in any
file but `.secretlintrc.json` (the W-39 reader reads no other), what `.gitignore` leaves out of a secretlint scan, the
options of a knip plugin beyond `entry` and `project`, and files of other kinds. It
exits 1 when something weakened and the `protocol-change` label is absent. The workflow runs on `pull_request` events
for the label, never `pull_request_target`, with the base branch's own command over the PR's checkout; when the base has
no `law-diff`, it runs the head's own and says so, and never skips. Only an account with `maintain` or `admin`
permission on the repository may apply the label (O12): the command asks the API who applied it (the last `labeled`
event for it, an `unlabeled` taking it off) and what role that account has, by permission and never by name, and a
label from any other account, or from one whose role cannot be read, counts as not applied: the output says which.

CI rules: checkout with `fetch-depth: 0`; actions pinned by commit SHA; minimal `permissions:`;
`--dry-run` refused; empty reports fail. `init` writes a job only when its command exists:
until the tier 2 and 3 layers and `law-diff` exist, it writes the `gate` job alone.
Every gate job runs one `webtops gate` command (`gate --max-tier 1`, or `gate --max-tier 1 --shard i/n` followed by `gate --join <dir>`). `init` writes a single `gate` job (`timeout-minutes: 45`) because adopter diffs are small. The kit's own workflow runs a 4-shard matrix (`gate-shard` across `ubuntu-latest` and `macos-latest` × `shard: [1, 2, 3, 4]`, `timeout-minutes: 45`) uploading `.web-tops/out/mutation/partial.json`, followed by the `gate` join job (`needs: [gate-shard]`, `timeout-minutes: 45`, `matrix.os: [ubuntu-latest, macos-latest]`) running `gate --join` and gating `examples/node-service` so required check contexts stay `gate (ubuntu-latest)` and `gate (macos-latest)`. The drop-in does not repeat the tools as separate job steps, because steps that bypass `webtops` judge nothing.

---

## 12. The `webtops` CLI

| Command | Behavior |
|---|---|
| `init --class <c>` | Writes the drop-in set (§4). Refuses to overwrite without `--force` |
| `check` | Validates `web-tops.yaml` against the JSON Schema, plus semantic checks: the protocol id lies in the range this `webtops` supports (the schema does not pin it to one constant), class has a profile, `crap.cap ≥ 1`, `ts-library` keeps `unexplained_survivors_max = 0`, `advisory` has an `exemption` whose `until` has not passed (UTC, through that day; §9), under `ratchet` the baseline exists, is clean and is no looser than the merge base's copy (§6.7), under `hard` no gate or step the class maps at tier 1 or below is off except `crap`, `mutation`, build output and `laws` (§9), and no coverage floor below, nor CRAP cap or survivors limit above, the class profile's (§5.2), `skip_private` only for a `"private": true` package |
| `gate` | Runs enabled layers at or below `--max-tier` (default 1). `--base`, `--keep-going`, `--json`, `--all` (judge every function, not the diff's), `--only <layer>`, `--shard i/n` (run mutation on shard `i` of `n` and write `partial.json`), `--join <dir>` (recursively collects all `*.json` under `<dir>`, so pass a dedicated directory such as `.web-tops/out/shards`; unifies shard partials and judges ledger once), `--dry-run` (refused in CI) |
| `baseline` | Writes `.web-tops/baseline.json` from the last report, after a passing run made at `HEAD` on a clean tree; the only writer. Refused under `hard`, and for a result looser than the baseline already there |
| `laws [list \| explain W-NN \| sync]` | The law catalog (§8.3): `list [--class <c>] [--required] [--json]`, one law explained, and §8.2 regenerated from the files (`sync --check` fails on drift) |
| `report [--format text \| json]` | Renders the last report |
| `lock [--verify \| --update]` | Tool pins |
| `doctor` | Environment: Bun version, Node inside the lock's range (exit 3 outside it), TypeScript pin, Playwright browsers |
| `survivors [list \| explain \| expire]` | Mutation ledger |
| `acks [--json]` | The acknowledgements of soft laws (§8.1): the comments in tracked files and the ledger entries, and each one that is not well formed (exit 1) |
| `version` | Protocol, package and pinned tool versions |

Exit codes: 0 pass; 1 gate failed; 2 config invalid or lock mismatch; 3 environment error;
4 refused by policy.

---

## 13. Policies and `AGENTS.md`

The template is [`config/AGENTS.md.tmpl`](config/AGENTS.md.tmpl). It merges the common-mistakes guide's §12 with the Go-TOPS
template's shape: each rule names the check that enforces it, or `[review]`.

The rules every change is held to are §3.4. The template cites §3.4 and keeps no copy, so there is
one list; where an agent should be told something §3.4 does not say, the fix is a §3.4 edit through
a `protocol-change` PR.

The template's Standards list names a law for each rule, or `[review]`. It names only what the
written config has: the W-42 to W-46 lines appear only while the `themes` or `rendered` layer is
enabled, and the W-47 line only for the classes whose ESLint config carries the hooks rule
(`web-app`, `ui-components`).

---

## 14. Deltas

| Area | TS-TOPS sketch 0.1.0 | Go-TOPS 0.3.0 | Web-TOPS 0.3.0 |
|---|---|---|---|
| Scope | TypeScript | Go | TypeScript + HTML, CSS, Tailwind, Astro; source and build output |
| CRAP caps | Human and agent, agent "stricter" but numerically looser | One per class | One per class |
| Enabled layer with no command | `skip` | `not-run` fails | `not-run` fails |
| Enforcement | Absolute | `hard` / `ratchet` / `advisory` | Same |
| Complexity discount | not specified | Error guards | Nullish handling (`??`, `?.`) |
| Enums | Ack (T-04) | n/a | `refuse`, mechanically, via `erasableSyntaxOnly` (W-05) |
| T-09 / T-12 | Two laws | n/a | One law (W-15) |
| Runtime validation | Refuse on "detectable patterns" | n/a | Falls out of `no-unsafe-*` plus env-through-schema (W-06) |
| Mutation engine | open | pluggable | StrykerJS |
| Test runner | Vitest, Bun test or Jest | `go test` | Vitest, run on Node |
| TypeScript pin | ≥ 5.5 | n/a | 6.0.x; floor 5.8 |
| Accessibility | not covered | n/a | axe, `html-validate`, `jsx-a11y` |
| Performance | bundle analysis | `AllocsPerRun`, ns/op tier 2 | Bytes per page or route at tier 1; Lighthouse tier 2 |
| Formal layer | none | removed | none |

---

## 15. What you get / what you do not get

**You get:** pinned hygiene (tsc, type-aware ESLint, `astro check`, Stylelint, boundaries);
coverage, CRAP and diff mutation from one test run; checks on what ships (valid HTML, axe, byte
budgets); laws that block the common agent TypeScript mistakes; a machine-readable report; an
agent contract.

**You do not get (v0.1):**
- TypeScript 7: the pinned checker is 6.0 until the lint and Astro toolchain accept 7.
- Complete accessibility. axe finds a subset of WCAG problems; review and manual testing remain.
- Stable Lighthouse numbers in CI.
- Profiles for `cli`, `workspace-root` and `config-only` at launch.
- Coverage of `.astro` templates as such; their logic is pushed into modules (W-31).

---

## 16. Decisions

**Resolved in M2:**

32. **CRAP caps from measurement:** the one cap per class was measured over LuminosiTS and the kit
    (§5.2), and all five classes keep theirs; `astro-site` and `node-service` for want of data. The
    scored unit stays the one §6.3 defines, with callbacks folded into their container. There is
    no rule on changed functions beyond §6.7's, which already holds a changed function to its
    baseline.

**Resolved for 0.3.0:**

23. **One verdict vocabulary:** `pass`, `fail`, `refuse`, `ack-missing`, `skip`, `not-run`, `not-evaluated`, `vacuous`, with one table of which end the run (§3.3, §6.4, §6.5).
24. **Required items:** required by default (every in-range layer, every judged law the class maps); a profile may mark a layer or law optional, with a reason; `not-evaluated` fails only on a required item, so the laws catalog can grow without the gate never passing (§3.3).
25. **The report is the baseline's source:** `report_version`, `subject`, run context and per-layer `metrics` (§6.6).
26. **Protocol id by range:** `check` accepts the protocol range the installed `webtops` supports; the schema matches the minor, not one patch (§12, §18).
27. **Migration:** 0.3.0 took effect with the slice that moved the code, schemas and fixtures to it. `check` refuses a 0.2.x config with exit 2, and `init --force` or a one-line `protocol:` edit migrates it (§12).
28. **A shared core:** verdicts, enforcement modes and the failure table live once, in §3.3 and `schema/core.schema.json`, which is the seam. The sibling protocols copy that core by a checked sync and adopt it in their next revision (§3.3, §18).
29. **Audience and platforms:** a house standard first, for Hedronite repositories on macOS development machines with Bun, and built to be public: no private paths, clean licenses. No Windows. Where the kit runs on Macs, a macOS lane is required: the kit's own gate runs on `ubuntu-latest` and `macos-latest` as one job (§11).
30. **ESLint 10:** `probes/w22/` ran every `eslint-plugin-jsx-a11y` 6.10.2 rule that upstream has not deprecated, with a bad and a clean fixture each, through `eslint-plugin-jsx-a11y-x` on ESLint 10 and through `oxlint`. Both passed the rule rows. Only the fork also passed both claim rows (an unlabeled input fires; the Astro rules fire on an `.astro` page), so it is W-22's reader, and §2 pins ESLint 10.15, `eslint-plugin-astro` 3.2 and the fork. This supersedes item 11.
31. **Rendered readers:** the kit ships the W-42 to W-46 readers, with a project's own scripted review as a reference and a possible delegate through a custom layer (§7, §8.2). This closes O6.

**Resolved for 0.2.1:**

15. **Switching a layer off:** `enabled` and `reason` on every gate and layer and on `laws`; `enabled: false` needs a reason (§9).
16. **A stopped run:** layers after a failed gate without `--keep-going` report `not-run` with the reason, and the report counts the layers in range and the layers that ran (§3.3, §6.6).
17. **Verdict precedence and range:** config off, then class, then no command or a missing input; `--only` narrows the range (§3.3).
18. **Report fields** are listed in §6.6; `advisory` takes `exemption`; `laws.enable` is renamed `laws.select` (§9).
19. **Runtime:** Node runs the tools in every class, in the range §2 pins; the lock records it (§1.3, §2, §10, §11, §12). This supersedes items 3 and 4 below: Bun installs and starts `webtops`; Vitest runs on Node.
20. **Tool resolution and hand-offs:** tools come from `node_modules`, never `PATH`; layers declare the artifacts they produce and consume (§3.1).
21. **Coverage scope:** the gate passes the include, reporters, reports directory and seed; every in-scope file has an LCOV record (§3.1, §6.1, §6.6).
22. **What `init` claims:** only commands that exist and layers the config enables; the CI drop-in has the `gate` job alone until the other jobs' commands exist (§4, §11).

**Resolved for 0.2.0:**

11. **Lint pin:** ESLint 9.39 with `eslint-plugin-astro` 1.7 until `jsx-a11y` (or its fork, at 1.0) supports ESLint 10 (§2). Superseded by item 30.
12. **Profile order after launch:** `workspace-root` first, because the first adopter needs it, then `cli`.
13. **Build-suite handbook:** kept outside this repository, as Go-TOPS keeps its build suite.
14. **Rendered interface laws:** W-42 to W-46 join the catalog, judged with M5 (§19).

**Resolved for 0.1.0:**

1. **Name:** Web-TOPS / `webtops` / `Hedronite/web-tops`. TS-TOPS is retired.
2. **TypeScript:** pinned 6.0.x for typed lint and `astro check`; floor 5.8.
3. **Runtime:** Bun first; Node LTS supported for `node-service`. Superseded by item 19.
4. **Test runner:** Vitest, run with Bun. Stryker's Vitest runner and v8 coverage are why. Superseded by item 19: Vitest runs on Node.
5. **Mutation:** StrykerJS, diff-scoped, with the TypeScript checker.
6. **CRAP:** native; one cap per class; nullish discount on in every class.
7. **Enforcement:** `ratchet` for adopters, `hard` for the kit.
8. **Classes:** five launch profiles (§5.1). `react-component` is folded into `ui-components`.
9. **Formal layer:** none.
10. **Performance gate:** bytes at tier 1; Lighthouse at tier 2.

**Open:**

O1. Byte budgets per class (§5.2 numbers are placeholders).
O2. Whether to add a TypeScript 7 `tsc --noEmit` leg as advisory for speed.
O3. Prettier or Biome as the drop-in default formatter.
O4. Tailwind 4 lint plugin choice, if any, beyond the custom W-23 rule **[verify v4 support]**.
O5. How a gate proves a WebGPU backend: a self-hosted runner with an adapter, or an advisory leg.
O7. Distribution: a git dependency pinned by SHA in the lock, or an npm publish, which needs a
   release decision (M6).
O8. The theme contract: whether a project must declare its themes as custom properties (§9
   `layers.themes`) (M5).
O9. The accessibility bar for W-21 and W-44: WCAG 2.2 AA as the default (M4).
O10. The second adopter: an Astro site, to calibrate beside the first (M7).
O11. The tier-1 time budget, and the time budget past which mutation is `not-evaluated` (§6.4) (M2).
O12. Who may apply the `protocol-change` label that `law-diff` honors (M3). Answered: an account with `maintain` or `admin` permission, by permission (§11).
O13. Whether Lighthouse stays advisory at tier 2 or is dropped (M7).

---

## 17. Repository layout

The kit is written in TypeScript and is installed and started with Bun, so it gates itself with its own protocol.

```
web-tops/
├── src/
│   ├── acks/                # the ack comment and ledger (§8.1), and which acknowledgement covers a finding
│   ├── baseline/            # webtops baseline: the projection from a report, the ratchet comparison, the baseline across a change
│   ├── census/              # the suppression census readers (§6.7): directive comments, ESLint and tsconfig configuration
│   ├── cli/                 # webtops entry and one file per command
│   ├── complexity/          # the section 6.3 counter on the TypeScript AST, and function keys (6.7)
│   ├── config/              # class table, config validation, semantic checks, report validation
│   ├── crap/                # CRAP: the counter's complexity joined with statement coverage (§6.2)
│   ├── diff/                # changed lines and functions against the merge base
│   ├── gate/                # runner, tiers, verdicts, run info
│   ├── init/                # webtops init: renders the drop-in set
│   ├── lawdiff/             # webtops law-diff: what a PR weakens, surface by surface (§11)
│   ├── laws/                # the law catalog (§8.3): the loader, the queries and the §8.2 table generator; the probe, the ESLint and compiler readers and the laws layer (§6.5)
│   ├── layers/              # hygiene, tests, coverage, crap, mutation, laws, build, html, links, bytes, route-bytes, axe, size-limit
│   ├── lock/                # tool pins, web-tops.lock, the Node range
│   ├── presets/             # the drop-in rules behind web-tops/eslint, /stylelint, /depcruise and /tsconfig/strict.json (plain JavaScript: Node does not strip types in node_modules)
│   ├── report/              # report writing, text and JSON rendering
│   └── survivors/           # the survivor key (section 6.4), and the ledger when it lands
├── profiles/                # one profile per launch class: the data init renders from
├── packages/                # eslint-plugin-webtops: the custom ESLint rules behind W-23, W-36 and W-37, built into the web-tops package
├── laws/                    # one W-NN.yaml per law (§8.3): the source of the §8.2 tables
├── schema/                  # web-tops, gate-report, baseline, acks, core (verdicts, modes) and law schemas
├── config/                  # drop-in templates, AGENTS.md.tmpl
├── fixtures/                # config (with examples/), hygiene, init, lock, report, probe, laws
├── probes/                  # w22/: the W-22 proof, its own package and lock
├── examples/                # node-service/, astro-site/, web-app/: a project of each of these classes, each with its own package and lock
├── docs/brand/
├── .github/workflows/       # the gate job and the law-diff job
├── WEB_TOPS.md
├── AGENTS.md · CLAUDE.md · CHANGELOG.md · README.md
├── web-tops.yaml · web-tops.lock · package.json · bun.lock
└── LICENSE · LICENSE-MIT · LICENSE-APACHE
```

The law twins are in `fixtures/laws/W-NN/{bad,clean}/`: a bad and a clean twin per law, which `webtops laws probe` proves.

Not yet in the tree: `src/budgets/` (the `dist/` byte reader, M4). The kit's tools already cover the rest: the M3 source paths and the plugin are linted, type-checked, formatted, cruised and tested like the rest of the source; the law fixtures are data, skipped like the probe fixtures; `examples/node-service` gates itself.

Self-hosting: the kit runs `hard` and passes its own tier-1 gate before any release.

---

## 18. JSON Schema sketch

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://hedronite.com/schemas/web-tops/0.3/web-tops.schema.json",
  "type": "object",
  "required": ["protocol", "version", "package", "class"],
  "additionalProperties": false,
  "properties": {
    "protocol": { "type": "string", "pattern": "^0\\.3\\.[0-9]+$" },
    "version":  { "type": "string", "minLength": 1 },
    "package":  { "type": "string", "minLength": 1 },
    "class":    { "enum": ["ts-library", "ui-components", "astro-site", "web-app",
                           "node-service", "cli", "workspace-root", "config-only"] },
    "enforce":  { "enum": ["hard", "ratchet", "advisory"], "default": "ratchet" },
    "baseline": { "type": "string", "minLength": 1 },
    "gates": {
      "type": "object",
      "properties": {
        "crap": {
          "type": "object",
          "properties": {
            "cap": { "type": "number", "minimum": 1 },
            "scope": { "enum": ["diff", "all"] },
            "complexity": { "type": "object",
              "properties": { "nullish_discount": { "type": "boolean" } } }
          }
        },
        "mutation": {
          "type": "object",
          "properties": {
            "engine": { "const": "stryker" },
            "unexplained_survivors_max": { "type": "integer", "minimum": 0 }
          }
        }
      }
    },
    "build": {
      "type": "object",
      "properties": {
        "command": { "type": "string", "pattern": "\\S" },
        "dir": { "type": "string", "pattern": "\\S" }
      }
    },
    "routes": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "items": { "type": "string", "pattern": "^/" }
    },
    "budgets": {
      "type": "object",
      "properties": {
        "page_js_bytes": { "type": "integer", "minimum": 0 },
        "static_page_js_bytes": { "type": "integer", "minimum": 0 },
        "route_js_bytes": { "type": "integer", "minimum": 0 },
        "pages": { "type": "object" },
        "routes": { "type": "object" },
        "entries": { "type": "object" }
      }
    },
    "layers": {
      "type": "object",
      "properties": {
        "size_limit": {
          "type": "object",
          "properties": {
            "skip_private": { "type": "string", "pattern": "\\S" },
            "default_bytes": { "type": "integer", "minimum": 0 },
            "entries": { "type": "object" }
          }
        },
        "package_exports": {
          "type": "object",
          "properties": { "skip_private": { "type": "string", "pattern": "\\S" } }
        },
        "rendered": {
          "type": "object",
          "properties": {
            "routes": { "type": "array", "minItems": 1, "uniqueItems": true,
                        "items": { "type": "string", "pattern": "^/" } },
            "widths": { "type": "array", "minItems": 1, "uniqueItems": true,
                        "items": { "type": "integer", "minimum": 320 } },
            "reduced_motion": { "type": "boolean" }
          }
        },
        "themes": {
          "type": "object",
          "properties": {
            "switch": { "type": "object", "required": ["mechanism", "name"],
                        "properties": { "mechanism": { "enum": ["attribute", "class", "media"] },
                                        "name": { "type": "string", "minLength": 1 } } },
            "schemes": { "type": "array", "minItems": 1, "uniqueItems": true,
                         "items": { "type": "string", "minLength": 1 } },
            "tokens": { "type": "array", "uniqueItems": true,
                        "items": { "type": "string", "pattern": "^--" } }
          }
        }
      }
    }
  }
}
```

(Abbreviated; the full schema covers every key in §9. Every gate and layer object, and `laws`,
also takes `enabled` and `reason`, and `enabled: false` requires `reason`.)

---

## 19. Roadmap

| Milestone | Contents | Exit criterion |
|---|---|---|
| **M0** | This spec, schemas, five profiles, `AGENTS.md.tmpl` | Reviewed; budgets marked for calibration |
| **M1** | CLI: `init`, `check`, `gate` (hygiene, tests, coverage, report) | Self-hosting green |
| **P3** | Protocol 0.3.0, the truth pass: one verdict set and failure table; required layers and laws per class; the report's shape, from which the baseline is projected; coverage, CRAP, mutation and suppression definitions; the protocol id by range; ESLint 10 with the fork, proved by `probes/w22/`; the catalog and template corrected; the kit's gate on Ubuntu and macOS | Protocol 0.3.0 is true in the text, the schemas and the fixtures, and the kit's own gate is green on it |
| **M2** | The risk engine: a findings model; coverage per function; the complexity counter and the native CRAP layer; the diff engine; the Stryker adapter; the survivor ledger; baseline and ratchet; one cap per class set from measurement | A planted weak test fails the kit's own `hard` gate, with or without a source change, and every coverage and mutation trick in `fixtures/probe/` is caught |
| **M3** | Laws v1: `laws/W-NN.yaml` with `laws list` and `laws explain`; importable drop-ins; law fixtures and `laws probe`; readers that prove their rules are live; `eslint-plugin-webtops` (W-23, W-36, W-37) and the Astro rules (W-28, W-30, W-31); the ack ledger; the non-lint readers; `law-diff` | Every law the class profile marks required is judged; the report prints N of M by class |
| **M4** | Build output: one build, one static server and one page inventory; HTML validity (W-20); links; page bytes and route bytes (W-29); the axe layer (W-21, W-44); `size-limit` per `exports` entry | `examples/astro-site` and `examples/web-app` pass, and each of four planted defects fails with its law id |
| **M5** | Rendered interface and themes: the render rig; reflow (W-46), focus (W-45) and motion (W-43); the theme contract and the token-pair trace (W-42); parity with the first adopter's scripted review; `report --format html` | On the first adopter at a known-bad commit (`570304b`) the kit reports the animation under reduced motion, the small checkbox targets and the two failing color pairs; at the known-good commit (`04cc3a3`) it reports none |
| **M6** | Workspaces and adoption: the `workspace-root` and `cli` profiles; distribution; the adopter PRs (libraries under ratchet, mutation on the diff, build output, rendered checks); the gate swap | The first adopter's required status is `webtops gate` under ratchet, for every package and both apps |
| **M7** | Calibration and 1.0: a second adopter; caps, floors and budgets set from data; tier 2 nightly and tier 3 release checks; agent skills; engine legs; SARIF; a red-team pass | Two adopters across at least four classes; caps and budgets set from their data; law ids and schemas frozen |

**Status.** M0 to M3 are done. M4 is not: its layers (build and static server, HTML validity, internal links, page and route JavaScript bytes, axe and `size-limit`) and `examples/astro-site` and `examples/web-app` are in the tree, but `webtops gate` does not run those layers yet, so its exit criterion does not hold. M3's holds on this repo: `webtops gate` prints `laws: 22 of 22 judged (ts-library)` for the kit and `21 of 21 judged (node-service)` for `examples/node-service`, and a planted override that turns `@typescript-eslint/no-explicit-any` off fails W-01 with `refuse` at the line of the override.

An adopter PR (M6, M7) is written by this protocol's maintainers and approved and merged by the
adopter's own maintainers under its own gate.

---

## 20. First adopter: LuminosiTS

LuminosiTS is a style-agnostic TypeScript visual library: icons, Three.js primitives, objects,
scenes, materials, surface shaders and screen effects, with looks (themes) that color the
interface and the 3D scene together. It is a Bun + Turborepo monorepo with a Nix shell. It
exercises every launch class: since it gained an Astro site, `astro-site` too. Web-TOPS judges
it on correctness, density, accessibility and budgets, never on its look.

| LuminosiTS part | Class |
|---|---|
| `core`, `tokens`, `primitives`, `objects`, `scenes`, `materials`, `shaders`, `postfx` | `ts-library` |
| `icons` (pure TS data plus a `./react` entry) | `ui-components` |
| `adapters` (R3F components) | `ui-components` |
| `apps/catalog` (Vite + React + R3F; the playground is a view of it) | `web-app` |
| `apps/site` (Astro, one island) | `astro-site` |
| `tools/` (the `lumin` agent CLI and the asset, icon, looks and vendor generators) | `cli` (profile in M6) |
| repo root | `workspace-root` (profile in M6) |

Its manifesto's package rules become `dependency-cruiser` rules under W-16, W-17 and W-19:
- no circular dependencies;
- `core` is the only shared foundation;
- adapters are optional, and raw packages work without them;
- React and R3F are imported only from `./react` entries and `adapters`.

Its optimization goals (polygon budgets, compressed formats, disposal) become custom layers; its
asset pipeline already checks glTF output against `assets/budgets.json`.

**What it proved for 0.2.0.** The 0.1.0 lint pins could not install together (§2). Astro 7
needs Node 22.23.4. Canvas pages need SwiftShader flags and longer timeouts on CI, and a plain
HTTP origin runs WebGPU code on its WebGL 2 fallback (§7). And its scripted interface review
(`lumin-ui`: rule tables over the parsed JSX, contrast across all 30 theme schemes, and a
rendered pass) found failures that axe on one page in one theme did not: the source of W-42 to
W-46.

**What it proves for 0.3.0.** It already runs `knip` and `eslint-plugin-react-hooks`, the readers
behind W-48 and W-47. Its scripted interface review is the reference for the W-42 to W-46 readers
the kit ships (§16, item 31). Its lint pins, ESLint 9.39 with `jsx-a11y` 6.10, move to ESLint 10 with
the fork when it adopts.

**Adoption (M6).** Four PRs, each written by this protocol's maintainers and approved and merged by
LuminosiTS's maintainers under its own gate: the libraries under `ratchet` with a CRAP baseline;
mutation on the diff with a survivor ledger; build output for the apps, with budgets in brotli bytes;
and W-42 to W-46 on both apps, which leaves its scripted review only the judgment a script cannot
make. Then one required status, `webtops gate`, replaces its 15-step chain.

---

## Credits and license

Built by Hedronite. Structure adapted from Rust-TOPS and Go-TOPS. The TypeScript laws draw on
*Common Mistakes AI Coding Agents Make in TypeScript* (Hedronite sketch). CRAP is the 2007 Change
Risk Anti-Patterns metric (Savoia and Evans). License: MIT OR Apache-2.0.
