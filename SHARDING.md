# Sharding the mutation run (option B): design and prototype

Status: local draft on `m3/mutation-shard` (not pushed). Nothing here changes the gate's config or the budget.

## Facts measured (PR 70 head, 75 mutate entries, apiary, Stryker concurrency 2, no lock)

- Stryker 10.1.1 (pinned in `package.json` and `web-tops.lock`) has no sharding option; `stryker run --help` lists `--mutate`, `--dryRunOnly`, `--incremental`, no shard.
- The cost of a shard is not only its mutants: each Stryker process instruments, runs the TypeScript checker start-up and a dry run of the tests that cover its files. Dry runs, whole vs shards: 1 shard 114 s; 2 shards 109 s and 117 s; 4 shards 140, 96, 146, 123 s. So a fixed 1.5 to 2.5 minutes per shard, and it does not shrink with the shard (a shard whose entries touch widely used code still runs thousands of tests).
- On CI (3 to 4 CPUs) PR 70's mutation run is about 30 minutes of the 33 (estimate, the job log does not split it). ESTIMATES, not measured on CI: two shards about 15 + 2.5 = 17 minutes each, four about 7.5 + 2.5 = 10 minutes each, in parallel.

## 1. The unit

The `mutate` entries (`file:start-end`, whole scored units after `snapEntries`, section 6.7). `shardOf(entries, i, n)` (src/layers/mutation/shard.ts): dedupe, sort by (file, start, end), give each entry a weight (its line count; a whole file weighs 1 unless the caller passes line counts), place entries heaviest first on the lightest shard (ties to the lowest index), return shard i in source order. Pure and deterministic: the same entries give the same shards on every machine and OS, in any input order. Entries are never cut, so the occurrence in a survivor key (which counts within a function) is the same in a shard as in the whole run. Index modulo n would also work but balances worse because function size varies by 100x.

## 2. Keeping "one job, one command"

Section 11 says the gate is one job running one command. Recommended (B1): the same command everywhere, `webtops gate --max-tier 1 --shard i/n`, run by every shard job: layers 1 to 4 run in full on each shard (about 2 to 3 minutes of CI, duplicated) and only layer 5 runs on its partition, so every shard writes a complete gate report whose mutation block covers its shard. One more command, `webtops gate --join <dir>`, reads the n reports and prints the one report with one verdict (below). The matrix is still "one job, one command, per cell"; the join job is a second, small job.
Alternative (B2): only the mutation layer is sharded (`--only mutation --shard i/n`), layers 1 to 4 run once in a plain `gate` job, and a join job merges. About 3 minutes cheaper per shard but it breaks the uniform command and splits the report into two producers, so I do not recommend it.

## 3. Accounting across shards

- A shard cut by the budget is `not-evaluated` and the join is `not-evaluated`: the join requires every shard 1..n present (a missing or duplicated shard is `fail` with the missing index named) and the same `n`, the same base SHA and the same entries hash (the sorted entries joined, hashed, written in each partial report).
- The join adds the status counts (`metrics.mutation`) and takes the union of survivors; the ledger and the ratchet run once, on the union, in the join, never per shard. A per-shard survivor is therefore not judged against `max_survivors` alone: the join decides. The timeout starvation rule (more than a tenth and more than two) is applied to the summed counts, and a shard that was starved on its own makes the join `not-evaluated`.
- The time budget applies per shard (30 minutes each), which is what makes the whole fit.

## 4. CI shape and cost

`strategy.matrix`: `os: [ubuntu, macos]` x `shard: [1,2,3,4]`; each shard uploads `.web-tops/out/mutation/partial.json`; a final job (`needs: [gate]`) downloads all, runs `bun src/cli/main.ts gate --join`, prints the report, fails on its exit code. Total CI minutes go up: 4 shards x (2 to 4 minutes of layers 1 to 4 + 2.5 fixed + 7 mutants) is about 50 runner-minutes per OS against about 33 now, but wall time falls from 33 to about 12 minutes per OS and the macOS miss goes away. Two shards give 17 minutes wall for about 40 runner-minutes. Both fit with margin under the 45 minute job limit.

## 5. Protocol changes (WEB_TOPS.md, protocol-change PR)

6.4 (shard partition, the partial report, the join, accounting, and that the budget is per shard); 11 (the workflow becomes a matrix plus a join job, and the "one job running one command" sentence is restated as: one command, `webtops gate`, in every job); 12 (`gate --shard i/n`, `gate --join <dir>`); 6.6 only if the report records `shard`/`shards` (optional fields, report_version minor bump, partial reports validate as reports with `passed: false`). `init`'s generated workflow stays one job (adopters' diffs are small); sharding is the kit's own workflow first.
PR order: (1) `shardOf` + the CLI flags and the partial report, no workflow change (backend); (2) `--join` (backend); (3) protocol-change PR with WEB_TOPS.md and the kit workflow (needs Evan: the section 6.4 time budget semantics and the section 11 rule).

## 6. Risks

- Fixed cost per shard (1.5 to 2.5 minutes) means more shards than about 4 stop helping.
- A shard that fails (not-evaluated) must not be reported as a pass by the join; the join must fail closed on any missing or mismatched shard (hash and n).
- Static mutants run in every shard that mutates a file with module-level code (they rerun the suite): shards should keep a file's entries together when a file has module-level ranges; `shardOf` places whole entries, not files, so that is a possible refinement (group by file first, then balance files).
- Survivor occurrence relies on whole scored units never being split: guaranteed by `snapEntries`; `shardOf` asserts no cutting but does not check overlap of its input.
- The ratchet baseline and the survivor ledger are read once, by the join; per-shard runs must not write them.
- 

## Prototype result (apiary, Stryker 10.1.1, concurrency 2, PR 70 head e05a7dd, entries from the real diff scope: 75)

- `shardOf`: 7 tests (complete and disjoint for 1 to 12 shards, order and repeat independent, balanced, caller weights, empty shard, bad index refused); tsc, eslint (complexity 4) and prettier clean.
- Generated mutants, whole run 1102; two shards 594 + 508 = 1102 (entries 39 + 36 = 75). Four shards: first shard 320.
- A full Stryker run of a 6-entry subset (40 mutants) whole vs shard 1/2 (21) and 2/2 (19): the two shards are disjoint, their union is exactly the whole run's 40 mutants, and every mutant has the same status in both (33 Killed, 7 CompileError). Identity was (file, mutator, location, replacement).
- Dry-run overhead per shard 1.5 to 2.5 minutes (see Facts).

## Open decisions for Evan

1. Is a shard-per-job matrix (more CI runner-minutes, less wall time) acceptable, against the budget change (A)?
2. n: two shards (17 min estimated, fewest minutes) or four (10 min)?
3. B1 (full gate per shard) or B2 (mutation only)? I recommend B1.
4. The time budget stays 30 minutes but per shard: this is a change to the meaning of section 6.4's budget.
5. Whether `init`'s generated workflow stays a single job (recommended) with sharding only in the kit's own workflow.
