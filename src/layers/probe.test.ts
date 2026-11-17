import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { VERDICTS } from "../config/report.ts";
import { at, get } from "../config/test-support.ts";

/**
 * G4d: fixtures/probe holds one cheat per case of SPEC-p3, with the outcome WEB_TOPS.md section 6 states
 * in EXPECTED.yaml. It is data: nothing here counts CRAP, runs Stryker or reads a census (M2). These tests
 * hold each case's stated facts to its recorded inputs, so a fixture cannot drift from what it claims.
 */

const root = resolve(import.meta.dirname, "../..");
const probe = resolve(root, "fixtures/probe");
const spec = readFileSync(resolve(root, "WEB_TOPS.md"), "utf8");

const IDS = [
  "e2-one-line-arrow",
  "e3-v8-ignore",
  "e4-unimported-file",
  "no-coverage-survivors",
  "test-only-diff",
  "rule-off-override",
  "stryker-disable",
  "assertion-free-test",
];

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

describe("G4d fixtures/probe lists one cheat per case of SPEC-p3", () => {
  it("has exactly the eight cases, in order, and a directory for each", () => {
    expect(list(get(expected, "cases")).map((item) => get(item, "id"))).toEqual(IDS);
    const directories = readdirSync(probe)
      .filter((name) => statSync(join(probe, name)).isDirectory())
      .sort();
    expect(directories).toEqual([...IDS, "_run"].sort());
  });

  it.each(IDS)(
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
      for (const [layer, verdict] of names(at(item, ["outcome", "verdicts"])).map(
        (layer): [string, unknown] => [layer, at(item, ["outcome", "verdicts", layer])],
      )) {
        expect(["coverage", "crap", "mutation"], layer).toContain(layer);
        expect(VERDICTS, String(verdict)).toContain(verdict);
      }
    },
  );

  it("keeps machine paths out of the recorded outputs", () => {
    for (const id of IDS) {
      const recorded = resolve(probe, id, "recorded");
      if (!existsSync(recorded)) continue;
      for (const name of readdirSync(recorded)) {
        const body = readFileSync(join(recorded, name), "utf8");
        expect(body, `${id}/${name}`).not.toMatch(/\/(?:Users|home|private|tmp)\//u);
      }
    }
  });

  it("states every census kind it names in section 6.7", () => {
    const kinds = IDS.flatMap((id) => names(at(caseOf(id), ["outcome", "census"])));
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) {
      expect(spec, kind).toContain(`\`${kind}\``);
    }
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

describe("G4c rule-off-override: a rule is off for a directory with no directive in any file", () => {
  const id = "rule-off-override";

  it("the config turns the stated rule off for the stated files and on elsewhere", () => {
    const config = text(id, "eslint.config.js");
    const rule = String(get(factsOf(id), "rule"));
    expect(config).toContain(`"${rule}": "error"`);
    expect(config).toContain(`"${rule}": "off"`);
    expect(config).toContain(`files: ["${String(get(factsOf(id), "override_files"))}"]`);
  });

  it("the tracked files are where the case says, and none carries a directive comment", () => {
    for (const file of list(get(factsOf(id), "tracked_files_off"))) {
      expect(existsSync(resolve(probe, id, String(file)))).toBe(true);
    }
    for (const file of list(get(factsOf(id), "tracked_files_on"))) {
      expect(existsSync(resolve(probe, id, String(file)))).toBe(true);
    }
    for (const file of ["src/legacy/loose.ts", "src/strict.ts"]) {
      expect(text(id, file)).not.toMatch(/eslint-disable/u);
    }
  });
});
