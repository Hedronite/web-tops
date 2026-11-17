# Changelog

All notable changes to this project are listed here. The protocol version and the package version are separate (see `WEB_TOPS.md` §2). Package versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Protocol 0.2.1 → 0.3.0 (draft, proposed), the report shape the M2 baseline reads:
  - §3.3, §6.4, §6.5: one lower-case verdict vocabulary with `fail`, `refuse`, `ack-missing` and `vacuous`, and one table of which verdicts end the run. `not-evaluated` fails on a `required` item (required by default; a profile may mark an item optional, with a reason) and is counted otherwise. A rule or flag that is off is `refuse` on a required law, else `not-evaluated`.
  - §6.6: `report_version`, `subject`, run context (SHA, runtimes, tool versions, seed), `required` per item and per-layer `metrics` shaped for `webtops baseline`.
  - §12, §18: `check` validates the protocol id by the supported range; the schema matches the minor.
  - §3.3: every in-range layer is required, and judged laws the class maps; the line between `fail` and `not-evaluated`; which verdicts count as run. §6.6: how `failed` and the not-evaluated counts overlap.
  - §16: items 23 to 27 proposed. 0.3.0 takes effect with the code slice; a 0.2.x config then needs a one-line `protocol:` edit or `init --force`.
- Protocol 0.2.0 → 0.2.1 (draft), the keys the configuration schema needs before the CLI can be written:
  - §9: every gate and layer, and `laws`, takes `enabled` and `reason`; `enabled: false` needs a reason, printed with `skip`. `gates.coverage.exclude` holds the reasoned coverage exclusions §6.1 already required.
  - §3.3: `not-run` also covers layers a stopped run never reached. §6.6: the report counts the layers in range and the layers that ran.
  - §3.3: verdict precedence (config off, class, no command) and what counts as in range, so `--only` runs and class-unmapped layers do not fail the count.
  - §6.6: the report's fields, verdict spellings, reasons on `skip` and `not-run`, and how an acknowledged `Ack` is marked. §6.1: test files are excluded from coverage by default.
  - §9: `exemption` for `advisory`; gate 1 step keys and `format.tool`; `custom` item shape; enums; `laws.enable` renamed `laws.select`; under `hard`, mapped gates and steps at tier 1 or below, other than CRAP, mutation, build output and laws, cannot be switched off; `exemption.until` is a UTC date valid through that day. `astro_check` follows the project, not only the class: always for `astro-site`, and for `web-app` and `ui-components` when they depend on `astro`, including as a peer. §6.6 names a finding's fields.
  - §16: four items resolved (15 to 18); open items numbered O1 to O6. §14 header at 0.2.1; §18 sketch at 0.2.1.
  - Node runs the tools in every class, in `^22.23.4 || ^24.15.0 || >=26`, recorded in `web-tops.lock`; the CI `gate` job sets it up; `doctor` and `lock --verify` check it (§1.3, §2, §10, §11, §12).
  - §3.1: tools resolve from `node_modules`, never `PATH`; layers declare the artifacts they produce and consume, and a layer whose input is missing is `not-run` with the reason.
  - §3.1, §6.1, §6.6: the gate passes the coverage include, reporters, reports directory and shuffle seed; every in-scope file needs an LCOV record; the `tests` layer records `seed`.
  - §4, §11: `init` writes only CI jobs whose commands exist (`gate` alone for now) and an `AGENTS.md` section that claims no check that does not run. §8.2: W-04 reads each strict member, not `strict` alone. §16: items 19 to 22.
  - Review fixes: the `tests` layer is judged from Vitest's JSON results, not its exit code, and the gate passes the coverage `exclude` too; the floor counts in-scope records only (§3.1, §6.1). A missing input is a `not-run` cause and a missing tool is `Refuse` (§3.3, §3.1). `gate` clears `.web-tops/out/` first and checks Bun's floor; CI pins an exact Node (§3.1, §11). `toolchain.runtime` names what the shipped code runs on (§9). The `package.json` beside `web-tops.yaml` decides `astro_check`; W-27 applies to Astro `web-app` and `ui-components` projects (§5.2, §9).
  - §3.1, §6.1: a run Vitest fails itself (an unhandled error), with every test passing in the JSON, is `Refuse` `vitest-run-failed`; the gate runs Vitest through a kit config that removes the project's `test.coverage.thresholds` whole, so a non-zero exit with no failing test means Vitest failed the run.
- CI is the one `gate` job of §11 (`.github/workflows/web-tops.yml`), which runs the kit from source on itself at tier 1. It replaces the bootstrap `ci.yml`.
- Protocol 0.1.0 → 0.2.0 (draft), from what the first adopter, LuminosiTS, proved in practice:
  - Lint pins: ESLint 9.39 and `eslint-plugin-astro` 1.7, because `eslint-plugin-jsx-a11y` 6.10 (still its latest) does not accept ESLint 10 and `eslint-plugin-astro` 3.x requires it. The move condition is in §2.
  - Node floor 22.23.4 where Astro 7 runs; `@playwright/test` 1.65 pinned; `typescript-eslint` 8.73.
  - §7: rendered checks and a theme-contrast layer; notes on canvas pages under Playwright (SwiftShader, timeouts, WebGPU's WebGL 2 fallback on plain HTTP).
  - §8.2: W-42 to W-46, the rendered interface laws (contrast in every theme, reduced motion and pause, 24 px targets, visible focus, reflow at 320 px), judged with M4. 46 laws; the v0.1 target stays 26 judged.
  - §16: lint pin, profile order and build-suite location resolved; two new open items (proving WebGPU in a gate, who ships the rendered readers).
  - §20: LuminosiTS mapped as it is now (Astro site, `tokens` and `postfx`, the `lumin` CLI), and what it proved.

### Added

- M1, the `webtops` CLI, run from source on Bun (not published to npm):
  - `schema/web-tops.schema.json` and `schema/gate-report.schema.json`, and `src/config` with the class table (floors, CRAP caps, mapped layers and gate 1 steps), `PROTOCOL`, `loadConfig`, `validateConfig`, `runSemanticChecks` and `validateReport`.
  - `check` validates `web-tops.yaml` against the schema, then the semantic checks of §12; it exits 2 with a JSON pointer for each problem.
  - `gate` runs hygiene, tests and coverage and writes `.web-tops/report.json`; the CRAP, mutation, build-output and laws layers are registered stubs that report `not-run` when enabled.
  - `init --class` for the five launch classes, `report`, `lock`, `doctor` and `version`.
- The kit gates itself: `web-tops.yaml` (`ts-library`, `hard`; CRAP, mutation, build output and laws off with M2, M3 and M4 as reasons), `web-tops.lock` (the tool versions and the Node range, written by `lock --update`), and `.dependency-cruiser.cjs`.
- `WEB_TOPS.md`: the Web-TOPS protocol, draft 0.1.0. It supersedes the TS-TOPS 0.1.0 sketch, renamed because the protocol covers the web stack (TypeScript, HTML, CSS, Tailwind, Astro), not only TypeScript.
- `config/AGENTS.md.tmpl`: the `AGENTS.md` section that `webtops init` will write.
- `AGENTS.md` and `CLAUDE.md`: standing orders for agents working on this repo.
- `docs/brand/web-tops-logo.jpg`.
- Dual license, MIT OR Apache-2.0.
