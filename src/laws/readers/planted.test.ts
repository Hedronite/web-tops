import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { recorded } from "../../layers/hygiene/testkit.ts";
import type { LawEntry, LawReader, LawReading, ReadInput } from "./types.ts";
import { attwReader } from "./attw.ts";
import { bunReader } from "./bun.ts";
import { depcruiseReader } from "./depcruise.ts";
import { publintReader } from "./publint.ts";
import { inputFor, lawOf, type InputOptions } from "./testkit.ts";

// The readers by the tool they read, as the laws layer registers them.
const READERS: ReadonlyMap<string, LawReader> = new Map([
  ["attw", attwReader],
  ["bun", bunReader],
  ["dependency-cruiser", depcruiseReader],
  ["publint", publintReader],
]);

// One planted violation for each law the gate-1 artifact readers judge: the registered reader gives `refuse` for it,
// `pass` for its clean twin, and `not-evaluated` when the tool did not run (WEB_TOPS.md 3.3, 8.1). W-39, W-41 and W-48
// are G9's second half; W-20, W-21 and W-22 (built pages: html-validate, axe) and W-27 (`astro check`) are other steps.
// The real catalog entries run through the real laws layer in `layer/real-readers-e2e.test.ts`.

const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** Files written into a temp directory; their paths, by the names the artifacts are known by. */
function artifacts(files: Readonly<Record<string, string>>): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), "wt-planted-"));
  made.push(dir);
  const paths: Record<string, string> = {};
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, `${name}.out`), text);
    paths[name] = join(dir, `${name}.out`);
  }
  return paths;
}

const cruise = (rule: string, violating: boolean): string =>
  JSON.stringify({
    summary: {
      violations: violating
        ? [
            {
              type: "cycle",
              from: "src/a.ts",
              to: "src/b.ts",
              rule: { name: rule, severity: "error" },
            },
          ]
        : [],
      ruleSetUsed: { forbidden: [{ name: rule, severity: "error" }] },
    },
  });

interface Planted {
  readonly law: LawEntry;
  /** The reader is the one registered for this tool. */
  readonly tool: string;
  readonly bad: () => InputOptions;
  readonly clean: () => InputOptions;
  /** What the run is given when the tool did not run. */
  readonly none: () => InputOptions;
}

const dc = (id: string, rule: string): LawEntry =>
  lawOf(id, [{ tool: "dependency-cruiser", name: rule }]);

const TABLE: readonly Planted[] = [
  ...[
    ["W-16", "no-circular"],
    ["W-17", "no-unresolvable"],
    ["W-19", "no-optional-peer-import"],
  ].map(([id, rule]): Planted => ({
    law: dc(id ?? "", rule ?? ""),
    tool: "dependency-cruiser",
    bad: () => ({ artifacts: artifacts({ "dependency-cruiser-json": cruise(rule ?? "", true) }) }),
    clean: () => ({
      artifacts: artifacts({ "dependency-cruiser-json": cruise(rule ?? "", false) }),
    }),
    none: () => ({}),
  })),
  {
    law: lawOf("W-18", [{ tool: "publint", name: "publint" }]),
    tool: "publint",
    bad: () => ({
      artifacts: artifacts({ "publint-json": '{"code":1,"errors":["a missing file"]}' }),
    }),
    clean: () => ({ artifacts: artifacts({ "publint-json": '{"code":0,"errors":[]}' }) }),
    none: () => ({}),
  },
  {
    law: lawOf("W-18", [{ tool: "attw", name: "attw" }]),
    tool: "attw",
    bad: () => ({
      artifacts: artifacts({
        "attw-json": '{"code":1,"problems":[{"kind":"NoResolution","entrypoint":"."}]}',
      }),
    }),
    clean: () => ({ artifacts: artifacts({ "attw-json": '{"code":0,"problems":[]}' }) }),
    none: () => ({}),
  },
  {
    law: lawOf("W-38", [{ tool: "bun", name: "audit" }]),
    tool: "bun",
    bad: () => ({ artifacts: artifacts({ "audit-json": recorded("audit-vulnerable.json") }) }),
    clean: () => ({ artifacts: artifacts({ "audit-json": recorded("audit-clean.json") }) }),
    none: () => ({}),
  },
  {
    law: lawOf("W-40", [{ tool: "bun", name: "install --frozen-lockfile" }]),
    tool: "bun",
    bad: () => ({
      tracked: ["bun.lock"],
      artifacts: artifacts({
        "install-json": '{"command":"bun install --frozen-lockfile","code":1}',
      }),
    }),
    clean: () => ({
      tracked: ["bun.lock"],
      artifacts: artifacts({
        "install-json": '{"command":"bun install --frozen-lockfile","code":0}',
      }),
    }),
    none: () => ({ tracked: ["bun.lock"] }),
  },
];

async function readBy(tool: string, input: ReadInput): Promise<LawReading> {
  const reader = READERS.get(tool);
  if (reader === undefined) throw new Error(`no reader is registered for ${tool}`);
  const [reading] = await reader(input);
  if (reading === undefined) throw new Error(`${tool} gave no reading`);
  return reading;
}

describe.each(TABLE)("$law.id, read from $tool", (planted) => {
  const read = (options: InputOptions): Promise<LawReading> =>
    readBy(planted.tool, inputFor([planted.law], options));

  it("refuses its planted violation, with its id", async () => {
    const reading = await read(planted.bad());
    expect([reading.law, reading.verdict]).toEqual([planted.law.id, "refuse"]);
  });

  it("passes its clean twin", async () => {
    expect((await read(planted.clean())).verdict).toBe("pass");
  });

  it("is not evaluated when the tool did not run: never a pass", async () => {
    const reading = await read(planted.none());
    expect([reading.law, reading.verdict]).toEqual([planted.law.id, "not-evaluated"]);
  });
});
