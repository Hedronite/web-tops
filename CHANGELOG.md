# Changelog

All notable changes to this project are listed here. The protocol version and the package version are separate (see `WEB_TOPS.md` §2). Package versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

- `law-diff` compares the secretlint configuration (the `.secretlintrc.json` the W-39 reader reads, else the kit's preset, and each tracked `.secretlintignore`) and knip's (the `knip` key of `package.json` under the first of knip's config files, a code config by its hash): an added allow, ignore or ignored dependency, a widened `entry`, a narrowed `project`, a rule or plugin turned down or off is weaker. What it leaves out is on its fixed not-compared list: secretlint configuration in any other file, what `.gitignore` leaves out of a scan, and the options of a knip plugin beyond its `entry` and `project` (M3 G10).
- Acknowledgements of soft laws (M3 G8): `// webtops-ack W-NN: reason` comments and `.web-tops/acks.yaml` (`schema/acks.schema.json`). One without a reason, or not readable as an acknowledgement, fails, as does one of a hard law or of an id that is no law; `webtops acks` lists them, and `webtops check` reads the ledger. `webtops acks` marks each ledger entry `expires` or `expired`, an empty `acks.yaml` is an empty ledger, `webtops check` reports the survivor ledger and the ack ledger both, and `ackFor` and `ackedFiles` acknowledge nothing for a hard law or an id that is no law.
- The laws layer applies acknowledgements (M3 G8): a place of a soft law that a comment (on its line or the line above) or a ledger entry (for its file) acknowledges passes and carries its `ack`, and the law passes when every place does; a comment or entry of a hard law or of an id that is no law is a failing `ack-not-needed` or `ack-unknown-law` finding in the gate, and acknowledges nothing.
- Acknowledgements are a suppression census kind, `webtops-ack` (M3 G8): each comment and each ledger entry is counted, and baseline and ratchet hold the count; the gate reads the ledger the config names (`laws.ack_ledger`, else `.web-tops/acks.yaml`), and one that cannot be read fails the census.
- Milestone M3 opens: `knip`, `secretlint` with its recommended preset and `eslint-plugin-react-hooks` are pinned exactly in §2, `package.json` and the lock, and the M3 paths are in every tool scope. §8.1 and §17 name the law fixtures `fixtures/laws/W-NN/{bad,clean}/`. (G0)
- The diff step finds what the changed test files cover with one Vitest run for their HEAD versions and one for their merge-base versions, not one run of each file alone, and runs file by file only where a group gives nothing. The functions in scope, the mutants and the verdicts are the same; the cost of the step falls with the number of changed test files.

## [0.3.0] - 2026-11-19

The `webtops` CLI in this release implements protocol 0.3.0, and adds the risk engine of milestone M2. It measures CRAP and mutation survival natively, holds a baseline under `ratchet`, and gates this repo on itself with both at `hard`. The protocol stays 0.3.0; `report_version` is 2.2.0.

- StrykerJS is pinned exactly at the §2 versions, and the M2 source paths are in every tool scope. (G0)
- Findings have one shape (`tool`, `rule`, `law`, `fingerprint`), with `fp1` fingerprints that survive unrelated edits. Counts per rule per file derive from them. (G1)
- Coverage computes statement `cov(f)` per function, reports per-package numbers and coverage hints, and tells a Vitest setup file apart from an unimported file. (G2)
- The §6.3 complexity counter on the TypeScript AST, with §6.7 function keys and golden fixtures. (G3)
- The CRAP layer scores each function from its complexity and statement coverage, judges the functions a diff changes (or all, with `--all`), and the kit holds itself to cap 4. (G4)
- The CRAP cap per class is recorded from measurement over the kit and a real adopter: all five classes keep their cap, with the evidence in §5.2. (G5)
- The diff engine: changed ranges and functions against the merge base. A shallow clone is `fail`, an empty diff is `vacuous`, and a test-only diff maps to the functions its tests cover. (G6)
- The mutation layer runs StrykerJS on the diff's functions (or all of them, with `--all`) on the gate's own Vitest config, keys each survivor, and is `not-evaluated` past its time budget. (G7)
- The survivor key has six fields, and the survivor ledger `.web-tops/survivors.yaml` explains a survivor with a reason, an owner and an expiry; `webtops survivors` checks the ledger and counts the unexplained survivors of the last report. (G8)
- `webtops baseline` is the only writer of `.web-tops/baseline.json`, projected from the last report: CRAP per function, coverage per package, finding counts per rule per file, suppression counts by census kind and page bytes. Under `ratchet`, a rise in any count is refused, and deleting the file is not a reset. A first baseline takes legacy debt from a run that failed only on what a baseline holds, and the report says `crap_scope` (`report_version` 2.2.0). (G9)
- The suppression census reads eight directive comments (`eslint-disable`, `ts-expect-error`, `ts-ignore`, `ts-nocheck`, `stylelint-disable`, `biome-ignore`, `stryker-disable`, `html-validate-disable`) and three config-level kinds (`eslint-rule-off`, `eslint-ignores`, `tsconfig-exclude`), reports each as a `census/<kind>` finding, and the baseline counts them by kind. The two axe kinds, `axe-disable-rules` and `axe-exclude`, are read from the TypeScript syntax of each script that names `AxeBuilder`; an argument that is not a literal string (or an array of them) is a failing `census-axe-unreadable` finding, never a zero. (R75, PR 50)
- The mutation summary line counts each Stryker status (killed, timeout, survived, no-coverage, runtime-error, compile-error, ignored). Stryker's workers follow the CPUs the process can use and its timeout factor is 3, and a run in which more than a tenth of the judged mutants (and more than two) timed out is `not-evaluated`, because a timeout counts as killed and a loaded runner could hide a weak test. (R77, R78)
- The text report folds the passing census findings into one count for each kind. (PR 49)
- Protocol §6.4 makes the mutation time budget final: 30 minutes by default (`gates.mutation.time_budget_minutes`), no longer provisional. (PR 51)
- `webtops lock --update` adds the pinned tools that are installed. (PR 32)
- The survivor ledger keeps the leading whitespace of a key. (PR 42)
- The kit's own gate runs CRAP and mutation at `hard` in the one `gate` job on both operating systems; the Stryker config keeps the checker's own type-check setting so that fixtures are read as they are; the kit's tests have a 30 s timeout for real-tool runs. (G10)

## [0.2.0] - 2026-11-17

The `webtops` CLI in this release implements protocol 0.3.0. The verdicts, the report schema, the lint stack and the configuration changed since 0.1.0, which implemented protocol 0.2.1. Protocol 0.3.0 is the truth pass: the text, the schemas and the fixtures agree, and the kit gates itself on them.

- Protocol id checked by the supported range: `check` accepts 0.3.x and exits 2 at `/protocol` outside it. `probes/**` and `fixtures/probe/**` are reserved in every tool scope. (G0)
- Protocol 0.3.0 has one verdict set in `schema/core.schema.json`. The report, runner and printer use it. Laws run at tier 1 and judge a stopped run. (G1)
- The gate report carries `report_version`, `subject`, `run`, `required`, `metrics` and `counts.required_not_evaluated`, and the baseline is a projection of it. (G2)
- Each class requires its layers and the judged laws it maps (§5.2). Under `hard`, `check` refuses a looser floor, cap or survivors limit. `layers.rendered` and `layers.themes` have reserved shapes. `skip_private` skips the package-exports check for a private package. There is one example config per launch class, and `enforce` takes its modes from the core schema. (G3)
- Protocol 0.3.0 defines `cov(f)` by body statements, the mutation status table, the widened scope, the survivor key, the time-budget rule, the function key and a normative suppression census. `fixtures/probe/` holds one cheat per case. (G4)
- The gate job runs on Ubuntu and macOS; `engines` names Node and Bun. (G5)
- W-22 is proven on ESLint 10 through `eslint-plugin-jsx-a11y-x`. (G6)
- The lint pin moves to ESLint 10.15 with `@eslint/js` 10.0, `eslint-plugin-astro` 3.2 and `eslint-plugin-jsx-a11y-x` 0.2 (W-22's reader). §2 lists the pins and the law readers. (G7)
- §7 presets and page JavaScript defined; W-06, W-13, W-22 and W-35 corrected; W-47 (rules of hooks) and W-48 (unused code) added; the template names W-42 to W-46 and cites §3.4. (G8)
- §19 is the roadmap, from P3 through M7; §16 records the 0.3.0 decisions; §3.4 holds the full list of stated rules. (G9)

## [0.1.0] - 2026-11-17

The `webtops` CLI in this release implements protocol 0.2.1; the 0.3.0 text is merged but not yet implemented.

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

[Unreleased]: https://github.com/Hedronite/web-tops/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Hedronite/web-tops/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Hedronite/web-tops/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Hedronite/web-tops/releases/tag/v0.1.0
