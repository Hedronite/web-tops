// bun probes/w22/run.ts, from probes/w22/ after `bun install --frozen-lockfile`.
// Lints every fixture through ESLint 10 plus the fork, oxlint, and the ESLint 9.39 control;
// writes RESULT.json and RESULT.md; prints the table and the verdict lines.
import { spawnSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { allPass, fixturePair, judgeRule } from "./judge.ts";
import { observeOxlint } from "./oxlint.ts";
import { installedVersion, ROOT } from "./support.ts";
import { renderTable, type EngineRows } from "./table.ts";
import type { Cell, DeprecatedNote, Observation, Row } from "./types.ts";

const ORACLE = { name: "eslint-plugin-jsx-a11y", version: "6.10.2" };
const STACK = [
  "@typescript-eslint/no-floating-promises",
  "@typescript-eslint/no-unnecessary-condition",
  "@eslint-community/eslint-comments/disable-enable-pair",
  "@eslint-community/eslint-comments/no-unlimited-disable",
  "@eslint-community/eslint-comments/require-description",
];

function worker(...args: string[]): Observation {
  const run = spawnSync("node", ["worker.ts", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  if (run.status !== 0) throw new Error(`worker ${args.join(" ")} failed:\n${run.stderr}`);
  return JSON.parse(run.stdout);
}

function checkFixtures(rules: readonly string[]): void {
  const have = readdirSync(join(ROOT, "fixtures/rules")).sort();
  const want = rules
    .flatMap((rule) => fixturePair(rule).map((f) => f.slice("fixtures/rules/".length)))
    .sort();
  if (have.join() !== want.join()) {
    throw new Error(
      "fixtures/rules does not hold exactly one bad and one clean file per oracle rule",
    );
  }
}

function engineRows(
  label: string,
  obs: Observation,
  rules: readonly string[],
  dep: ReadonlySet<string>,
): EngineRows {
  const rows = rules.map((rule) => judgeRule(obs, rule, dep.has(rule)));
  return { id: obs.engine, label, version: obs.version, rows };
}

function inBar(row: Row): boolean {
  return !row.deprecated;
}

function summary(engine: EngineRows) {
  const bar = engine.rows.filter(inBar);
  return {
    id: engine.id,
    version: engine.version,
    bar_pass: allPass(bar),
    bar_rows_passed: bar.filter((row) => row.cell === "pass").length,
    bar_rows_total: bar.length,
    all_rows_passed: engine.rows.filter((row) => row.cell === "pass").length,
    all_rows_total: engine.rows.length,
    rows: engine.rows,
  };
}

function cellsOf(engines: readonly EngineRows[], rule: string): Record<string, Cell> {
  const cell = (e: EngineRows): Cell => e.rows.find((r) => r.rule === rule)?.cell ?? "fail";
  return Object.fromEntries(engines.map((e) => [e.label, cell(e)]));
}

function deprecatedNotes(engines: readonly EngineRows[], obs: Observation): DeprecatedNote[] {
  return [...obs.deprecated].sort().map((rule) => {
    const replaced_by = obs.replaced_by[rule] ?? [];
    return {
      rule,
      replaced_by,
      cells: cellsOf(engines, rule),
      replacement_cells: Object.fromEntries(replaced_by.map((r) => [r, cellsOf(engines, r)])),
    };
  });
}

function show(cells: Readonly<Record<string, Cell>> | undefined): string {
  return Object.entries(cells ?? {})
    .map(([engine, cell]) => `${engine} ${cell}`)
    .join(", ");
}

function noteLine(note: DeprecatedNote): string {
  const by = note.replaced_by.map((r) => `${r} (${show(note.replacement_cells[r])})`).join("; ");
  const next = by === "" ? "no replacement upstream" : `replaced upstream by ${by}`;
  return `- ${note.rule}: deprecated upstream, not in the bar; here: ${show(note.cells)}; ${next}`;
}

function reader(candidates: readonly EngineRows[], keep: (row: Row) => boolean): string {
  const winner = candidates.find((engine) => allPass(engine.rows.filter(keep)));
  return winner === undefined ? "none" : winner.label;
}

function firedRules(obs: Observation, file: string): string[] {
  const rules = (obs.files[file] ?? []).flatMap((fire) => (fire.rule === null ? [] : [fire.rule]));
  return [...new Set(rules)].sort();
}

function claims(fork: Observation, ox: Observation, control: Observation, astro: Observation) {
  const input = "fixtures/claims/unlabeled-input.tsx";
  const page = "fixtures/claims/astro-claim.astro";
  return [
    { claim: "unlabeled <input type=text>", engine: "jsx-a11y-x", fired: firedRules(fork, input) },
    { claim: "unlabeled <input type=text>", engine: "oxlint", fired: firedRules(ox, input) },
    { claim: "unlabeled <input type=text>", engine: "control", fired: firedRules(control, input) },
    {
      claim: "Astro a11y on .astro",
      engine: "eslint-plugin-astro, via the fork",
      fired: firedRules(astro, page),
    },
    {
      claim: "Astro a11y on .astro",
      engine: "oxlint (lints the frontmatter script only)",
      fired: firedRules(ox, page),
    },
  ];
}

function stackRows(obs: Observation): Row[] {
  return STACK.map((id) => {
    const base = id.slice(id.lastIndexOf("/") + 1);
    const pair = { bad: `fixtures/stack/${base}.bad.ts`, clean: `fixtures/stack/${base}.clean.ts` };
    return judgeRule(obs, id, false, pair);
  });
}

type Result = ReturnType<typeof build>["result"];

function render(result: Result, table: string): string {
  const o = result.oracle;
  const bar = `${o.rules} rules exported, ${o.deprecated.length} deprecated upstream, ${o.rules - o.deprecated.length} in the bar`;
  const lines = ["# W-22 proof result", "", `${o.name} ${o.installed}: ${bar}.`, "", table, ""];
  for (const c of result.claims)
    lines.push(`- claim, ${c.claim}, ${c.engine}: ${c.fired.join(", ") || "nothing fired"}`);
  lines.push("");
  for (const row of result.stack.rows) lines.push(`- ESLint 10 stack, ${row.rule}: ${row.cell}`);
  lines.push("", "Deprecated upstream (listed, outside the bar):");
  lines.push(...result.deprecated.map(noteLine));
  lines.push("", `W-22 reader: ${result.verdict.w22_reader}`);
  return `${lines.join("\n")}\n`;
}

function build() {
  const control = worker("rules", "control");
  const rules = [...control.implemented];
  const dep = new Set(control.deprecated);
  checkFixtures(rules);
  const fork = worker("rules", "fork");
  const ox = observeOxlint();
  const forkRows = engineRows("jsx-a11y-x", fork, rules, dep);
  const oxRows = engineRows("oxlint", ox, rules, dep);
  const controlRows = engineRows("control", control, rules, dep);
  if (!allPass(controlRows.rows)) {
    throw new Error("the 9.39 control does not pass every rule row: a fixture is wrong");
  }
  const engines = [forkRows, oxRows, controlRows];
  const stack = worker("stack");
  const astro = worker("astro");
  const result = {
    result_version: 1,
    oracle: {
      ...ORACLE,
      installed: installedVersion("jsx-a11y-control"),
      rules: rules.length,
      deprecated: [...dep].sort(),
    },
    engines: engines.map(summary),
    deprecated: deprecatedNotes(engines, control),
    claims: claims(fork, ox, control, astro),
    stack: { version: installedVersion("eslint"), rows: stackRows(stack) },
    verdict: {
      bar: "the rules not deprecated upstream",
      w22_reader: reader([forkRows, oxRows], inBar),
    },
  };
  return { result, table: renderTable(engines, rules) };
}

const { result, table } = build();
writeFileSync(join(ROOT, "RESULT.json"), `${JSON.stringify(result, null, 2)}\n`);
const text = render(result, table);
writeFileSync(join(ROOT, "RESULT.md"), text);
process.stdout.write(text);
