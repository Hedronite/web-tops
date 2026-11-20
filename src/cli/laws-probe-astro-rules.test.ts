import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanTemp, put, tempDir } from "../laws/probe/testkit.ts";
import { KIT } from "./test-support-probe.ts";

afterAll(cleanTemp);

/**
 * The script the test runs as one process of its own, so that what it does is not counted as coverage of the probe's
 * code (a mutant of the probe would otherwise re-run every probe it makes). It builds an astro-site project, asks
 * ESLint which Astro rules the kit's preset turns on for a `.astro` file, and for each of them in turn turns it off,
 * probes the rule's law, and prints what the probe said. `argv`: the kit, and an empty directory for the project.
 */
const SCRIPT = `
import { mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const [KIT, DIR] = process.argv.slice(2);
const LAWS = ["W-22", "W-49"];
symlinkSync(join(KIT, "node_modules"), join(DIR, "node_modules"));
writeFileSync(join(DIR, "tsconfig.json"), JSON.stringify({ extends: join(KIT, "tsconfig.json"), include: ["src/**/*"] }));
writeFileSync(join(DIR, "package.json"), '{ "type": "module", "dependencies": { "astro": "5.0.0" } }\\n');
mkdirSync(join(DIR, "src"));
writeFileSync(join(DIR, "src/page.astro"), "---\\n---\\n<p></p>\\n");
const config = (off) => [
  'import { eslintPreset } from "' + KIT + '/src/presets/eslint.js";',
  'const base = await eslintPreset({ variant: "astro", tsconfigRootDir: import.meta.dirname, class: "astro-site" });',
  "export default [...base" + (off === undefined ? "" : ', { files: ["**/*.astro"], rules: { ' + JSON.stringify(off) + ': "off" } }') + "];",
  "",
].join("\\n");
const run = (cmd, args) => spawnSync(cmd, args, { cwd: DIR, encoding: "utf8", maxBuffer: 1 << 26 });
writeFileSync(join(DIR, "eslint.config.js"), config(undefined));
const printed = run("node", [join(KIT, "node_modules/eslint/bin/eslint.js"), "--print-config", "src/page.astro"]);
const level = (value) => (Array.isArray(value) ? value[0] : value);
const enabled = Object.entries(JSON.parse(printed.stdout).rules)
  .filter(([name, value]) => name.startsWith("astro/") && ![0, "off"].includes(level(value)))
  .map(([name]) => name).sort();
const { parseMarkers } = await import(KIT + "/src/laws/probe/markers.ts");
const { readCatalog } = await import(KIT + "/src/laws/probe/catalog.ts");
const lawOf = new Map();
const listed = readCatalog().filter((law) => LAWS.includes(law.id))
  .flatMap((law) => law.rules.filter((rule) => rule.name.startsWith("astro/")).map((rule) => { lawOf.set(rule.name, law.id); return rule.name; })).sort();
const lines = new Map();
for (const law of LAWS) {
  const dir = join(KIT, "fixtures/laws", law, "bad");
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".astro"))) {
    for (const mark of parseMarkers(law + "/bad/" + name, readFileSync(join(dir, name), "utf8"))) {
      for (const rule of mark.rules) lines.set(rule, [...(lines.get(rule) ?? []), mark.file + ":" + String(mark.line)]);
    }
  }
}
const probe = (law) => {
  const done = run("bun", [join(KIT, "src/cli/main.ts"), "laws", "probe", "--class", "astro-site", "--law", law, "--json"]);
  return { code: done.status, report: JSON.parse(done.stdout) };
};
const baseline = LAWS.map((law) => { const { code, report } = probe(law); return { law, code, skipped: report.skipped.length, failures: report.laws.flatMap((one) => one.failures).length }; });
const runs = enabled.map((rule) => {
  writeFileSync(join(DIR, "eslint.config.js"), config(rule));
  const { code, report } = probe(lawOf.get(rule) ?? "none");
  const failures = report.laws.flatMap((one) => one.failures);
  const silent = failures.filter((failure) => failure.kind === "silent" && failure.rule === rule).map((failure) => failure.file + ":" + String(failure.line)).sort();
  return { rule, code, silent, expected: [...(lines.get(rule) ?? [])].sort(), others: failures.length - silent.length };
});
const marked = [...lines.keys()].sort();
console.log(JSON.stringify({ enabled, listed, marked, baseline, runs }));
`;

interface Run {
  readonly rule: string;
  readonly code: number;
  readonly silent: readonly string[];
  readonly expected: readonly string[];
  readonly others: number;
}

interface Result {
  readonly enabled: readonly string[];
  readonly listed: readonly string[];
  readonly marked: readonly string[];
  readonly baseline: readonly { law: string; code: number; skipped: number; failures: number }[];
  readonly runs: readonly Run[];
}

function isResult(value: unknown): value is Result {
  return (
    typeof value === "object" &&
    value !== null &&
    ["enabled", "listed", "marked", "baseline", "runs"].every((key) =>
      Array.isArray(Reflect.get(value, key)),
    )
  );
}

function resultOf(): Result {
  const dir = tempDir();
  const script = tempDir();
  put(script, { "check.mjs": SCRIPT });
  const done = spawnSync("bun", [join(script, "check.mjs"), KIT, dir], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  expect(done.stderr).toBe("");
  const parsed: unknown = JSON.parse(done.stdout);
  if (!isResult(parsed)) {
    throw new Error("the check printed no result");
  }
  return parsed;
}

/** Forty probes, one for each rule, in a process of their own: a few minutes on a slow runner. */
const FORTY_PROBES = 600_000;

describe("the Astro rules of W-22 and W-49 are each enabled, listed and twinned, and each twin goes red alone", () => {
  let result: Result;
  beforeAll(() => {
    result = resultOf();
  }, FORTY_PROBES);

  it("the rules the astro-site preset enables are the rules the two laws list and the twins mark", () => {
    expect(result.enabled).toHaveLength(40);
    expect(result.listed).toEqual(result.enabled);
    expect(result.marked).toEqual(result.enabled);
  });

  it("both laws pass under the astro-site preset, with nothing skipped", () => {
    expect(result.baseline).toEqual([
      { law: "W-22", code: 0, skipped: 0, failures: 0 },
      { law: "W-49", code: 0, skipped: 0, failures: 0 },
    ]);
  });

  it("turning one rule off fails its law, silent on exactly the lines that mark the rule and nowhere else", () => {
    expect(result.runs.map((run) => run.rule)).toEqual(result.enabled);
    for (const run of result.runs) {
      expect(run.expected, run.rule).not.toEqual([]);
      expect([run.rule, run.code, run.silent, run.others]).toEqual([run.rule, 1, run.expected, 0]);
    }
  });
});
