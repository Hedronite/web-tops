# Changelog

All notable changes to this project are listed here. The protocol version and the package version are separate (see `WEB_TOPS.md` §2). Package versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Protocol 0.2.0 → 0.2.1 (draft), the keys the configuration schema needs before the CLI can be written:
  - §9: every gate and layer, and `laws`, takes `enabled` and `reason`; `enabled: false` needs a reason, printed with `skip`. `gates.coverage.exclude` holds the reasoned coverage exclusions §6.1 already required.
  - §3.3: `not-run` also covers layers a stopped run never reached. §6.6: the report counts the layers in range and the layers that ran.
  - §3.3: verdict precedence (config off, class, no command) and what counts as in range, so `--only` runs and class-unmapped layers do not fail the count.
  - §6.6: the report's fields, verdict spellings, reasons on `skip` and `not-run`, and how an acknowledged `Ack` is marked. §6.1: test files are excluded from coverage by default.
  - §9: `exemption` for `advisory`; gate 1 step keys and `format.tool`; `custom` item shape; enums; `laws.enable` renamed `laws.select`; under `hard`, mapped gates and steps at tier 1 or below, other than CRAP, mutation, build output and laws, cannot be switched off; `exemption.until` is a UTC date valid through that day. `astro_check` follows the project, not only the class: always for `astro-site`, and for `web-app` and `ui-components` when they depend on `astro`, including as a peer. §6.6 names a finding's fields.
  - §16: four items resolved (15 to 18); open items numbered O1 to O6. §14 header at 0.2.1; §18 sketch at 0.2.1.
- Protocol 0.1.0 → 0.2.0 (draft), from what the first adopter, LuminosiTS, proved in practice:
  - Lint pins: ESLint 9.39 and `eslint-plugin-astro` 1.7, because `eslint-plugin-jsx-a11y` 6.10 (still its latest) does not accept ESLint 10 and `eslint-plugin-astro` 3.x requires it. The move condition is in §2.
  - Node floor 22.23.4 where Astro 7 runs; `@playwright/test` 1.65 pinned; `typescript-eslint` 8.73.
  - §7: rendered checks and a theme-contrast layer; notes on canvas pages under Playwright (SwiftShader, timeouts, WebGPU's WebGL 2 fallback on plain HTTP).
  - §8.2: W-42 to W-46, the rendered interface laws (contrast in every theme, reduced motion and pause, 24 px targets, visible focus, reflow at 320 px), judged with M4. 46 laws; the v0.1 target stays 26 judged.
  - §16: lint pin, profile order and build-suite location resolved; two new open items (proving WebGPU in a gate, who ships the rendered readers).
  - §20: LuminosiTS mapped as it is now (Astro site, `tokens` and `postfx`, the `lumin` CLI), and what it proved.

### Added

- `WEB_TOPS.md`: the Web-TOPS protocol, draft 0.1.0. It supersedes the TS-TOPS 0.1.0 sketch, renamed because the protocol covers the web stack (TypeScript, HTML, CSS, Tailwind, Astro), not only TypeScript.
- `config/AGENTS.md.tmpl`: the `AGENTS.md` section that `webtops init` will write.
- `AGENTS.md` and `CLAUDE.md`: standing orders for agents working on this repo.
- `docs/brand/web-tops-logo.jpg`.
- Dual license, MIT OR Apache-2.0.
