<p align="center">
  <img src="docs/brand/web-tops-logo.jpg" alt="web-tops logo" width="640" />
</p>

# Web-TOPS

**A protocol and drop-in kit for web code that is correct, dense, accessible, and fast.**
TypeScript is the foundational language; HTML, CSS, Tailwind CSS and Astro complement it. The gate checks the source and the build output the browser receives.

[Protocol](WEB_TOPS.md) · [Agent harness](AGENTS.md) · [Changelog](CHANGELOG.md)

## Status

Draft. Protocol **0.3.0**; this tree implements it: one verdict set, the report shape, required layers and laws per class, and the protocol id checked by range. The package is version 0.2.0 (the 0.1.0 release implements 0.2.1): a GitHub release, private, not published to npm.

This repo has shipped milestones M1 and M2: the `webtops` CLI (`init`, `check`, `gate`, `report`, `lock`, `doctor`, `version`, `survivors`, `baseline`) runs from source on Bun and gates this repo on itself at tier 1, under `enforce: hard`, with native CRAP at cap 4 and StrykerJS mutation on the diff, no unexplained survivors, in the one `gate` job on Ubuntu and macOS. The laws layer and the build-output layers are off in [`web-tops.yaml`](web-tops.yaml), each with the milestone that turns it on. The package is not published to npm.

| Milestone | Contents |
|---|---|
| **M0** | `WEB_TOPS.md`, schemas, profiles for five launch classes, the AGENTS template |
| **M1** | `init`, `check`, `gate`: hygiene, tests, coverage, `report.json`; Web-TOPS gates itself |
| **P3** | Protocol 0.3.0, the truth pass: one verdict set, required layers and laws per class, the report shape, risk definitions, the protocol id by range, ESLint 10 (this repo) |
| **M2** | The risk engine, shipped: native CRAP, the Stryker adapter, the survivor ledger, baseline and ratchet; the kit runs CRAP and mutation on itself at `hard` |
| **M3** | Laws v1: `laws/W-NN.yaml`, law fixtures, `eslint-plugin-webtops`, the non-lint readers, `law-diff` |
| **M4** | Build output: HTML validity, links, page and route bytes, axe, `size-limit` per entry |
| **M5** | Rendered interface and themes: reflow, focus, motion, theme contrast |
| **M6** | Workspaces and adoption: the `workspace-root` and `cli` profiles, the adopter PRs |
| **M7** | Calibration and 1.0 |

The full roadmap is in [`WEB_TOPS.md` §19](WEB_TOPS.md#19-roadmap).

## Run it

```bash
bun install --frozen-lockfile
bun src/cli/main.ts check          # web-tops.yaml: schema, then the semantic checks
bun src/cli/main.ts gate           # tier 1: hygiene, tests, coverage, CRAP, mutation on the diff
```

## What it checks

| Layer | Tools (pinned in §2) |
|---|---|
| Types and lint | TypeScript 6.0 (strict, `erasableSyntaxOnly`), type-aware `typescript-eslint`, `astro check`, Stylelint |
| Boundaries and packages | `dependency-cruiser`, `publint`, `@arethetypeswrong/cli` |
| Tests | Vitest with v8 coverage, one run; StrykerJS mutation on the diff |
| Risk | Native CRAP, one cap per class, ratcheted for adopters |
| What ships | `html-validate` and axe on built pages; JS and CSS bytes per page or route |

TypeScript is pinned to 6.0.x because `typescript-eslint` and `@astrojs/check` do not yet accept TypeScript 7, and ESLint to 10.15 with `eslint-plugin-jsx-a11y-x`, the fork of `eslint-plugin-jsx-a11y` that accepts it. See [§2](WEB_TOPS.md#2-pins).

## What is here

| Path | What it is |
|---|---|
| [`WEB_TOPS.md`](WEB_TOPS.md) | The protocol, draft 0.3.0 |
| [`schema/`](schema) | `web-tops.schema.json` and `gate-report.schema.json` |
| [`src/`](src) | The `webtops` CLI (`src/cli`), the config module and class table (`src/config`), the gate runner (`src/gate`) and its layers (`src/layers`), `init` (`src/init`), the lock format (`src/lock`) and the report writer (`src/report`) |
| [`web-tops.yaml`](web-tops.yaml) | This repo's own config: class `ts-library`, `enforce: hard` |
| [`config/AGENTS.md.tmpl`](config/AGENTS.md.tmpl) | The `AGENTS.md` section that `webtops init` will write into an adopting repo |
| [`AGENTS.md`](AGENTS.md) | Standing orders for agents working on this repo ([`CLAUDE.md`](CLAUDE.md) imports it) |

## Related

- [Rust-TOPS](https://github.com/Hedronite/rust-tops): the original protocol.
- [Go-TOPS](https://github.com/Hedronite/go-tops): the Go protocol. Web-TOPS starts from its 0.3.0 fixes.

## Contributing

Read `WEB_TOPS.md` and `AGENTS.md` first. Work on a branch and open a draft PR. A change to laws, schema, profiles, thresholds, budgets, drop-in lint rules or normative spec text is a protocol change: it carries the `protocol-change` label, a changelog entry, and a protocol version bump.

## Credits

Built by [Hedronite](https://github.com/Hedronite). Structure adapted from Rust-TOPS and Go-TOPS. CRAP scores use the 2007 Change Risk Anti-Patterns formula (Savoia and Evans); this kit did not originate that metric.

## License

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or <http://www.apache.org/licenses/LICENSE-2.0>)
- MIT license ([LICENSE-MIT](LICENSE-MIT) or <http://opensource.org/licenses/MIT>)

at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in this work, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.
