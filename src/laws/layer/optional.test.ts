import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cfg } from "../../gate/testkit.ts";
import type { Exec, LayerContext } from "../../gate/types.ts";
import { cleanTemp, tempDir } from "../probe/testkit.ts";
import type { LawEntry, LawReader } from "../readers/types.ts";
import type { LawCatalog } from "./catalog.ts";
import { lawsLayer } from "./index.ts";

afterAll(cleanTemp);

/** R92: the tool artifacts are optional inputs; a law whose artifact gate 1 did not write is not-evaluated, never a pass. */

const law = (id: string, tool: string, name: string): LawEntry => ({
  id,
  severity: "R",
  reader: "tl",
  classes: [],
  judged: true,
  rules: [{ tool, name }],
});

const AUDIT = law("W-38", "bun", "audit");
const LOCK = law("W-39", "bun", "install --frozen-lockfile");
const CRUISE = law("W-19", "dependency-cruiser", "no-circular");

const CATALOG =
  (...laws: LawEntry[]): LawCatalog =>
  () =>
    laws;

const exec: Exec = (command) =>
  Promise.resolve({
    code: 0,
    stdout: command === "git" ? "" : JSON.stringify({ ignored: {}, levels: {} }),
    stderr: "",
  });

function context(have: readonly string[]): LayerContext {
  const cwd = tempDir();
  return {
    cwd,
    config: cfg({ class: "ts-library" }),
    base: "origin/main",
    enforce: "hard",
    env: {},
    exec,
    outDir: join(cwd, ".web-tops", "out"),
    artifacts: new Map(have.map((name) => [name, join(cwd, name)])),
  };
}

/** A reader that passes every law it is given, and records which. */
function passing(seen: string[]): LawReader {
  return (input) => {
    seen.push(...input.laws.map((one) => one.id));
    return Promise.resolve(
      input.laws.map((one) => ({ law: one.id, verdict: "pass" as const, findings: [] })),
    );
  };
}

describe("G4 a law whose tool artifact is missing is not-evaluated", () => {
  it("is declared as optional inputs of hygiene, beside the two it always needs, and writes no artifact", () => {
    const layer = lawsLayer(CATALOG());
    const consumes = layer.consumes;
    expect(layer.produces).toEqual([]);
    expect(consumes.every((one) => one.from === "hygiene" || one.from === "build-output")).toBe(
      true,
    );
    expect(consumes.filter((one) => one.optional !== true)).toEqual([
      { artifact: "eslint-json", from: "hygiene" },
      { artifact: "tsc-diagnostics", from: "hygiene" },
    ]);
    expect(consumes.filter((one) => one.optional === true)).toEqual([
      { artifact: "astro-check-json", from: "hygiene", optional: true },
      { artifact: "attw-json", from: "hygiene", optional: true },
      { artifact: "audit-json", from: "hygiene", optional: true },
      { artifact: "dependency-cruiser-json", from: "hygiene", optional: true },
      { artifact: "install-json", from: "hygiene", optional: true },
      { artifact: "publint-json", from: "hygiene", optional: true },
      { artifact: "stylelint-json", from: "hygiene", optional: true },
      { artifact: "bytes-json", from: "build-output", optional: true },
      { artifact: "route-bytes-json", from: "build-output", optional: true },
    ]);
  });

  it("asks a reader for the rules of its own tool only: another tool's missing artifact is not its concern", async () => {
    const seen: string[] = [];
    const mixed: LawEntry = {
      ...law("W-40", "eslint", "no-explicit-any"),
      rules: [
        { tool: "eslint", name: "no-explicit-any" },
        { tool: "bun", name: "audit" },
      ],
    };
    const layer = lawsLayer(CATALOG(mixed), new Map([["eslint", passing(seen)]]));
    await layer.run(context([]));
    expect(seen).toEqual(["W-40"]);
  });

  it("does not call a reader that has no law left to read", async () => {
    let calls = 0;
    const counting: LawReader = () => {
      calls += 1;
      return Promise.resolve([]);
    };
    await lawsLayer(CATALOG(AUDIT), new Map([["bun", counting]])).run(context([]));
    expect(calls).toBe(0);
  });

  it("does not ask the reader, and says which artifact is missing and which tool cannot be read", async () => {
    const seen: string[] = [];
    const layer = lawsLayer(CATALOG(AUDIT), new Map([["bun", passing(seen)]]));
    const result = await layer.run(context([]));
    expect(seen).toEqual([]);
    expect(result.verdict).toBe("not-evaluated");
    expect(result.findings[0]).toMatchObject({ rule: "law/W-38", verdict: "not-evaluated" });
    expect(JSON.stringify(result.findings)).toContain(
      "audit-json is missing: gate 1 did not write it, so bun cannot be read",
    );
  });

  it("reads the laws whose artifact is there and not the ones whose artifact is not, in one tool", async () => {
    const seen: string[] = [];
    const layer = lawsLayer(CATALOG(AUDIT, LOCK), new Map([["bun", passing(seen)]]));
    const result = await layer.run(context(["install-json"]));
    expect(seen).toEqual(["W-39"]);
    expect(result.findings.map((one) => [one.rule, one.verdict])).toEqual([
      ["law/W-38", "not-evaluated"],
      ["law/W-39", "pass"],
    ]);
  });

  it("reads every law when every artifact is there, and the verdict is pass", async () => {
    const seen: string[] = [];
    const layer = lawsLayer(
      CATALOG(AUDIT, CRUISE),
      new Map([
        ["bun", passing(seen)],
        ["dependency-cruiser", passing(seen)],
      ]),
    );
    const result = await layer.run(context(["audit-json", "dependency-cruiser-json"]));
    expect(seen).toEqual(["W-38", "W-19"]);
    expect(result.verdict).toBe("pass");
  });
});
