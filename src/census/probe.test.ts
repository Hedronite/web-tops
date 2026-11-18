import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { realExec } from "../gate/exec.ts";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";
import { eslintIgnores, ruleOff, tsconfigExcluded } from "./config.ts";
import type { Levels } from "./config.ts";
import {
  AXE_KINDS,
  CENSUS_RULE_PREFIX,
  CONFIG_KINDS,
  SOURCE_KINDS,
  censusFindings,
} from "./index.ts";

/**
 * R75: each fixtures/probe census case gives its stated count, from the readers this directory holds. The source
 * kinds are read from the case's files; the config kinds from the real ESLint and TypeScript, and, from the
 * recordings made with the same tools, by the judges alone, so the recordings and the live answers must agree.
 */

const probe = resolve(import.meta.dirname, "../../fixtures/probe");
const expected: unknown = parse(readFileSync(join(probe, "EXPECTED.yaml"), "utf8"));

const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A folder for the readers to write in, outside the fixtures. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-census-probe-"));
  made.push(dir);
  return dir;
}

const read = (from: unknown, key: string): unknown =>
  typeof from === "object" && from !== null ? Reflect.get(from, key) : undefined;

interface Case {
  readonly id: string;
  readonly census: Readonly<Record<string, number>>;
}

function numbers(value: unknown): Record<string, number> {
  const entries = typeof value === "object" && value !== null ? Object.entries(value) : [];
  return Object.fromEntries(
    entries.flatMap(([key, count]): [string, number][] =>
      typeof count === "number" ? [[key, count]] : [],
    ),
  );
}

const CASES: Case[] = (() => {
  const list: unknown = read(expected, "cases");
  return (Array.isArray(list) ? list : []).map((item): Case => ({
    id: String(read(item, "id")),
    census: numbers(read(read(item, "outcome"), "census")),
  }));
})();

const MINE: readonly string[] = [...SOURCE_KINDS, ...CONFIG_KINDS, ...AXE_KINDS];

/** The cases that state a count of a kind this reader owns. */
const OWNED = CASES.filter((item) => Object.keys(item.census).some((kind) => MINE.includes(kind)));

/** Every input file of a case, relative to it: the recordings are not inputs. */
function inputs(id: string, dir = ""): string[] {
  return readdirSync(join(probe, id, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (path === "recorded") return [];
    return statSync(join(probe, id, path)).isDirectory() ? inputs(id, path) : [path];
  });
}

/** What the readers count in a case, by kind. */
async function counted(id: string): Promise<Record<string, number>> {
  const found = await censusFindings({
    cwd: join(probe, id),
    files: inputs(id),
    exec: realExec,
    env: process.env,
    outDir: join(scratch(), "out"),
  });
  const counts: Record<string, number> = {};
  for (const item of found) {
    const kind = item.rule.slice(CENSUS_RULE_PREFIX.length);
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

/** The count a case states for the kinds this reader owns. */
const statedFor = (item: Case): Record<string, number> =>
  Object.fromEntries(Object.entries(item.census).filter(([kind]) => MINE.includes(kind)));

describe("the probe's census cases give their stated counts", () => {
  it("covers every kind of this reader, and the cases name them", () => {
    const stated = new Set(OWNED.flatMap((item) => Object.keys(statedFor(item))));
    for (const kind of MINE) expect(stated, kind).toContain(kind);
    expect(OWNED.length).toBeGreaterThanOrEqual(10);
  });

  it("owns every census kind the cases state, except the coverage hints (the coverage layer's)", () => {
    const hints = ["v8-ignore", "istanbul-ignore", "c8-ignore"];
    const stated = CASES.flatMap((item) => Object.keys(item.census));
    expect(stated.filter((kind) => !MINE.includes(kind) && !hints.includes(kind))).toEqual([]);
    expect(stated.length).toBeGreaterThan(MINE.length - 1);
  });

  it.each(OWNED.map((item) => [item.id, item] as const))(
    "%s",
    async (_id, item) => {
      expect(await counted(item.id)).toEqual(statedFor(item));
    },
    REAL_TOOL_TIMEOUT,
  );
});

describe("the recordings the config cases were made with agree with the judges", () => {
  const recorded = (id: string, file: string): unknown => {
    const path = join(probe, id, "recorded", file);
    const value: unknown = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
    return value;
  };

  it("census-eslint-ignores: the recorded isPathIgnored gives 2", () => {
    const raw = recorded("census-eslint-ignores", "ignored-files.json");
    const map = new Map(
      Object.entries(typeof raw === "object" && raw !== null ? raw : {}).map(
        ([file, left]): [string, boolean] => [file, left === true],
      ),
    );
    expect(eslintIgnores(map).map((hit) => hit.file)).toEqual([
      "src/legacy/a.ts",
      "src/legacy/b.ts",
    ]);
  });

  it("rule-off-override: the recorded effective levels give 1", () => {
    const raw = recorded("rule-off-override", "effective-rule-levels.json");
    const table = typeof raw === "object" && raw !== null ? Object.entries(raw) : [];
    const levels: Levels = new Map(
      table.map(([file, level]): [string, Map<string, number>] => [
        file,
        new Map([
          ["@typescript-eslint/no-explicit-any", Array.isArray(level) ? Number(level[0]) : -1],
        ]),
      ]),
    );
    expect(ruleOff(levels).map((hit) => hit.file)).toEqual(["src/legacy/loose.ts"]);
  });

  it("census-tsconfig-exclude: the recorded program leaves out 1", () => {
    const program = new Set(
      readFileSync(join(probe, "census-tsconfig-exclude", "recorded", "program-files.txt"), "utf8")
        .split("\n")
        .filter((line) => line !== ""),
    );
    expect(
      tsconfigExcluded(["src/ok.ts", "src/generated/g.ts"], program).map((hit) => hit.file),
    ).toEqual(["src/generated/g.ts"]);
  });
});
