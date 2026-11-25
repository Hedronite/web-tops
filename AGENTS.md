# Agent standing orders (Web-TOPS 0.3.0, draft)

Goal: correct, dense, accessible, fast web code. TypeScript first; HTML, CSS, Tailwind and Astro on top.
Production: the fewest lines that keep the named invariants and measured budgets.
Tests: as many as the contract needs. Never write tests by reading the implementation.

The protocol text is [`WEB_TOPS.md`](WEB_TOPS.md). This file is the harness for work on this repo.
[`config/AGENTS.md.tmpl`](config/AGENTS.md.tmpl) is the section `webtops init` will write into an adopting repo. It is not the harness for this repo.

## State

Milestone M3: the `webtops` CLI gates this repo on itself and on `examples/node-service`. It runs from source on Bun, not from npm: `bun src/cli/main.ts <command>` for `check`, `gate`, `init`, `report`, `lock`, `doctor`, `version`, `survivors`, `baseline`, `laws`, `acks` and `law-diff`. CI is the one `gate` job (`.github/workflows/web-tops.yml`): it gates the kit, then the example. [`web-tops.yaml`](web-tops.yaml) sets class `ts-library` under `enforce: hard`, with native CRAP, StrykerJS mutation on the diff and the laws layer on. The laws layer judges every required law (22 of 22, printed as N of M). Baseline and ratchet are built. Only build output is off, until M4.

Version 0.4.0 implements protocol 0.3.0 (the 0.1.0 release implements 0.2.1).

Before you finish, from a clean tree: `bun install --frozen-lockfile`, `bun run format:check`, `bun run typecheck`, `bun run lint`, `bun run test`, then `bun src/cli/main.ts gate`. Do not document, run or claim a command that has not landed: build output and the rendered checks are M4 and M5.

The kit is TypeScript on Bun and gates itself `hard` with its own protocol (§17).

## Do this

1. Read the section of `WEB_TOPS.md` you are changing, and the schema in `schema/`. Fix the schema first, then the prose (§3.4).
2. A change to `laws/`, `schema/`, `profiles/`, a threshold, a budget, a lint rule or tsconfig flag in the drop-ins, or normative text in `WEB_TOPS.md` is a protocol change. It carries the `protocol-change` label and a `CHANGELOG.md` entry, and bumps the protocol version together with the schema.
3. Write the oracle from the contract first, then the smallest shape that satisfies it, then run the gate.

## Git

- Work on a branch and open a draft PR. Never push `main`, force-push, tag or publish a release or package.
- Fixes are new commits on the PR branch.
- No secrets, tokens, `.env` files, local paths or internal notes in the repo.

## Forbidden

- Writing tests from the current function body.
- Splitting a function only to lower its CRAP score (scar-guard).
- Weakening a law, lint rule, tsconfig flag, threshold or budget so a check passes.
- Counting `not-evaluated`, an unmapped layer, or an empty report as a pass.
- `any`, `as` (other than `as const`) and `!` in kit code.
- A suppression without the rule name and a reason; `@ts-ignore` and `@ts-nocheck`.
- Floating promises.
- Editing generated files. Fix the generator.
- Adding a dependency that does not delete code or buy measured safety or performance.
