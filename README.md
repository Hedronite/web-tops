# Web-TOPS

<p align="center">
  <img src="docs/brand/web-tops-logo.jpg" alt="Web-TOPS product mark and wordmark" width="720" />
</p>

<p align="center"><strong>A protocol and drop-in kit for web code that is correct, dense, accessible, and fast.</strong><br/>
TypeScript is the foundational language; HTML, CSS, Tailwind CSS, and Astro complement it. The gate checks the source and the build output the browser receives.</p>

<p align="center">
  <a href="https://www.typescriptlang.org"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6.0-3178C6?style=flat-square&logo=typescript&logoColor=white&labelColor=0A0A0A" /></a>
  <a href="https://github.com/Hedronite"><img alt="Hedronite" src="https://img.shields.io/badge/org-Hedronite-0CB8B0?style=flat-square&logo=github&logoColor=white&labelColor=0A0A0A" /></a>
  <a href="WEB_TOPS.md"><img alt="Protocol 0.3.0" src="https://img.shields.io/badge/protocol-0.3.0-0CB8B0?style=flat-square&labelColor=0A0A0A" /></a>
  <a href="https://github.com/Hedronite/web-tops/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/Hedronite/web-tops?style=flat-square&label=release&labelColor=0A0A0A&color=0CB8B0" /></a>
  <a href="LICENSE"><img alt="License: MIT OR Apache-2.0" src="https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-0CB8B0?style=flat-square&labelColor=0A0A0A" /></a>
  <a href="https://github.com/Hedronite/web-tops/actions/workflows/web-tops.yml"><img alt="CI workflow: web-tops" src="https://img.shields.io/github/actions/workflow/status/Hedronite/web-tops/web-tops.yml?branch=main&style=flat-square&label=ci&labelColor=0A0A0A&color=0CB8B0" /></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#what-you-get">What you get</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#status">Status</a> ·
  <a href="WEB_TOPS.md">Protocol</a> ·
  <a href="AGENTS.md">Harness</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  Built by <a href="https://github.com/Hedronite">Hedronite</a>. Structure adapted from Rust-TOPS and Go-TOPS.<br/>
  CRAP scores use the 2007 Change Risk Anti-Patterns formula. This kit did not originate that metric.
</p>

---

Web-TOPS (Web Testing and Optimization Protocol Suite) is a protocol and drop-in kit for web work. TypeScript is the foundational language; HTML, CSS, Tailwind CSS, and Astro complement it. The gate is meant to check the source and the build output the browser receives.

The `webtops` CLI in this tree runs from source on Bun and gates this repository, and the example in `examples/node-service`, at tier 1, with native CRAP, StrykerJS mutation on the diff and the laws layer. The package is not published to npm.

## Pins

| Plane | Pin | Where |
| --- | --- | --- |
| Protocol | 0.3.0 | [`WEB_TOPS.md`](WEB_TOPS.md) and `PROTOCOL` in [`src/config/protocol.ts`](src/config/protocol.ts) |
| Package | 0.3.0, private | [`package.json`](package.json). Not published to npm |
| GitHub release | v0.3.0 | Implements protocol 0.3.0 |
| Runtime | Bun >= 1.4.0; Node 22.23.4, 24.15.0, or 26 and later | [`package.json`](package.json) `engines` |
| TypeScript | 6.0.x | Pinned because `typescript-eslint` and `@astrojs/check` do not yet accept TypeScript 7. See [§2](WEB_TOPS.md#2-pins) |

## Quick start

```bash
bun install --frozen-lockfile
bun src/cli/main.ts check
bun src/cli/main.ts gate
```

`check` validates `web-tops.yaml` against the schema, then the semantic checks. `gate` runs hygiene, tests, coverage, CRAP, mutation on the diff and the laws at tier 1. This repository's CI runs `bun src/cli/main.ts gate --max-tier 1`, for the kit and then for the example.

## What you get

| | Tooling you wire yourself | This kit today |
| --- | --- | --- |
| Contract | Docs and tests you arrange | Protocol 0.3.0, JSON Schemas, and profiles for five launch classes |
| Orchestrator | You sequence the commands | `webtops` `init`, `check`, `gate`, `report`, `lock`, `doctor`, `version`, `survivors`, `baseline`, `laws`, `acks`, `law-diff`, run from source on Bun |
| CI on this repo | — | The one `gate` job in [`.github/workflows/web-tops.yml`](.github/workflows/web-tops.yml), on Linux and macOS |

The protocol's later layers, once they are on, check:

| Layer | Tools (pinned in §2) |
| --- | --- |
| Types and lint | TypeScript 6.0 (strict, `erasableSyntaxOnly`), type-aware `typescript-eslint`, `astro check`, Stylelint |
| Boundaries and packages | `dependency-cruiser`, `publint`, `@arethetypeswrong/cli` |
| Tests | Vitest with v8 coverage, one run; StrykerJS mutation on the diff |
| Risk | Native CRAP, one cap per class, ratcheted for adopters |
| What ships | `html-validate` and axe on built pages; JS and CSS bytes per page or route |

### What you do not get

| Claim | Reality |
| --- | --- |
| An npm package | `package.json` is private. Install and run from this tree |
| Build-output checks on this repo today | That layer is off in [`web-tops.yaml`](web-tops.yaml), until M4. The laws layer, native CRAP at cap 4 and StrykerJS mutation on the diff are on, with no unexplained survivors |
| A test framework or a design system | `webtops` runs Vitest, Playwright, Stryker, and related tools; it does not replace them, and it does not enforce an aesthetic |

## How it works

The gate judges what ships: the browser receives HTML, CSS, and JavaScript, not `.astro` or `.tsx`. A layer that was not evaluated is reported as not evaluated, never as a pass.

| Path | Role |
| --- | --- |
| [`WEB_TOPS.md`](WEB_TOPS.md) | The protocol, draft 0.3.0 |
| [`schema/`](schema) | `web-tops.schema.json` and `gate-report.schema.json` |
| [`src/`](src) | The `webtops` CLI and the config, gate, init, lock, and report modules |
| [`web-tops.yaml`](web-tops.yaml) | This repository's own config: class `ts-library`, `enforce: hard` |
| [`config/AGENTS.md.tmpl`](config/AGENTS.md.tmpl) | The `AGENTS.md` section that `webtops init` writes into an adopting repo |
| [`AGENTS.md`](AGENTS.md) | Editing harness for this repository ([`CLAUDE.md`](CLAUDE.md) imports it) |

## Status

Draft. Protocol **0.3.0**; this tree implements it: one verdict set, the report shape, required layers and laws per class, and the protocol id checked by range. The package is version 0.3.0 (the 0.1.0 release implements 0.2.1): a GitHub release, private, not published to npm.

This repository has shipped milestones M1, M2 and M3: the `webtops` CLI (`init`, `check`, `gate`, `report`, `lock`, `doctor`, `version`, `survivors`, `baseline`, `laws`, `acks`, `law-diff`) runs from source on Bun and gates this repo on itself at tier 1, under `enforce: hard`, with native CRAP at cap 4 and StrykerJS mutation on the diff, no unexplained survivors, in the one `gate` job on Ubuntu and macOS. The laws layer runs on the kit at `hard`: every law the `ts-library` profile requires is judged (22 of 22), and `examples/node-service` gates itself the same way in the same job (21 of 21). The build-output layers are off in [`web-tops.yaml`](web-tops.yaml), each with the milestone that turns it on. The package is not published to npm.

| Milestone | Contents |
| --- | --- |
| **M0** | `WEB_TOPS.md`, schemas, profiles for five launch classes, the AGENTS template |
| **M1** | `init`, `check`, `gate`: hygiene, tests, coverage, `report.json`; Web-TOPS gates itself |
| **P3** | Protocol 0.3.0, the truth pass: one verdict set, required layers and laws per class, the report shape, risk definitions, the protocol id by range, ESLint 10 (this repo) |
| **M2** | The risk engine, shipped: native CRAP, the Stryker adapter, the survivor ledger, baseline and ratchet; the kit runs CRAP and mutation on itself at `hard` |
| **M3** | Laws v1, shipped: `laws/W-NN.yaml`, law fixtures, `eslint-plugin-webtops`, the non-lint readers, the ack ledger, `law-diff`; the kit and `examples/node-service` run the laws layer at `hard` |
| **M4** | Build output: HTML validity, links, page and route bytes, axe, `size-limit` per entry |
| **M5** | Rendered interface and themes: reflow, focus, motion, theme contrast |
| **M6** | Workspaces and adoption: the `workspace-root` and `cli` profiles, the adopter PRs |
| **M7** | Calibration and 1.0 |

The full roadmap is in [`WEB_TOPS.md` §19](WEB_TOPS.md#19-roadmap).

## Related

- [Rust-TOPS](https://github.com/Hedronite/rust-tops): the original protocol.
- [Go-TOPS](https://github.com/Hedronite/go-tops): the Go protocol. Web-TOPS starts from its 0.3.0 fixes.

## Contributing

Read [`WEB_TOPS.md`](WEB_TOPS.md) and [`AGENTS.md`](AGENTS.md) first. Work on a branch and open a draft PR. A change to laws, schema, profiles, thresholds, budgets, drop-in lint rules or normative spec text is a protocol change: it carries the `protocol-change` label, a changelog entry, and a protocol version bump.

## Credits and license

Built by [Hedronite](https://github.com/Hedronite). Structure adapted from Rust-TOPS and Go-TOPS. CRAP scores use the 2007 Change Risk Anti-Patterns formula (Savoia and Evans); this kit did not originate that metric.

Licensed under MIT OR Apache-2.0, at your option. See [`LICENSE`](LICENSE), [`LICENSE-MIT`](LICENSE-MIT), and [`LICENSE-APACHE`](LICENSE-APACHE).

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in this work, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.
