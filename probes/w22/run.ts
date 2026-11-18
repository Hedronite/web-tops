// bun probes/w22/run.ts, from probes/w22/ after `bun install --frozen-lockfile`.
// Lints every fixture through ESLint 10 plus the fork, oxlint, and the ESLint 9.39 control;
// writes RESULT.json and RESULT.md; prints the table and the verdict lines.
import { spawnSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { allPass, fixturePair, judgeRule } from "./judge.ts";
import { observeOxlint } from "./oxlint.ts";
import { installedVersion, ROOT } from "./support.ts";
import { plants } from "./plants.ts";
import { renderTable, type EngineRows } from "./table.ts";
import type { Cell, Claim, DeprecatedNote, Observation, Row, Seen } from "./types.ts";
import { claimsOf, firedRules, inBar, readerOf } from "./verdict.ts";

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

function stackRows(obs: Observation): Row[] {
  return STACK.map((id) => {
    const base = id.slice(id.lastIndexOf("/") + 1);
    const pair = { bad: `fixtures/stack/${base}.bad.ts`, clean: `fixtures/stack/${base}.clean.ts` };
    return judgeRule(obs, id, false, pair);
  });
}

function claimLine(c: Claim): string {
  const fired = c.fired.join(", ") || "nothing fired";
  return `- claim, ${c.claim}, ${c.candidate} (${c.via}): ${fired}, ${c.pass ? "pass" : "FAIL"}`;
}

interface Checked {
  readonly plant: string;
  readonly expected: string;
  readonly got: string;
  readonly ok: boolean;
}

function plantLine(p: Checked): string {
  return `- ${p.plant}: verdict ${p.got}, expected ${p.expected}, ${p.ok ? "ok" : "FAIL"}`;
}

function judgeAll(seen: Seen, rules: readonly string[], dep: ReadonlySet<string>) {
  const fork = engineRows("jsx-a11y-x", seen.fork, rules, dep);
  const ox = engineRows("oxlint", seen.ox, rules, dep);
  const control = engineRows("control", seen.control, rules, dep);
  const claims = claimsOf(seen);
  return { engines: [fork, ox, control], claims, reader: readerOf([fork, ox], claims) };
}

/** Each plant must yield its expected verdict, and a different one from the real run (unless none). */
function selfCheck(seen: Seen, rules: readonly string[], dep: ReadonlySet<string>, real: string) {
  return plants(seen).map((p) => {
    const got = judgeAll(p.seen, rules, dep).reader;
    return {
      plant: p.plant,
      expected: p.expected,
      got,
      ok: got === p.expected && (real === "none" || got !== real),
    };
  });
}

const LABEL_RULE = "control-has-associated-label";

/**
 * Not part of the verdict: where the fork's `control-has-associated-label` fires on inputs. The
 * rule is off in the plugin's own configs and ignores `input` there, because it does not follow
 * label association: it fires on labeled inputs too.
 */
function observations(fork: Observation) {
  const fixtures = Object.keys(fork.files)
    .filter((file) => file.startsWith("fixtures/observations/"))
    .sort();
  return {
    rule: LABEL_RULE,
    engine: "jsx-a11y-x",
    rows: fixtures.map((file) => ({
      fixture: file.slice("fixtures/observations/".length),
      fires: firedRules(fork, file).includes(LABEL_RULE),
    })),
  };
}

type Result = ReturnType<typeof build>["result"];

function render(result: Result, table: string): string {
  const o = result.oracle;
  const bar = `${o.rules} rules exported, ${o.deprecated.length} deprecated upstream, ${o.rules - o.deprecated.length} in the bar`;
  const lines = ["# W-22 proof result", "", `${o.name} ${o.installed}: ${bar}.`, "", table, ""];
  for (const c of result.claims) lines.push(claimLine(c));
  lines.push("");
  for (const row of result.stack.rows) lines.push(`- ESLint 10 stack, ${row.rule}: ${row.cell}`);
  const watched = result.observations;
  lines.push("", `Observation, not in the verdict: ${watched.rule} on inputs (${watched.engine}):`);
  lines.push(...watched.rows.map((r) => `- ${r.fixture}: ${r.fires ? "fires" : "quiet"}`));
  lines.push("", "Deprecated upstream (listed, outside the bar):");
  lines.push(...result.deprecated.map(noteLine));
  lines.push("", "Self-check (a planted failure must change the verdict):");
  lines.push(...result.self_check.map(plantLine));
  lines.push("", `W-22 reader: ${result.verdict.w22_reader}`);
  return `${lines.join("\n")}\n`;
}

function build() {
  const control = worker("rules", "control");
  const rules = [...control.implemented];
  const dep = new Set(control.deprecated);
  checkFixtures(rules);
  const seen = {
    fork: worker("rules", "fork"),
    ox: observeOxlint(),
    control,
    astro: worker("astro"),
  };
  const judged = judgeAll(seen, rules, dep);
  const controlRows = judged.engines[2];
  if (controlRows === undefined || !allPass(controlRows.rows)) {
    throw new Error("the 9.39 control does not pass every rule row: a fixture is wrong");
  }
  const checks = selfCheck(seen, rules, dep, judged.reader);
  if (!checks.every((check) => check.ok)) {
    throw new Error(`self-check failed:\n${checks.map(plantLine).join("\n")}`);
  }
  const result = {
    result_version: 1,
    oracle: {
      ...ORACLE,
      installed: installedVersion("jsx-a11y-control"),
      rules: rules.length,
      deprecated: [...dep].sort(),
    },
    engines: judged.engines.map(summary),
    deprecated: deprecatedNotes(judged.engines, control),
    claims: judged.claims,
    observations: observations(seen.fork),
    stack: { version: installedVersion("eslint"), rows: stackRows(worker("stack")) },
    self_check: checks,
    verdict: {
      bar: "every rule not deprecated upstream, and both claim rows",
      w22_reader: judged.reader,
    },
  };
  return { result, table: renderTable(judged.engines, rules) };
}

const { result, table } = build();
writeFileSync(join(ROOT, "RESULT.json"), `${JSON.stringify(result, null, 2)}\n`);
const text = render(result, table);
writeFileSync(join(ROOT, "RESULT.md"), text);
process.stdout.write(text);
