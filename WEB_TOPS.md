# Web-TOPS: Web Testing and Optimization Protocol Suite

**Spec status:** Draft 0.1.0 · **Date:** 2026-11-14 · **Owner:** Hedronite
**Supersedes:** the TS-TOPS 0.1.0 sketch (renamed: the protocol covers the web stack, not only TypeScript)
**Modeled on:** [Rust-TOPS](https://github.com/Hedronite/rust-tops) and [Go-TOPS](https://github.com/Hedronite/go-tops) 0.3.0

> **How to read this.** Web-TOPS reuses the shape of Rust-TOPS and Go-TOPS: a written spec, a
> JSON Schema, per-class profiles, an orchestrator CLI, a CI floor, and a laws layer. It starts
> from Go-TOPS 0.3.0, so the review fixes made there apply from day one: one CRAP cap per class,
> `not-run` fails, ratchet for adopters, laws check that their tool config is live, no formal
> layer. Values labeled **proposed** are defaults to tune on real code. **[verify]** marks a tool
> behavior or flag not yet confirmed at pin time. Versions in §2 are npm `latest` as read on
> 2026-11-14.

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

It has three parts: the written spec (this document, destined to become `WEB_TOPS.md`), a JSON
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
- Bun is the runtime and package manager: `bunx webtops gate`, or a workspace script. Node LTS is
  supported for `node-service` adopters that need it.

---

## 2. Pins

| Item | Value |
|---|---|
| Protocol version | **0.1.0** (draft) |
| Package version | 0.0.0 (unreleased) |
| TypeScript | **6.0.x** pinned (6.0.3 current). Floor 5.8 (`erasableSyntaxOnly`). See below |
| Runtime | Bun ≥ 1.4 (primary); Node ≥ 22 LTS where a project needs Node |
| Tool lock | `web-tops.lock`; dependency lock `bun.lock`, installed with `--frozen-lockfile` |
| Lint | ESLint 10, `typescript-eslint` 8.72, `eslint-plugin-astro` 3.2, `eslint-plugin-jsx-a11y` 6.10, `@eslint-community/eslint-plugin-eslint-comments` 4.8 |
| Tests and coverage | Vitest 5.1, `@vitest/coverage-v8` 5.1 |
| Mutation | StrykerJS 10.1 (`@stryker-mutator/core`, `vitest-runner`, `typescript-checker`) |
| Astro, Tailwind, validation | Astro 7.4, `@astrojs/check` 0.9, Tailwind CSS 4.3, Zod 4.6 |
| Build output | `html-validate` 11, `@axe-core/playwright` 4.14, Stylelint 18, `size-limit` 14, `@lhci/cli` 0.16 (tier 2) |
| Boundaries and packages | `dependency-cruiser` 18, `publint` 0.3, `@arethetypeswrong/cli` 0.18 |
| Format | Prettier 3.10 or Biome 2.6, one per repo |

**Why TypeScript 6.0 and not 7.0.** `typescript` 7.0.2 (the native compiler) is npm `latest`.
But `typescript-eslint` 8.72 declares `typescript >=4.8.4 <6.1.0`, and `@astrojs/check` 0.9
declares `^5.0.0 || ^6.0.0`. The laws layer depends on type-aware lint, so the gate's type
checker is the pinned 6.0.x. A TypeScript 7 `tsc --noEmit` leg may be added as advisory for
speed (§16, open). The pin moves when both peers accept 7.

Protocol and package versions are separate planes. A protocol change bumps the protocol version
and the schema together.

---

## 3. Protocol model

### 3.1 Gate order

Gates run in this order. A failing gate stops the run unless `--keep-going` is set.

| # | Gate | Command(s) | Pass condition |
|---|---|---|---|
| 1 | **Hygiene** | `bun install --frozen-lockfile`; `tsc -b --noEmit` (pinned 6.0) **[verify `-b` with `--noEmit`]**; `astro check` (Astro classes); `eslint` type-aware, once, JSON output; `stylelint` on CSS and `<style>` blocks; format check; `dependency-cruiser`; `publint` and `attw` on the packed tarball (package classes); dependency audit | All clean; no high or critical advisory in production dependencies |
| 2 | **Tests** | **one run**: `vitest run --coverage --sequence.shuffle` (v8 provider, `json` + `lcov` reporters) | All pass; no focused or skipped tests; zero tests is a failure |
| 3 | **Coverage** | from the run in gate 2; **`test -s`** on the LCOV | Profile non-empty; class floor or ratchet met |
| 4 | **CRAP** | native CRAP over the LCOV and the TypeScript AST (§6.2) | Cap or ratchet met |
| 5 | **Mutation (diff)** | Stryker on lines changed against the merge base (§6.4) | Unexplained survivors ≤ max |
| 6 | **Build output** | `astro build` or `vite build`, then on `dist/`: `html-validate`, axe via Playwright, internal link check, bytes per page or route, `size-limit` per package entry | Per class (§7) |
| ★ | **Laws** | maps findings from gates 1 and 6 to law IDs, then runs the custom `webtops` rules (§8) | No `Refuse`; `not-evaluated` never counts as a pass |

★ The laws layer is tier 0 but executes last. It does not run ESLint, tsc or Stylelint a second
time: it reads the JSON those tools wrote in gate 1.

### 3.2 Tiers

| Tier | Purpose | Contents |
|---|---|---|
| **0** | Floor | Laws; config and schema validation |
| **1** | **Merge gate** (default) | Gates 1–6 |
| **2** | Deep / nightly | Full-repo mutation; Lighthouse CI (median of several runs); visual regression; Playwright on Chromium, WebKit and Firefox |
| **3** | Release | `publint` and `attw` on the release tarball; changesets; provenance |

### 3.3 Verdicts

| Verdict | Meaning | Effect |
|---|---|---|
| `pass` | Evaluated and satisfied | none |
| `Refuse` | Hard rule violated | **Fails the gate** |
| `Ack` | Soft rule; needs a recorded acknowledgement (`// webtops-ack W-NN: reason` or the ledger) | Fails if unacknowledged |
| `skip` | The class does not require the layer, or config sets `enabled: false` | Printed with the reason |
| `not-run` | The layer is enabled but has no command mapped | **Fails the gate** |
| `not-evaluated` | The reader or tool could not judge, or its config is off | Reported; **never a pass** |

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
  `.dependency-cruiser.cjs`, `stryker.config.json`;
- the class CI workflow;
- the Web-TOPS section of `AGENTS.md`. If `AGENTS.md` exists, `init` replaces only the text
  between `<!-- web-tops:begin -->` and `<!-- web-tops:end -->`.

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
| Extra laws | W-18 | W-18, W-22 | W-20–W-31 | W-20–W-29 | W-06 strict, W-37 |

There is one CRAP cap per class, the same for every author. Under `ratchet` (§6.7) it applies to
new functions, and existing functions must not get worse. All numbers are **proposed**.

Coverage counts `.ts` and `.tsx` modules. `.astro` components are judged by `astro check`,
`html-validate`, axe, and W-31, which moves frontmatter logic into testable modules.

---

## 6. Scoring and reporting

### 6.1 Coverage

- From the single Vitest run in gate 2 (v8 provider), LCOV plus JSON. Workspace packages merge
  into one profile.
- Excluded by default: `*.d.ts`, generated code, `.astro/` type output, config files. Anything
  else is excluded only by an explicit, reasoned entry in `web-tops.yaml`.
- An empty or missing profile fails.

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
- **Diff outcomes:** a diff that fails (no merge base, shallow clone) is `Failed`, with no
  exemption. A diff that succeeds but is empty is `Vacuous`: printed, and not counted as a pass
  for any law. CI checks out with `fetch-depth: 0`.
- **Survivors** are killed by a new test or listed in `.web-tops/survivors.yaml` with `reason`,
  `owner` and optional `expires`. Only unexplained survivors count.

### 6.5 Law verdicts

`Refuse` fails, `Ack` needs an acknowledgement, and `not-evaluated` is never a pass. The report
names each law's reader.

### 6.6 Report

`webtops gate` always writes `.web-tops/report.json` and prints text. The schema is
`schema/gate-report.schema.json`. Every layer is present; `skip` carries a reason; `not-run`
fails; `not_evaluated` is counted on its own.

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
| Visual regression | Playwright screenshots | Opt-in per project | 2 |
| Cross-browser e2e | Playwright: Chromium, WebKit, Firefox | Any failure | 2 |
| Custom | `layers.custom: [{ id, command, tier, report }]` | Same rules: missing tool fails, empty report fails, unmapped is `not-run` | declared |

**Budgets are bytes, not scores.** Byte counts from `dist/` are the same on every run, so they
can gate a merge. Lighthouse scores vary between runs and machines, so they gate nothing at
tier 1. Rust-TOPS uses Callgrind instruction counts for the same reason.

Project-specific budgets, such as polygon counts and texture sizes for 3D assets, are custom
layers (§20).

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

### 8.2 Law catalog (draft: 41 laws, W-01…W-41)

Severity: **R** = Refuse, **A** = Ack. ✓ = judged in v0.1. Law IDs from the TS-TOPS sketch
(T-NN) are noted where they map.

**Types**

| ID | Law | Sev | Reader | v0.1 |
|---|---|---|---|---|
| W-01 | No `any`, explicit or implicit, and no unchecked flow of an `any` value (T-01) | R | tl: `no-explicit-any`, `no-unsafe-assignment`, `-member-access`, `-call`, `-return`, `-argument`; `noImplicitAny` | ✓ |
| W-02 | No type assertions (`as`, `<T>x`) and no non-null `!`; `as const` is allowed (T-02) | R | tl: `consistent-type-assertions` (`assertionStyle: "never"`), `no-non-null-assertion` | ✓ |
| W-03 | User-defined type guards and assertion functions (`x is T`, `asserts x is T`) are derived from a schema or covered by a property test. The compiler trusts them like an `as` | A | an | |
| W-04 | Strict tsconfig: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`, `erasableSyntaxOnly` (T-03) | R | an: reads `tsc --showConfig` | ✓ |
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

**v0.1 target:** 26 of 41 laws judged. Most are delegated, because the TypeScript and web
ecosystem already ships the checks. Class-specific laws are `skip` for other classes.

### 8.3 Law metadata

Each law lives in `laws/W-NN.yaml` with `id`, `title`, `severity`, `classes`, `reader`, the tool
rule names it maps, `rationale` and `fix`, as in Go-TOPS §8.3.

---

## 9. Configuration: `web-tops.yaml`

```yaml
protocol: "0.1.0"
version: "0.1.0"
package: "@hedronite/lts-core"      # or the site name
class: ts-library
enforce: ratchet                    # hard | ratchet | advisory (§6.7)
baseline: .web-tops/baseline.json

toolchain:
  typescript: "6.0.3"
  runtime: bun                      # bun | node

gates:
  hygiene:
    eslint: { config: eslint.config.js }
    stylelint: { enabled: false }   # no raw CSS in this package
    audit: { fail_on: high }
  tests:
    runner: vitest
    shuffle: true
  coverage:
    lines_floor: 85
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
  html_validate: { enabled: false }
  axe: { enabled: false }
  custom: []

laws:
  enable: default
  ack_ledger: .web-tops/acks.yaml

report:
  path: .web-tops/report.json
```

---

## 10. Tool lock: `web-tops.lock`

`web-tops.lock` pins the tools listed in §2 and `webtops` itself, by exact version. `bun.lock`
pins the dependency graph and provides integrity hashes. `webtops lock --verify` compares
installed versions with the lock (W-41). `webtops lock --update` is a reviewed change, never an
automatic one.

---

## 11. CI floor

The drop-in workflow `.github/workflows/web-tops.yml`:

| Job | Content |
|---|---|
| `gate` | `bun install --frozen-lockfile`; Playwright browsers for the classes that need them; `bunx webtops gate --max-tier 1`. It fails if fewer layers ran than are enabled in range |
| `nightly` | `bunx webtops gate --max-tier 2` on a schedule |
| `release-verify` | Tier 3, on release |
| `law-diff` | Fails a PR that weakens or removes a law, rule, tsconfig flag or budget without the `protocol-change` label |

CI rules: checkout with `fetch-depth: 0`; actions pinned by commit SHA; minimal `permissions:`;
`--dry-run` refused; empty reports fail. The gate is one job running one command. The drop-in
does not repeat the tools as separate job steps, because steps that bypass `webtops` judge
nothing.

---

## 12. The `webtops` CLI

| Command | Behavior |
|---|---|
| `init --class <c>` | Writes the drop-in set (§4). Refuses to overwrite without `--force` |
| `check` | Validates `web-tops.yaml` against the JSON Schema, plus semantic checks: protocol id, class has a profile, `crap.cap ≥ 1`, `ts-library` keeps `unexplained_survivors_max = 0`, `advisory` has a dated exemption, under `ratchet` the baseline exists and is clean |
| `gate` | Runs enabled layers at or below `--max-tier` (default 1). `--base`, `--keep-going`, `--json`, `--only <layer>`, `--dry-run` (refused in CI) |
| `baseline` | Writes `.web-tops/baseline.json` after a passing run; the only writer |
| `laws [list \| run \| explain W-NN]` | Catalog with readers; laws alone; one law explained |
| `report [--format text \| json]` | Renders the last report |
| `lock [--verify \| --update]` | Tool pins |
| `doctor` | Environment: Bun and Node versions, TypeScript pin, Playwright browsers |
| `survivors [list \| explain \| expire]` | Mutation ledger |
| `version` | Protocol, package and pinned tool versions |

Exit codes: 0 pass; 1 gate failed; 2 config invalid or lock mismatch; 3 environment error;
4 refused by policy.

---

## 13. Policies and `AGENTS.md`

The template is [`config/AGENTS.template.md`](config/AGENTS.template.md). It merges the common-mistakes guide's §12 with the Go-TOPS
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

| Area | TS-TOPS sketch 0.1.0 | Go-TOPS 0.3.0 | Web-TOPS 0.1.0 |
|---|---|---|---|
| Scope | TypeScript | Go | TypeScript + HTML, CSS, Tailwind, Astro; source and build output |
| CRAP caps | Human and agent, agent "stricter" but numerically looser | One per class | One per class |
| Unmapped layer | `skip` | `not-run` fails | `not-run` fails |
| Enforcement | Absolute | `hard` / `ratchet` / `advisory` | Same |
| Complexity discount | not specified | Error guards | Nullish handling (`??`, `?.`) |
| Enums | Ack (T-04) | n/a | Refuse, mechanically, via `erasableSyntaxOnly` (W-05) |
| T-09 / T-12 | Two laws | n/a | One law (W-15) |
| Runtime validation | Refuse on "detectable patterns" | n/a | Falls out of `no-unsafe-*` plus env-through-schema (W-06) |
| Mutation engine | open | pluggable | StrykerJS |
| Test runner | Vitest, Bun test or Jest | `go test` | Vitest, run with Bun |
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

1. Byte budgets per class (§5.2 numbers are placeholders).
2. Whether to add a TypeScript 7 `tsc --noEmit` leg as advisory for speed.
3. Prettier or Biome as the drop-in default formatter.
4. Tailwind 4 lint plugin choice, if any, beyond the custom W-23 rule **[verify v4 support]**.
5. Profile order after launch: `workspace-root` first (LuminosiTS needs it), then `cli`.
6. Whether a Web build-suite handbook belongs in foundry, as Go's does.

---

## 17. Repository layout (proposed)

The kit is written in TypeScript and runs on Bun, so it gates itself with its own protocol.

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
├── config/                  # drop-in templates, AGENTS.template.md
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
  "$id": "https://hedronite.com/schemas/web-tops/0.1.0/web-tops.schema.json",
  "type": "object",
  "required": ["protocol", "version", "package", "class"],
  "additionalProperties": false,
  "properties": {
    "protocol": { "const": "0.1.0" },
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

(Abbreviated; the full schema covers every key in §9.)

---

## 19. Roadmap

| Milestone | Contents | Exit criterion |
|---|---|---|
| **M0** | This spec, schemas, five profiles, `AGENTS.template.md` | Reviewed; budgets marked for calibration |
| **M1** | CLI: `init`, `check`, `gate` (hygiene, tests, coverage, report) | Self-hosting green |
| **M2** | Native CRAP; Stryker adapter; survivor ledger; baseline and ratchet | Gate fails on a deliberately weak test |
| **M3** | Laws v0.1: 26 judged; `fixtures/lints`; `eslint-plugin-webtops` | Report shows "26 of 41 judged" |
| **M4** | Build-output layers: `html-validate`, axe, links, byte budgets | An `astro-site` example passes; a broken page fails |
| **M5** | First adopter: LuminosiTS | Packages gated under ratchet |
| **M6** | Protocol 1.0 | Calibrated budgets and caps; frozen law IDs |

---

## 20. First adopter: LuminosiTS

LuminosiTS is a style-agnostic TypeScript visual library: icons, Three.js primitives, objects,
scenes, materials and shaders. It is a Bun + Turborepo monorepo with a Nix shell. It is a good
first adopter because it exercises every class except `astro-site`. Web-TOPS judges it on
correctness, density, accessibility and budgets, never on its look.

| LuminosiTS part | Class |
|---|---|
| `core`, `primitives`, `objects`, `scenes`, `materials`, `shaders` | `ts-library` |
| `icons` (pure TS data plus a `./react` entry) | `ui-components` |
| `adapters` (R3F components) | `ui-components` |
| `catalog`, `playground` (Vite + React + R3F) | `web-app` |
| `tools/` | `cli` (profile pending) |
| repo root | `workspace-root` (profile pending) |

Its manifesto's package rules become `dependency-cruiser` rules under W-16, W-17 and W-19:
- no circular dependencies;
- `core` is the only shared foundation;
- adapters are optional, and raw packages work without them;
- React and R3F are imported only from `./react` entries and `adapters`.

Its optimization goals (polygon budgets, compressed formats, disposal) become custom layers once
its `tools/` can report them as numbers.

---

## Credits and license

Built by Hedronite. Structure adapted from Rust-TOPS and Go-TOPS. The TypeScript laws draw on
*Common Mistakes AI Coding Agents Make in TypeScript* (Hedronite sketch). CRAP is the 2007 Change
Risk Anti-Patterns metric (Savoia and Evans). License (proposed): MIT OR Apache-2.0.
