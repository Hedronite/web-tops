<p align="center">
  <img src="docs/brand/web-tops-logo.jpg" alt="web-tops logo" width="640" />
</p>

# Web-TOPS

**A protocol and drop-in kit for web code that is correct, dense, accessible, and fast.**
TypeScript is the foundational language; HTML, CSS, Tailwind CSS and Astro complement it. The gate checks the source and the build output the browser receives.

[Protocol](WEB_TOPS.md) · [Agent harness](AGENTS.md) · [Changelog](CHANGELOG.md)

## Status

Draft. Protocol **0.1.0**. The package is unreleased (0.0.0). There is no code yet.

This repo is at milestone M0: the spec. `webtops` does not exist yet, and nothing here is ready to copy into CI.

| Milestone | Contents |
|---|---|
| **M0** spec | `WEB_TOPS.md`, schemas, profiles for five launch classes, the AGENTS template |
| M1 CLI | `init`, `check`, `gate`: hygiene, tests, coverage, `report.json`; Web-TOPS gates itself |
| M2 | Native CRAP, Stryker adapter, survivor ledger, baseline and ratchet |
| M3 | Laws v0.1: 26 of 41 judged; lint fixtures; `eslint-plugin-webtops` |
| M4 | Build-output layers: HTML validity, axe, links, byte budgets |
| M5–M6 | First adopter, protocol 1.0 |

The full roadmap is in [`WEB_TOPS.md` §19](WEB_TOPS.md#19-roadmap).

## What it checks

| Layer | Tools (pinned in §2) |
|---|---|
| Types and lint | TypeScript 6.0 (strict, `erasableSyntaxOnly`), type-aware `typescript-eslint`, `astro check`, Stylelint |
| Boundaries and packages | `dependency-cruiser`, `publint`, `@arethetypeswrong/cli` |
| Tests | Vitest with v8 coverage, one run; StrykerJS mutation on the diff |
| Risk | Native CRAP, one cap per class, ratcheted for adopters |
| What ships | `html-validate` and axe on built pages; JS and CSS bytes per page or route |

TypeScript is pinned to 6.0.x because `typescript-eslint` and `@astrojs/check` do not yet accept TypeScript 7. See [§2](WEB_TOPS.md#2-pins).

## What is here

| Path | What it is |
|---|---|
| [`WEB_TOPS.md`](WEB_TOPS.md) | The protocol, draft 0.1.0 |
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
