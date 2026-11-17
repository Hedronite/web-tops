# Changelog

All notable changes to this project are listed here. The protocol version and the package version are separate (see `WEB_TOPS.md` §2). Package versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

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
