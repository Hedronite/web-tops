import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { VERDICTS } from "../config/report.ts";
import { at, get } from "../config/test-support.ts";

/**
 * G4d: fixtures/probe holds one cheat per case of SPEC-p3, and one small case per census kind, with the
 * outcome WEB_TOPS.md section 6 states in EXPECTED.yaml. It is data: nothing here counts CRAP, runs Stryker or
 * reads a census (M2). These tests hold each case's stated facts to its recorded inputs, and each case's
 * census to the directives and the recorded config-level facts its files hold, so a fixture cannot drift from
 * what it claims.
 */

const root = resolve(import.meta.dirname, "../..");
const probe = resolve(root, "fixtures/probe");
const spec = readFileSync(resolve(root, "WEB_TOPS.md"), "utf8");

const SPEC_IDS = [
  "e2-one-line-arrow",
  "e3-v8-ignore",
  "e4-unimported-file",
  "no-coverage-survivors",
  "test-only-diff",
  "rule-off-override",
  "stryker-disable",
  "assertion-free-test",
];

/** One case for each census kind the SPEC cheats do not already cover (R54). */
const CENSUS_IDS = [
  "census-eslint-disable",
  "census-ts-expect-error",
  "census-ts-ignore",
  "census-ts-nocheck",
  "census-stylelint-disable",
  "census-istanbul-ignore",
  "census-c8-ignore",
  "census-html-validate-disable",
  "census-biome-ignore",
  "census-axe-disable-rules",
  "census-axe-exclude",
  "census-eslint-ignores",
  "census-tsconfig-exclude",
];

const ALL_IDS = [...SPEC_IDS, ...CENSUS_IDS];

const expected: unknown = parse(readFileSync(resolve(probe, "EXPECTED.yaml"), "utf8"));

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function names(value: unknown): string[] {
  return typeof value === "object" && value !== null ? Object.keys(value) : [];
}

function num(value: unknown): number {
  if (typeof value !== "number") {
    throw new Error(`not a number: ${String(value)}`);
  }
  return value;
}

function caseOf(id: string): unknown {
  return list(get(expected, "cases")).find((item) => get(item, "id") === id);
}

function factsOf(id: string): unknown {
  return get(caseOf(id), "facts");
}

function text(id: string, file: string): string {
  return readFileSync(resolve(probe, id, file), "utf8");
}

function json(id: string, file: string): unknown {
  const value: unknown = JSON.parse(text(id, file));
  return value;
}

/** Sums the `LF` and `LH` lines of an LCOV, and lists its `SF` records. */
function lcov(source: string): { found: number; hit: number; files: string[] } {
  const field = (prefix: string): string[] =>
    source.split("\n").filter((line) => line.startsWith(prefix));
  const sum = (prefix: string): number =>
    field(prefix).reduce((total, line) => total + Number(line.slice(prefix.length)), 0);
  return {
    found: sum("LF:"),
    hit: sum("LH:"),
    files: field("SF:").map((line) => line.slice(3)),
  };
}

/** Stryker statuses of a mutation report, counted across its files. */
function statuses(id: string): Record<string, number> {
  const report = json(id, "recorded/mutation.json");
  const counts: Record<string, number> = {};
  for (const file of names(get(report, "files"))) {
    for (const mutant of list(at(report, ["files", file, "mutants"]))) {
      const status = String(get(mutant, "status"));
      counts[status] = (counts[status] ?? 0) + 1;
    }
  }
  return counts;
}

function mutants(id: string, file: string): unknown[] {
  return list(at(json(id, "recorded/mutation.json"), ["files", file, "mutants"]));
}

function startLine(mutant: unknown): number {
  return num(at(mutant, ["location", "start", "line"]));
}

/** Every file of a case that is an input, not a recording, relative to the case. */
function sources(id: string, dir = ""): string[] {
  return readdirSync(join(probe, id, dir)).flatMap((name) => {
    const relative = join(dir, name);
    if (relative === "recorded") return [];
    return statSync(join(probe, id, relative)).isDirectory() ? sources(id, relative) : [relative];
  });
}

/** The kinds section 6.7 lists in its census table, read from the table's first column. */
function censusKinds(): string[] {
  const start = spec.indexOf("**Suppression census (normative).**");
  const table = spec.slice(start, spec.indexOf("A rule that is off everywhere", start));
  return table
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .flatMap((line) => [...(line.split("|")[1] ?? "").matchAll(/`([a-z0-9-]+)`/gu)])
    .map((match) => match[1] ?? "");
}

/** What a directive of each kind looks like in a source line; every kind that is a comment in a file. */
const DIRECTIVES: Readonly<Record<string, RegExp>> = {
  "eslint-disable": /\beslint-disable(?:-next-line|-line)?\b/gu,
  "ts-expect-error": /@ts-expect-error\b/gu,
  "ts-ignore": /@ts-ignore\b/gu,
  "ts-nocheck": /@ts-nocheck\b/gu,
  "stylelint-disable": /\bstylelint-disable(?:-next-line|-line)?\b/gu,
  "v8-ignore": /\bv8 ignore\b/gu,
  "istanbul-ignore": /\bistanbul ignore\b/gu,
  "c8-ignore": /\bc8 ignore\b/gu,
  "stryker-disable": /\bStryker disable\b/gu,
  "html-validate-disable": /\bhtml-validate-disable(?:-next|-block)?\b/gu,
  "biome-ignore": /\bbiome-ignore\b/gu,
};

function directiveCount(kind: string, body: string): number {
  return (body.match(DIRECTIVES[kind] ?? /(?!)/gu) ?? []).length;
}

/** The quoted strings in the array an axe builder method is called with. */
function axeCount(source: string, method: string): number {
  const call = new RegExp(`\\.${method}\\(\\s*\\[([^\\]]*)\\]`, "gu");
  return [...source.matchAll(call)].reduce(
    (total, match) => total + (match[1]?.match(/["'][^"']+["']/gu) ?? []).length,
    0,
  );
}

function plus(counts: Record<string, number>, kind: string, amount: number): void {
  if (amount > 0) counts[kind] = (counts[kind] ?? 0) + amount;
}

/** ESLint's effective level of the rule per file: 0 is off, 1 warn, 2 error. */
function levels(id: string): Record<string, number> {
  const file = "recorded/effective-rule-levels.json";
  if (!existsSync(resolve(probe, id, file))) return {};
  const recorded = json(id, file);
  return Object.fromEntries(
    names(recorded).map((name) => [name, num(list(get(recorded, name))[0])]),
  );
}

/** The files whose effective level is off while it is on for another tracked file. */
function ruleOffFiles(id: string): string[] {
  const found = levels(id);
  const someOn = Object.values(found).some((level) => level > 0);
  return someOn ? Object.keys(found).filter((name) => found[name] === 0) : [];
}

function ignoredFiles(id: string): string[] {
  const file = "recorded/ignored-files.json";
  if (!existsSync(resolve(probe, id, file))) return [];
  const recorded = json(id, file);
  return names(recorded).filter((name) => get(recorded, name) === true);
}

/** The tracked `src` files that the recorded program leaves out. */
function excludedFiles(id: string): string[] {
  const file = "recorded/program-files.txt";
  if (!existsSync(resolve(probe, id, file))) return [];
  const program = text(id, file).split("\n");
  return sources(id).filter(
    (name) => name.startsWith("src/") && name.endsWith(".ts") && !program.includes(name),
  );
}

/** The directives and the recorded config-level facts of one case, counted by kind. */
function counted(id: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of sources(id)) {
    const body = text(id, file);
    for (const kind of Object.keys(DIRECTIVES)) {
      plus(counts, kind, directiveCount(kind, body));
    }
    plus(counts, "axe-disable-rules", axeCount(body, "disableRules"));
    plus(counts, "axe-exclude", axeCount(body, "exclude"));
  }
  plus(counts, "eslint-rule-off", ruleOffFiles(id).length);
  plus(counts, "eslint-ignores", ignoredFiles(id).length);
  plus(counts, "tsconfig-exclude", excludedFiles(id).length);
  return counts;
}

function statedCensus(id: string): Record<string, number> {
  const census = at(caseOf(id), ["outcome", "census"]);
  return Object.fromEntries(names(census).map((kind) => [kind, num(get(census, kind))]));
}

const WITH_CENSUS = ALL_IDS.filter((id) => names(statedCensus(id)).length > 0);
const WITHOUT_CENSUS = ALL_IDS.filter((id) => names(statedCensus(id)).length === 0);

describe("G4d fixtures/probe lists one cheat per case of SPEC-p3, and one case per census kind", () => {
  it("has the eight SPEC cases first, in order, then the census cases, and a directory for each", () => {
    expect(list(get(expected, "cases")).map((item) => get(item, "id"))).toEqual(ALL_IDS);
    const directories = readdirSync(probe)
      .filter((name) => statSync(join(probe, name)).isDirectory())
      .sort();
    expect(directories).toEqual([...ALL_IDS, "_run"].sort());
  });

  it.each(ALL_IDS)(
    "%s names its cheat, a section of WEB_TOPS.md, its inputs and a stated outcome",
    (id) => {
      const item = caseOf(id);
      expect(typeof get(item, "cheat")).toBe("string");
      const section = String(get(item, "section"));
      expect(section).toMatch(/^6\.[1-7]$/u);
      expect(spec).toContain(`\n### ${section} `);
      for (const input of list(get(item, "inputs"))) {
        expect(existsSync(resolve(probe, id, String(input))), String(input)).toBe(true);
      }
      expect(typeof at(item, ["outcome", "note"])).toBe("string");
      for (const layer of names(at(item, ["outcome", "verdicts"]))) {
        expect(["coverage", "crap", "mutation"], layer).toContain(layer);
        expect(VERDICTS).toContain(at(item, ["outcome", "verdicts", layer]));
      }
    },
  );

  it("keeps machine paths out of the recorded outputs", () => {
    for (const id of ALL_IDS) {
      const recorded = resolve(probe, id, "recorded");
      if (!existsSync(recorded)) continue;
      for (const name of readdirSync(recorded)) {
        const body = readFileSync(join(recorded, name), "utf8");
        expect(body, `${id}/${name}`).not.toMatch(/\/(?:Users|home|private|tmp)\//u);
      }
    }
  });
});

describe("G4c every census kind of section 6.7 has a probe case (R54)", () => {
  it("covers each kind the table lists, and no case names a kind the table does not", () => {
    const kinds = censusKinds();
    expect(kinds).toHaveLength(16);
    const covered = new Set(WITH_CENSUS.flatMap((id) => names(statedCensus(id))));
    expect([...covered].sort()).toEqual([...kinds].sort());
  });

  it.each(WITH_CENSUS)(
    "%s: its stated census equals the directives and recorded facts its files hold",
    (id) => {
      expect(counted(id)).toEqual(statedCensus(id));
    },
  );

  it.each(WITHOUT_CENSUS)("%s holds no directive and no silenced rule", (id) => {
    expect(counted(id)).toEqual({});
  });

  it.each(WITH_CENSUS)("%s: each stated directive line holds a directive of the kind", (id) => {
    const lines = list(get(factsOf(id), "directive_lines")).map(Number);
    const kind = names(statedCensus(id))[0] ?? "";
    const file = String(list(get(caseOf(id), "inputs"))[0]);
    const rows = text(id, file).split("\n");
    for (const line of lines) {
      expect(directiveCount(kind, rows[line - 1] ?? ""), `${file}:${String(line)}`).toBeGreaterThan(
        0,
      );
    }
  });
});

describe("G4a E2: a one-line arrow that nothing calls reads 100 % by line and 0 by statement", () => {
  const id = "e2-one-line-arrow";
  const file = at(json(id, "recorded/coverage-final.json"), ["src/sign.ts"]);

  it("the LCOV has the line covered and the function not run", () => {
    const totals = lcov(text(id, "recorded/lcov.info"));
    expect(totals.found).toBe(num(get(factsOf(id), "lcov_lines_found")));
    expect(totals.hit).toBe(num(get(factsOf(id), "lcov_lines_hit")));
    expect(text(id, "recorded/lcov.info")).toContain("FNDA:0,");
  });

  it("coverage-final.json has the function's hit count at 0 and its body statements unhit", () => {
    expect(num(at(file, ["f", "0"]))).toBe(num(get(factsOf(id), "function_hits")));
    const body = at(file, ["fnMap", "0", "loc", "start", "column"]);
    const inside = names(get(file, "statementMap")).filter(
      (key) => num(at(file, ["statementMap", key, "start", "column"])) >= num(body),
    );
    expect(inside).toHaveLength(num(get(factsOf(id), "body_statements")));
    expect(inside.filter((key) => num(at(file, ["s", key])) > 0)).toHaveLength(
      num(get(factsOf(id), "body_statements_hit")),
    );
  });

  it("the source is one line and has the four paths a complexity of 4 needs", () => {
    const source = text(id, "src/sign.ts");
    expect(source.trimEnd().split("\n")).toHaveLength(1);
    expect(source.match(/&&|\?/gu)).toHaveLength(3);
  });

  it("CRAP is 20 by statement coverage and 4 by line coverage", () => {
    const crap = (cov: number): number => 4 ** 2 * (1 - cov) ** 3 + 4;
    expect(crap(0)).toBe(num(at(caseOf(id), ["outcome", "crap"])));
    expect(crap(1)).toBe(4);
  });
});

describe("G4b section 6.4 states the status table (R51)", () => {
  const start = spec.indexOf("\n### 6.4 ");
  const section = spec.slice(start, spec.indexOf("\n### 6.5 "));

  it("counts Killed and Timeout as killed, Survived and NoCoverage as survivors", () => {
    expect(section).toContain("| `Killed`, `Timeout` | killed |");
    expect(section).toContain("| `Survived`, `NoCoverage` | survivor |");
  });

  it("excludes CompileError, RuntimeError and Ignored", () => {
    expect(section).toContain("| `CompileError`, `RuntimeError`, `Ignored` | excluded |");
  });

  it("makes a status outside the table a fail that names the status, not not-evaluated", () => {
    expect(section).toContain("makes the layer `fail`, with that status in the reason");
    expect(section).not.toContain("makes the\n  layer `not-evaluated`, with that status");
  });
});

describe("G4c E3: a v8 ignore hint removes lines from the profile", () => {
  const id = "e3-v8-ignore";

  it("the hint sits on the stated line and the LCOV holds only the lines left", () => {
    const hint = num(get(factsOf(id), "hint_line"));
    expect(text(id, "src/guard.ts").split("\n")[hint - 1]).toContain("v8 ignore next 3");
    const totals = lcov(text(id, "recorded/lcov.info"));
    expect(totals.found).toBe(num(get(factsOf(id), "lcov_lines_found")));
    expect(totals.hit).toBe(num(get(factsOf(id), "lcov_lines_hit")));
    const hidden = list(get(factsOf(id), "lines_hidden")).map(Number);
    expect(hidden).toEqual([hint + 1, hint + 2, hint + 3]);
    for (const line of hidden) {
      expect(text(id, "recorded/lcov.info")).not.toContain(`DA:${String(line)},`);
    }
  });
});

describe("G4 E4: a file no test imports is absent from the profile unless the gate names it", () => {
  const id = "e4-unimported-file";

  it("lists the same records the case states, with and without the include", () => {
    expect(lcov(text(id, "recorded/lcov-without-include.info")).files).toEqual(
      list(get(factsOf(id), "records_without_include")),
    );
    expect(lcov(text(id, "recorded/lcov.info")).files).toEqual(
      list(get(factsOf(id), "records_with_include")),
    );
    const totals = lcov(text(id, "recorded/lcov.info"));
    expect(totals.found).toBe(num(get(factsOf(id), "lcov_lines_found")));
    expect(totals.hit).toBe(num(get(factsOf(id), "lcov_lines_hit")));
  });

  it("the unimported file reads 0 lines hit, and the rule is the one the coverage layer reports", () => {
    expect(text(id, "recorded/lcov.info")).toMatch(/SF:src\/unimported\.ts[\s\S]*?\nLF:3\nLH:0/u);
    const finding = list(at(caseOf(id), ["outcome", "findings"]))[0];
    expect(get(finding, "rule")).toBe("no-coverage-record");
    expect(readFileSync(resolve(root, "src/layers/coverage/index.ts"), "utf8")).toContain(
      '"no-coverage-record"',
    );
  });
});

describe("G4b mutation cases: the recorded statuses are the ones the case states", () => {
  it.each(["no-coverage-survivors", "test-only-diff", "stryker-disable", "assertion-free-test"])(
    "%s",
    (id) => {
      const stated = get(factsOf(id), "statuses");
      expect(statuses(id)).toEqual(
        Object.fromEntries(names(stated).map((status) => [status, num(get(stated, status))])),
      );
    },
  );

  it("no-coverage-survivors: every NoCoverage mutant is in the function no test runs, and none Survived", () => {
    const id = "no-coverage-survivors";
    const lines = text(id, "src/price.ts").split("\n");
    const functionLine = lines.findIndex((line) => line.startsWith("export function untested")) + 1;
    const found = mutants(id, "src/price.ts");
    const uncovered = found.filter((mutant) => get(mutant, "status") === "NoCoverage");
    expect(uncovered.length).toBe(num(at(caseOf(id), ["outcome", "survivors"])));
    expect(uncovered.every((mutant) => startLine(mutant) > functionLine)).toBe(true);
    expect(found.some((mutant) => get(mutant, "status") === "Survived")).toBe(false);
  });

  it("test-only-diff: the diff touches only a test file, and the survivors are in the source it covers", () => {
    const id = "test-only-diff";
    const touched = [...text(id, "changes.diff").matchAll(/^diff --git a\/(\S+)/gmu)].map(
      (match) => match[1],
    );
    expect(touched).toEqual(list(get(factsOf(id), "changed_files")));
    expect(touched.every((file) => file?.endsWith(".test.ts") === true)).toBe(true);
    expect(num(get(factsOf(id), "changed_source_lines"))).toBe(0);
    expect(
      mutants(id, "src/sum.ts").filter((mutant) => get(mutant, "status") === "Survived"),
    ).toHaveLength(num(at(caseOf(id), ["outcome", "survivors"])));
  });

  it("stryker-disable: the directive is on the stated line and the mutants of the next line are Ignored", () => {
    const id = "stryker-disable";
    const directive = num(get(factsOf(id), "directive_line"));
    expect(text(id, "src/clamp.ts").split("\n")[directive - 1]).toContain(
      "Stryker disable next-line all",
    );
    const ignored = mutants(id, "src/clamp.ts").filter(
      (mutant) => get(mutant, "status") === "Ignored",
    );
    expect(ignored.length).toBeGreaterThan(0);
    expect(ignored.every((mutant) => startLine(mutant) === directive + 1)).toBe(true);
  });

  it("assertion-free-test: every line is hit, the test has no assertion, and the mutants Survived", () => {
    const id = "assertion-free-test";
    const totals = lcov(text(id, "recorded/lcov.info"));
    expect(totals.found).toBe(num(get(factsOf(id), "lcov_lines_found")));
    expect(totals.hit).toBe(num(get(factsOf(id), "lcov_lines_hit")));
    expect(text(id, "src/total.test.ts")).not.toContain("expect(");
    expect(statuses(id)["Killed"]).toBeUndefined();
  });
});

const LEVEL_NAMES: Readonly<Record<number, string>> = { 0: "off", 1: "warn", 2: "error" };

describe("G4c rule-off-override: a rule is off for a directory with no directive in any file (R54)", () => {
  const id = "rule-off-override";

  it("the config registers the plugin and the parser, and turns the rule off for the stated files", () => {
    const config = text(id, "eslint.config.js");
    const rule = String(get(factsOf(id), "rule"));
    expect(config).toContain("parser: tseslint.parser");
    expect(config).toContain('plugins: { "@typescript-eslint": tseslint.plugin }');
    expect(config).toContain(`"${rule}": "error"`);
    expect(config).toContain(`"${rule}": "off"`);
    expect(config).toContain(`files: ["${String(get(factsOf(id), "override_files"))}"]`);
  });

  it("ESLint's recorded effective levels are the ones the case states, off for one file and error for the other", () => {
    const stated = get(factsOf(id), "effective_levels");
    const recorded = Object.fromEntries(
      Object.entries(levels(id)).map(([name, level]) => [name, LEVEL_NAMES[level]]),
    );
    expect(recorded).toEqual(
      Object.fromEntries(names(stated).map((name) => [name, String(get(stated, name))])),
    );
  });

  it("the files off and on are derived from the recording, and the tracked files exist", () => {
    expect(ruleOffFiles(id)).toEqual(list(get(factsOf(id), "tracked_files_off")));
    const on = Object.keys(levels(id)).filter((name) => (levels(id)[name] ?? 0) > 0);
    expect(on).toEqual(list(get(factsOf(id), "tracked_files_on")));
    for (const file of [...ruleOffFiles(id), ...on]) {
      expect(existsSync(resolve(probe, id, file))).toBe(true);
    }
  });
});

describe("G4c the config-level census cases are held to their recordings", () => {
  it("census-eslint-ignores: the files ESLint ignores are the ones the case states, and the rest is linted", () => {
    const id = "census-eslint-ignores";
    expect(ignoredFiles(id)).toEqual(list(get(factsOf(id), "ignored")));
    const recorded = json(id, "recorded/ignored-files.json");
    const linted = names(recorded).filter((name) => get(recorded, name) === false);
    expect(linted).toEqual(list(get(factsOf(id), "linted")));
  });

  it("census-tsconfig-exclude: the program holds the files the case states, and the excluded one is tracked", () => {
    const id = "census-tsconfig-exclude";
    expect(
      text(id, "recorded/program-files.txt")
        .split("\n")
        .filter((line) => line !== ""),
    ).toEqual(list(get(factsOf(id), "program_files")));
    expect(excludedFiles(id)).toEqual(list(get(factsOf(id), "excluded")));
  });

  it("census-axe-disable-rules and census-axe-exclude: the stated rules and selectors are in the calls", () => {
    const rules = text("census-axe-disable-rules", "src/a11y.test.ts");
    for (const rule of list(get(factsOf("census-axe-disable-rules"), "rules"))) {
      expect(rules).toContain(String(rule));
    }
    const selectors = text("census-axe-exclude", "src/a11y.test.ts");
    for (const selector of list(get(factsOf("census-axe-exclude"), "selectors"))) {
      expect(selectors).toContain(String(selector));
    }
  });
});
