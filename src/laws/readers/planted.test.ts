import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import pkg from "../../../package.json" with { type: "json" };
import { NODE_RANGE } from "../../lock/pins.ts";
import { recorded } from "../../layers/hygiene/testkit.ts";
import type { LawEntry, LawReader, LawReading, ReadInput } from "./types.ts";
import { attwReader } from "./attw.ts";
import { bunReader } from "./bun.ts";
import { depcruiseReader } from "./depcruise.ts";
import { lockReader } from "./lock.ts";
import { publintReader } from "./publint.ts";
import { inputFor, lawOf, type InputOptions } from "./testkit.ts";

// The readers by the tool they read, as the laws layer registers them.
const READERS: ReadonlyMap<string, LawReader> = new Map([
  ["attw", attwReader],
  ["bun", bunReader],
  ["dependency-cruiser", depcruiseReader],
  ["lock", lockReader],
  ["publint", publintReader],
]);

// One planted violation for each law the readers here judge: the registered reader gives `refuse` for it, `pass` for its
// clean twin, and `not-evaluated` when the tool did not run (WEB_TOPS.md 3.3, 8.1). The table is the laws that read a
// result gate 1 kept; W-41 reads the project's own installed tools, below. The real catalog entries run through the real
// laws layer in `layer/real-readers-e2e.test.ts`. `planted-coverage.test.ts` fails when a law with a reader has no plant.

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

function lockProject(installed: string): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-planted-lock-"));
  made.push(dir);
  const files: Record<string, string> = {
    "web-tops.lock": `typescript: 6.0.3\nwebtops: ${pkg.version}\nnode: "${NODE_RANGE}"\n`,
    "node_modules/typescript/package.json": JSON.stringify({
      name: "typescript",
      version: installed,
    }),
  };
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

describe("W-41, read from the lock", () => {
  const law = lawOf("W-41", [{ tool: "lock", name: "web-tops.lock" }]);

  it("refuses an installed tool that is not the locked version, and passes the one that is", async () => {
    const bad = await readBy("lock", inputFor([law], { cwd: lockProject("5.0.0") }));
    const clean = await readBy("lock", inputFor([law], { cwd: lockProject("6.0.3") }));
    expect([bad.law, bad.verdict, clean.verdict]).toEqual(["W-41", "refuse", "pass"]);
  });

  it("refuses an installed tool whose package.json cannot be read: what is installed does not match the lock", async () => {
    const dir = lockProject("6.0.3");
    writeFileSync(join(dir, "node_modules/typescript/package.json"), "not json");
    const reading = await readBy("lock", inputFor([law], { cwd: dir }));
    expect([reading.law, reading.verdict]).toEqual(["W-41", "refuse"]);
    expect(reading.findings[0]?.message).toContain("typescript: locked 6.0.3, not installed");
  });

  it("refuses a project with no lock at all: there is nothing to match", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-planted-nolock-"));
    made.push(dir);
    expect((await readBy("lock", inputFor([law], { cwd: dir }))).verdict).toBe("refuse");
  });
});
