# Web-TOPS: Web Testing and Optimization Protocol Suite

**Spec status:** Draft 0.3.0 (proposed) · **Date:** 2026-11-17 · **Owner:** Hedronite
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
> `enabled` and `reason` on every gate and layer, a coverage exclusion key, and run counts in the report. 0.3.0 (proposed) gives the report one verdict vocabulary, required items and the shape the M2 baseline reads.

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

- Protocol: **Web-TOPS**. Binary: **`webtops`**. Repo (proposed): `github.com/Hedronite/web-tops`.
- Bun installs dependencies and starts `webtops`: `bunx webtops gate`, or a workspace script.
  The tools the gate runs (Vitest with v8 coverage, ESLint, Stylelint, Stryker, `html-validate`,
  dependency-cruiser, Playwright) are Node programs, so every class needs Node in the range §2
  pins. Vitest supports v8 coverage only on Node; on Bun its counts differ.

---

## 2. Pins

| Item | Value |
|---|---|
| Protocol version | **0.3.0** (draft, proposed) |
| Package version | 0.0.0 (unreleased) |
| TypeScript | **6.0.x** pinned (6.0.3 current). Floor 5.8 (`erasableSyntaxOnly`). See below |
| Runtime | Bun ≥ 1.4 installs and runs `webtops`; Node `^22.23.4 \|\| ^24.15.0 \|\| >=26` runs the tools, in every class (where the pinned tools' engine ranges meet). The range is recorded in `web-tops.lock` (§10) |
| Tool lock | `web-tops.lock`; dependency lock `bun.lock`, installed with `--frozen-lockfile` |
| Lint | **ESLint 9.39** (held back, see below), `typescript-eslint` 8.73, `eslint-plugin-astro` **1.7**, `eslint-plugin-jsx-a11y` 6.10, `@eslint-community/eslint-plugin-eslint-comments` 4.8 |
| Tests and coverage | Vitest 5.1, `@vitest/coverage-v8` 5.1 |
| Mutation | StrykerJS 10.1 (`@stryker-mutator/core`, `vitest-runner`, `typescript-checker`) |
| Astro, Tailwind, validation | Astro 7.4, `@astrojs/check` 0.9, Tailwind CSS 4.3, Zod 4.6 |
| Build output | `html-validate` 11, `@playwright/test` 1.65, `@axe-core/playwright` 4.14, Stylelint 18, `size-limit` 14, `@lhci/cli` 0.16 (tier 2) |
| Boundaries and packages | `dependency-cruiser` 18, `publint` 0.3, `@arethetypeswrong/cli` 0.18 |
| Format | Prettier 3.10 or Biome 2.6, one per repo |

**Why TypeScript 6.0 and not 7.0.** `typescript` 7.0.2 (the native compiler) is npm `latest`.
But `typescript-eslint` 8.72 declares `typescript >=4.8.4 <6.1.0`, and `@astrojs/check` 0.9
declares `^5.0.0 || ^6.0.0`. The laws layer depends on type-aware lint, so the gate's type
checker is the pinned 6.0.x. A TypeScript 7 `tsc --noEmit` leg may be added as advisory for
speed (§16, open). The pin moves when both peers accept 7.

**Why ESLint 9 and not 10.** ESLint 10.15 is npm `latest`, and 0.1.0 pinned it beside
`eslint-plugin-jsx-a11y` 6.10 and `eslint-plugin-astro` 3.2. That set cannot install:
`jsx-a11y` 6.10.2, still its latest, declares `eslint ^3 || … || ^9`, and `eslint-plugin-astro`
3.x requires `eslint >=10`. LuminosiTS hit this and runs ESLint 9.39 with `jsx-a11y` 6.10; on
ESLint 9, `eslint-plugin-astro` 1.7 (`eslint >=8.57`) is the newest that fits. W-22 depends on
`jsx-a11y`, so the lint pin holds at 9.39. It moves to 10 when `jsx-a11y` accepts 10, or when
its fork `eslint-plugin-jsx-a11y-x` (0.2.0, `eslint ^9 || ^10`, an optional peer of
`eslint-plugin-astro` 3.2) reaches 1.0 and an adopter proves it on W-22's fixtures.

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

★ The laws layer is tier 0 but executes last. It does not run ESLint, tsc or Stylelint a second
time: it reads the JSON those tools wrote in gate 1.

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

### 3.2 Tiers

| Tier | Purpose | Contents |
|---|---|---|
| **0** | Floor | Laws; config and schema validation |
| **1** | **Merge gate** (default) | Gates 1–6 |
| **2** | Deep / nightly | Full-repo mutation; Lighthouse CI (median of several runs); visual regression; Playwright on Chromium, WebKit and Firefox |
| **3** | Release | `publint` and `attw` on the release tarball; changesets; provenance |

### 3.3 Verdicts

One vocabulary, lower case and hyphenated, for layers, laws and findings alike:

| Verdict | Meaning | Ends the run non-zero |
|---|---|---|
| `pass` | Evaluated and satisfied | no |
| `fail` | A threshold missed: a coverage floor, a CRAP cap, a survivor count, a byte budget, a failing test, a tool error | **yes** |
| `refuse` | A hard law or rule broken | **yes** |
| `ack-missing` | A soft rule broken with no recorded acknowledgement (`// webtops-ack W-NN: reason` or the ledger). An acknowledged one is `pass` with `ack` | **yes** |
| `skip` | The class does not require the item, or config sets `enabled: false` with a `reason` (§9) | no; printed with the reason |
| `not-run` | Enabled but no command is mapped, the run stopped before it, or its input is missing (§3.1); the reason says which | **yes** |
| `not-evaluated` | The reader or tool could not judge, or the tool's own rule or flag is off or below `error` (§8.1) | **yes** when the item is `required`; otherwise counted and printed |
| `vacuous` | Evaluated over nothing, such as an empty mutation diff | no; printed, and never a pass for any law |

Each class profile lists its `required` layers and laws. A required law whose tool rule is off or
below `error` is `refuse`, with the config line that disabled it, not `not-evaluated`.

**Which verdict, and what counts.** A layer gets `skip` when `web-tops.yaml` sets
`enabled: false` (the reason is the config's), or when its class profile does not map it (the
reason names the class). Otherwise a layer with no command, or with a missing input (§3.1), is
`not-run`. A layer is **in range**
when it is enabled, mapped by the class, at or below `--max-tier`, and named by `--only` when
`--only` is given. `skip` layers are never in range. The run fails when fewer layers ran than are
in range.

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

---

## 4. Quick start

```bash
bunx webtops init --class astro-site
bunx webtops check
bunx webtops gate
```

`init` writes:
- `web-tops.yaml`, `web-tops.lock`;
- `tsconfig.strict.json` to extend, `eslint.config.js`, `stylelint.config.js`,
  `.dependency-cruiser.cjs`, and `stryker.config.json` once the mutation layer ships;
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
| Extra laws | W-18 | W-18, W-22; W-27 when Astro | W-20–W-31 | W-20–W-29; W-27 when Astro | W-06 strict, W-37 |

There is one CRAP cap per class, the same for every author. Under `ratchet` (§6.7) it applies to
new functions, and existing functions must not get worse. All numbers are **proposed**.

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
  ended: the `tests` layer is `Refuse` with reason `vitest-run-failed`, quoting Vitest's stderr. The
  gate runs Vitest's default reporter beside `json`, so that stderr names the error.

### 6.2 CRAP

```
CRAP(f) = comp(f)² × (1 − cov(f))³ + comp(f)          cov(f) ∈ [0,1]
```

- Native, so the formula, the counting rule and the caps are under protocol control. No mature
  TypeScript CRAP tool exists; existing ones are cross-checks at most.
- `cov(f)` is line coverage of `f` from the LCOV.
- **Cap:** one per class (§5.2). Drop-in default 6.0. No authorship marking.
- **Scope:** functions touched in the diff; `--all` for tier 2 trends.

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

- **Engine:** StrykerJS with the Vitest runner. The TypeScript checker plugin drops mutants that
  do not type-check, so they are neither killed nor counted as survivors.
- **Scope:** lines changed against the merge base. `webtops` computes the ranges and passes them
  as Stryker `mutate` entries with line ranges **[verify range syntax]**.
- **Diff outcomes:** a diff that fails (no merge base, shallow clone) is `fail`, with no
  exemption. A diff that succeeds but is empty is `vacuous` (§3.3). CI checks out with `fetch-depth: 0`.
- **Survivors** are killed by a new test or listed in `.web-tops/survivors.yaml` with `reason`,
  `owner` and optional `expires`. Only unexplained survivors count.

### 6.5 Law verdicts

Laws use the §3.3 vocabulary. `refuse` and `ack-missing` fail; `not-evaluated` fails when the law
is `required` by the class and is counted otherwise; it is never a pass. The report names each
law's reader.

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
`build-output`, `laws`, or a `custom` id), `gate`, `tier`, `verdict` and `findings`. A finding has
`rule` (a tool rule id or a law id), `message` and `verdict`, and `file` and `line` when it has a
place. Verdicts are
spelled as in §3.3: `pass`, `fail`, `refuse`, `ack-missing`, `skip`, `not-run`, `not-evaluated`, `vacuous`. `skip` and
`not-run` carry a `reason`. A stopped run's `not-run` reason is `stopped: gate <n> failed`. An
acknowledged soft-rule finding is `pass` and carries `ack: { source: comment | ledger, reason }`;
an unacknowledged one is `ack-missing`. The report may carry more fields (run timing, artifact paths, the exit
code); `schema/gate-report.schema.json` lists every field, and the fields above are required.
The `tests` layer also carries `seed`, the shuffle seed the gate passed, so a shuffled failure
can be rerun.

From 0.3.0 the report is the source the baseline is projected from, so it carries:

- `report_version`, the report format's own version, separate from `protocol`; a protocol
  patch that leaves the report alone does not change it;
- `subject`, the package or workspace root the run judged;
- `run`: git SHA, `bun` and `node` versions, the version of every tool that ran, and the
  shuffle seed;
- on each layer and law, `required` (from the class profile) and the §3.3 verdict;
- on each layer, `metrics` shaped for `webtops baseline`: per function `{file, name, line,
  complexity, coverage, crap}` for CRAP; per file `{file, lines_found, lines_hit}` for coverage;
  per rule per file `{rule, file, count}` for findings; per page `{route, bytes}` for build
  output. A layer that has no metrics yet carries an empty object.

`counts` gains `required_not_evaluated`; `failed` counts every verdict §3.3 marks as ending the
run.

### 6.7 Enforcement modes

The top-level key `enforce` sets how floors and caps apply. Adopters default to `ratchet`.
Web-TOPS runs `hard` on itself.

| Mode | What fails |
|---|---|
| `hard` | Any function in scope above the cap; coverage below the floor; any finding; any budget overrun |
| `ratchet` | A new function above the cap; an existing function above its baseline; package coverage below its baseline; a per-rule, per-file finding count that rises; a page or route over its baseline bytes; a suppression count that rises |
| `advisory` | Nothing; needs a dated exemption, and the report prints the run as not enforced |

Baseline rules:

- `.web-tops/baseline.json` holds CRAP per function, coverage per package, finding counts per
  rule per file, bytes per page or route, and suppression counts. Suppressions are
  `eslint-disable`, `@ts-expect-error` and `stylelint-disable`.
- Only `webtops baseline` writes it, after a passing run. It is tracked and clean against
  `HEAD`. Under `ratchet` a missing baseline fails, and deleting it is not a reset.
- A function is identified by file path, enclosing class and name. A renamed function is new.
  A new file starts at 0 findings; a deleted file's allowance does not move.
- Legacy findings stay in the baseline. They are not wrapped in suppressions to zero the count.

---

## 7. Build-output and class layers

| Layer | Tool | What fails | Tier |
|---|---|---|---|
| `.astro` type check | `astro check` | Any error | 1 |
| HTML validity | `html-validate` on `dist/**/*.html` | Any error | 1 |
| Accessibility | axe-core via Playwright, on every built page (`astro-site`) or the declared routes (`web-app`) | Any serious or critical violation; moderate ones are ratcheted | 1 |
| Internal links | link check on `dist/` **[verify tool]** | A broken internal link or anchor | 1 |
| Bytes per page or route | `webtops` reads `dist/` and compresses with brotli | Over the class or page budget | 1 |
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
  `stylelint --print-config`). If the rule or flag is off, or below `error`, the law is
  `not-evaluated`, not `pass`.
- **`an`** (analyzer): a custom `webtops` rule or reader.
- **`at`** (attested): judged by review; `not-evaluated` until attested.
- **`tbd`**: not yet implemented; `not-evaluated`.

Every delegated rule is proven to fire. `fixtures/lints/` breaks each enabled rule on purpose,
with an `// expect: <rule>` marker on the line. A test fails if a marked rule stays quiet or an
unmarked one fires. Custom ESLint rules are tested with ESLint's `RuleTester`.

### 8.2 Law catalog (draft: 46 laws, W-01…W-46)

Severity: **R** = a break is `refuse`, **A** = a break needs an acknowledgement or is `ack-missing`. ✓ = judged in v0.1. Law IDs from the TS-TOPS sketch
(T-NN) are noted where they map.

**Types**

| ID | Law | Sev | Reader | v0.1 |
|---|---|---|---|---|
| W-01 | No `any`, explicit or implicit, and no unchecked flow of an `any` value (T-01) | R | tl: `no-explicit-any`, `no-unsafe-assignment`, `-member-access`, `-call`, `-return`, `-argument`; `noImplicitAny` | ✓ |
| W-02 | No type assertions (`as`, `<T>x`) and no non-null `!`; `as const` is allowed (T-02) | R | tl: `consistent-type-assertions` (`assertionStyle: "never"`), `no-non-null-assertion` | ✓ |
| W-03 | User-defined type guards and assertion functions (`x is T`, `asserts x is T`) are derived from a schema or covered by a property test. The compiler trusts them like an `as` | A | an | |
| W-04 | Strict tsconfig: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`, `erasableSyntaxOnly` (T-03). `strict: true` beside a strict member set to `false` is `refuse` | R | an: reads every flag's resolved value through the `extends` chain, not `strict` alone; `tsc --showConfig` omits defaults and keeps `strict: true` beside a disabled member | ✓ |
| W-05 | No `enum`, `namespace` or parameter properties: only erasable syntax (T-04, now mechanical) | R | tl: `erasableSyntaxOnly` | ✓ |
| W-06 | External data is validated at the boundary: `response.json()`, `JSON.parse`, `FormData`, storage, `postMessage`, env (T-05) | R | tl: these return `any`, so W-01's `no-unsafe-*` refuses unvalidated use; an: env reads only through a schema (`astro:env` or a Zod module) | ✓ |
| W-07 | Derived types (`Pick`, `Omit`, `Partial`, `z.infer`) over duplicated shapes (T-06) | A | at | |
| W-08 | `satisfies` for literal config and route tables (T-07) | A | at | |
| W-09 | No unnecessary type parameters; no conditional-type chains deeper than 2 (T-08) | A | tl: `no-unnecessary-type-parameters`; an | |
| W-10 | `switch` over a union is exhaustive | R | tl: `switch-exhaustiveness-check` | ✓ |

**Async and errors**

| ID | Law | Sev | Reader | v0.1 |
|---|---|---|---|---|
| W-11 | No floating or misused promises; `await` only thenables (T-11) | R | tl: `no-floating-promises`, `no-misused-promises`, `await-thenable` | ✓ |
| W-12 | Concurrency is bounded: no `Promise.all` over input of unbounded size; independent awaits are not serialized in a loop | A | tl: `no-await-in-loop`; an | |
| W-13 | Caught values are `unknown` and narrowed, including `.catch` callbacks; a rethrow keeps `{ cause }` (T-10) | R | tl: `useUnknownInCatchVariables` (in `strict`), `use-unknown-in-catch-callback-variable` | ✓ |
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
| W-22 | Interactive elements are semantic, images have `alt`, form controls have labels | R | tl: `jsx-a11y`, `eslint-plugin-astro` a11y rules | ✓ |

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

**Tests, suppressions, security, build**

| ID | Law | Sev | Reader | v0.1 |
|---|---|---|---|---|
| W-32 | Oracle-first: tests derive from the contract, not the function body | A | at | |
| W-33 | Tests are deterministic: fake timers, no live network, seeded randomness | R | an (heuristic) | |
| W-34 | No focused or skipped tests committed | R | tl: `@vitest/eslint-plugin` (1.6) `no-focused-tests`, `no-disabled-tests` | ✓ |
| W-35 | Every suppression names its rule and says why: `eslint-disable` with a description, `@ts-expect-error` with a description, no `@ts-ignore` or `@ts-nocheck`; unused directives fail | R | tl: `eslint-comments/require-description`, `no-unlimited-disable`; `ban-ts-comment` (`allow-with-description`); `reportUnusedDisableDirectives: "error"` | ✓ |
| W-36 | No `set:html`, `dangerouslySetInnerHTML` or `innerHTML` with unsanitized input | R | an | |
| W-37 | Only public env reaches client code (`PUBLIC_` vars, `astro:env` client fields) | R | an | |
| W-38 | No high or critical advisories in production dependencies | R | tl: dependency audit **[verify `bun audit` output]** | ✓ |
| W-39 | No secrets in source or fixtures | R | tl: secrets scanner **[verify]** | |
| W-40 | `bun.lock` is committed and installs with `--frozen-lockfile` | R | tl | ✓ |
| W-41 | Installed tool versions match `web-tops.lock` | R | an | ✓ |

**Rendered interface** (added in 0.2.0; judged once M4's rendered layer and theme reader land)

| ID | Law | Sev | Reader | v0.1 |
|---|---|---|---|---|
| W-42 | Text and non-text contrast hold in **every** theme and color scheme the project ships: 4.5:1 for text, 3:1 for large text and for UI parts and focus indicators. Each pair is measured against its nearest painted background | R | an: theme reader over the token source and the class pairs in markup | |
| W-43 | Motion honors `prefers-reduced-motion`: with reduce emulated, no canvas keeps rendering frames on its own and no CSS animation keeps running unless essential; anything that moves for more than 5 s has a visible pause (WCAG 2.2.2) | R | an: Playwright emulation, canvas frame counters, `document.getAnimations()` | |
| W-44 | Pointer targets are at least 24 × 24 CSS px (WCAG 2.5.8); a control wrapped in its label counts the label; inline links in text are exempt | R | an: rendered | |
| W-45 | Every element reached by keyboard shows a visible focus indicator | R | an: Tab through the page, read computed outline and box-shadow | |
| W-46 | Pages reflow at 320 CSS px with no horizontal scroll (WCAG 1.4.10); tables, code and maps exempt | R | an: rendered | |

LuminosiTS's `lumin-ui` skill implements all five against its catalog and is the reference for
the readers.

**v0.1 target:** 26 of 46 laws judged. Most are delegated, because the TypeScript and web
ecosystem already ships the checks. Class-specific laws are `skip` for other classes.

### 8.3 Law metadata

Each law lives in `laws/W-NN.yaml` with `id`, `title`, `severity`, `classes`, `reader`, the tool
rule names it maps, `rationale` and `fix`, as in Go-TOPS §8.3.

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
    ledger: .web-tops/survivors.yaml

layers:
  size_limit: { tier: 1 }
  package_exports: { tier: 1 }
  html_validate: { enabled: false, reason: "ts-library: no HTML output" }
  axe: { enabled: false, reason: "ts-library: no pages" }
  rendered: { enabled: false, reason: "ts-library: no pages" }   # web-app, astro-site: routes, widths, reduced motion (W-43 to W-46)
  themes: { enabled: false, reason: "ts-library: no themes" }    # token source and theme list for W-42
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
- `format.tool` is `prettier` or `biome`. Without the key, the gate reads the one formatter config
  in the repo; none or both is `refuse`.
- `audit.fail_on`: `low`, `moderate`, `high` or `critical`. `tests.runner`: `vitest`.
- `laws.select`: `default` (the judged set) or `all`.
- Under `hard`, a gate or step the class (and, for `astro_check`, the project) maps at tier 1 or below cannot be switched off, except
  `crap`, `mutation`, build output and `laws`, the layers that land after the first CLI release;
  `check` exits 2. Steps that are not mapped (such as `astro_check` in a project without Astro)
  stay `skip`. Under `advisory`, `exemption` is required; `until` is an ISO 8601 date
  (`YYYY-MM-DD`), compared in UTC, and the exemption holds through that day.
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

CI rules: checkout with `fetch-depth: 0`; actions pinned by commit SHA; minimal `permissions:`;
`--dry-run` refused; empty reports fail. `init` writes a job only when its command exists:
until the tier 2 and 3 layers and `law-diff` exist, it writes the `gate` job alone.
The gate is one job running one command. The drop-in
does not repeat the tools as separate job steps, because steps that bypass `webtops` judge
nothing.

---

## 12. The `webtops` CLI

| Command | Behavior |
|---|---|
| `init --class <c>` | Writes the drop-in set (§4). Refuses to overwrite without `--force` |
| `check` | Validates `web-tops.yaml` against the JSON Schema, plus semantic checks: the protocol id lies in the range this `webtops` supports (the schema does not pin it to one constant), class has a profile, `crap.cap ≥ 1`, `ts-library` keeps `unexplained_survivors_max = 0`, `advisory` has an `exemption` whose `until` has not passed (UTC, through that day; §9), under `ratchet` the baseline exists and is clean, under `hard` no gate or step the class maps at tier 1 or below is off except `crap`, `mutation`, build output and `laws` (§9) |
| `gate` | Runs enabled layers at or below `--max-tier` (default 1). `--base`, `--keep-going`, `--json`, `--only <layer>`, `--dry-run` (refused in CI) |
| `baseline` | Writes `.web-tops/baseline.json` after a passing run; the only writer |
| `laws [list \| run \| explain W-NN]` | Catalog with readers; laws alone; one law explained |
| `report [--format text \| json]` | Renders the last report |
| `lock [--verify \| --update]` | Tool pins |
| `doctor` | Environment: Bun version, Node inside the lock's range (exit 3 outside it), TypeScript pin, Playwright browsers |
| `survivors [list \| explain \| expire]` | Mutation ledger |
| `version` | Protocol, package and pinned tool versions |

Exit codes: 0 pass; 1 gate failed; 2 config invalid or lock mismatch; 3 environment error;
4 refused by policy.

---

## 13. Policies and `AGENTS.md`

The template is [`config/AGENTS.md.tmpl`](config/AGENTS.md.tmpl). It merges the common-mistakes guide's §12 with the Go-TOPS
template's shape: each rule names the check that enforces it, or `[review]`.

Non-negotiable:

1. Write the oracle from the contract before the code.
2. Never split a function only to lower its CRAP score.
3. Never weaken a law, lint rule, tsconfig flag or budget to make a change pass. Change it
   through a `protocol-change` PR.
4. Explain every accepted mutation survivor.
5. Every suppression names its rule and a reason (W-35).
6. Agent-authored code meets the same gate and the same cap as human code.
7. Do not edit generated files; fix the generator.
8. Prefer deleting code to adding configuration.
9. `webtops gate` is the definition of done.

---

## 14. Deltas

| Area | TS-TOPS sketch 0.1.0 | Go-TOPS 0.3.0 | Web-TOPS 0.3.0 |
|---|---|---|---|
| Scope | TypeScript | Go | TypeScript + HTML, CSS, Tailwind, Astro; source and build output |
| CRAP caps | Human and agent, agent "stricter" but numerically looser | One per class | One per class |
| Enabled layer with no command | `skip` | `not-run` fails | `not-run` fails |
| Enforcement | Absolute | `hard` / `ratchet` / `advisory` | Same |
| Complexity discount | not specified | Error guards | Nullish handling (`??`, `?.`) |
| Enums | Ack (T-04) | n/a | Refuse, mechanically, via `erasableSyntaxOnly` (W-05) |
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

**Proposed for 0.3.0:**

23. **One verdict vocabulary:** `pass`, `fail`, `refuse`, `ack-missing`, `skip`, `not-run`, `not-evaluated`, `vacuous`, with one table of which end the run (§3.3, §6.4, §6.5).
24. **Required items:** each class profile lists its required layers and laws; `not-evaluated` fails only on a required item, so the laws catalog can grow without the gate never passing (§3.3).
25. **The report is the baseline's source:** `report_version`, `subject`, run context and per-layer `metrics` (§6.6).
26. **Protocol id by range:** `check` accepts the protocol range the installed `webtops` supports; the schema matches the minor, not one patch (§12, §18).

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

11. **Lint pin:** ESLint 9.39 with `eslint-plugin-astro` 1.7 until `jsx-a11y` (or its fork, at 1.0) supports ESLint 10 (§2).
12. **Profile order after launch:** `workspace-root` first, because the first adopter needs it, then `cli`.
13. **Build-suite handbook:** kept outside this repository, as Go-TOPS keeps its build suite.
14. **Rendered interface laws:** W-42 to W-46 join the catalog, judged with M4.

**Resolved for 0.1.0:**

1. **Name:** Web-TOPS / `webtops` / `Hedronite/web-tops`. TS-TOPS is retired.
2. **TypeScript:** pinned 6.0.x for typed lint and `astro check`; floor 5.8.
3. **Runtime:** Bun first; Node LTS supported for `node-service`.
4. **Test runner:** Vitest, run with Bun. Stryker's Vitest runner and v8 coverage are why.
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
O6. Whether `webtops` ships the W-42 to W-46 readers itself or delegates to a project's own tool
   that emits the same report shape.

---

## 17. Repository layout (proposed)

The kit is written in TypeScript and is installed and started with Bun, so it gates itself with its own protocol.

```
web-tops/
├── src/
│   ├── cli/                 # webtops entry
│   ├── gate/                # runner, tiers, verdicts
│   ├── layers/              # hygiene, tests, coverage, crap, mutation, build output
│   ├── complexity/          # TypeScript AST counting
│   ├── crap/
│   ├── budgets/             # dist/ byte reader
│   └── report/
├── packages/
│   └── eslint-plugin-webtops/   # custom rules (W-23, W-28, W-31, …)
├── laws/                    # W-NN.yaml
├── profiles/
├── schema/
├── config/                  # drop-in templates, AGENTS.md.tmpl
├── fixtures/lints/          # one deliberate violation per rule, with expect markers
├── examples/                # one per launch class
├── docs/brand/
├── WEB_TOPS.md
├── AGENTS.md · CLAUDE.md · CHANGELOG.md · README.md
├── web-tops.yaml · web-tops.lock · package.json · bun.lock
└── LICENSE · LICENSE-MIT · LICENSE-APACHE
```

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
| **M2** | Native CRAP; Stryker adapter; survivor ledger; baseline and ratchet | Gate fails on a deliberately weak test |
| **M3** | Laws v0.1: 26 judged; `fixtures/lints`; `eslint-plugin-webtops` | Report shows "26 of 46 judged" |
| **M4** | Build-output layers: `html-validate`, axe, links, byte budgets; rendered checks and the theme reader (W-42 to W-46) | An `astro-site` example passes; a broken page fails, including one that animates under reduced motion |
| **M5** | First adopter: LuminosiTS | Packages gated under ratchet |
| **M6** | Protocol 1.0 | Calibrated budgets and caps; frozen law IDs |

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
| `tools/` (the `lumin` agent CLI and the asset, icon, looks and vendor generators) | `cli` (profile pending) |
| repo root | `workspace-root` (profile pending) |

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

---

## Credits and license

Built by Hedronite. Structure adapted from Rust-TOPS and Go-TOPS. The TypeScript laws draw on
*Common Mistakes AI Coding Agents Make in TypeScript* (Hedronite sketch). CRAP is the 2007 Change
Risk Anti-Patterns metric (Savoia and Evans). License (proposed): MIT OR Apache-2.0.
