import { symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cfg } from "../../gate/testkit.ts";
import type { Exec, ExecResult, LayerContext } from "../../gate/types.ts";
import { cleanTemp, put, tempDir } from "../../laws/probe/testkit.ts";
import type { LawCatalog } from "./catalog.ts";
import { lawsLayer } from "./index.ts";
import type { LawEntry } from "../../laws/readers/types.ts";

afterAll(cleanTemp);

const REPO = resolve(import.meta.dirname, "../../..");
const ANY = "@typescript-eslint/no-explicit-any";

const law = (id: string, extra: Partial<LawEntry> = {}): LawEntry => ({
  id,
  severity: "R",
  reader: "tl",
  classes: [],
  judged: true,
  rules: [],
  ...extra,
});

const W01 = law("W-01", { rules: [{ tool: "eslint", name: "no-explicit-any" }] });
const W04 = law("W-04", {
  reader: "an",
  rules: [
    { tool: "tsc", name: "strict" },
    { tool: "tsc", name: "noUncheckedIndexedAccess" },
  ],
});

const TSCONFIG =
  '{\n  "compilerOptions": {\n    "strict": true,\n    "noUncheckedIndexedAccess": true\n  },\n  "include": ["src"]\n}\n';

interface Scenario {
  readonly tracked: string[];
  /** ESLint's answer: each file's levels, and the ignored ones. */
  readonly levels: Record<string, Record<string, number>>;
  readonly ignored?: Record<string, boolean>;
  readonly git?: ExecResult;
}

const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: "" });

/** A fake process runner: `git ls-files` lists the tracked files, and `node` answers the ESLint question. */
function runner(scenario: Scenario, calls: string[]): Exec {
  return (command) => {
    calls.push(command);
    if (command === "git") {
      return Promise.resolve(scenario.git ?? ok(`${scenario.tracked.join("\0")}\0`));
    }
    const levels = scenario.levels;
    const ignored = Object.fromEntries(
      scenario.tracked.map((file) => [file, scenario.ignored?.[file] === true]),
    );
    return Promise.resolve(ok(JSON.stringify({ ignored, levels })));
  };
}

function project(): string {
  const cwd = tempDir();
  symlinkSync(join(REPO, "node_modules"), join(cwd, "node_modules"));
  put(cwd, {
    "tsconfig.json": TSCONFIG,
    "src/a.ts": "export const a = 1;\n",
    "out/eslint.json": "[]\n",
    "out/tsc.json": "[]\n",
    "eslint.config.js": `export default [\n  { rules: { "${ANY}": "error" } },\n  { files: ["src/**"], rules: { "${ANY}": "off" } },\n];\n`,
  });
  return cwd;
}

function context(cwd: string, exec: Exec, className = "ts-library"): LayerContext {
  return {
    cwd,
    config: cfg({ class: className === "ts-library" ? "ts-library" : "node-service" }),
    base: "origin/main",
    enforce: "hard",
    env: {},
    exec,
    outDir: join(cwd, ".web-tops", "out"),
    artifacts: new Map([
      ["eslint-json", join(cwd, "out/eslint.json")],
      ["tsc-diagnostics", join(cwd, "out/tsc.json")],
    ]),
  };
}

const CATALOG =
  (...laws: LawEntry[]): LawCatalog =>
  () =>
    laws;

describe("G4a the laws layer is registered as the last gate, reading what hygiene wrote", () => {
  it("is gate laws at tier 1, requires hygiene and consumes its ESLint JSON, and maps every launch class", () => {
    const layer = lawsLayer(CATALOG());
    expect(layer).toMatchObject({ id: "laws", gate: "laws", tier: 1, requires: ["hygiene"] });
    expect(layer.consumes.filter((need) => need.optional !== true)).toEqual([
      { artifact: "eslint-json", from: "hygiene" },
      { artifact: "tsc-diagnostics", from: "hygiene" },
    ]);
    expect(
      layer.consumes.filter((need) => need.optional === true).map((need) => need.artifact),
    ).toEqual([
      "attw-json",
      "audit-json",
      "dependency-cruiser-json",
      "install-json",
      "publint-json",
    ]);
    expect(layer.classes).toEqual([
      "ts-library",
      "ui-components",
      "astro-site",
      "web-app",
      "node-service",
    ]);
  });
});

describe("G4 the laws layer reads each law's tools and gives every mapped law a finding", () => {
  it("passes when the rules are at error for every file and the flags are set, with one finding for each law", async () => {
    const cwd = project();
    const scenario: Scenario = { tracked: ["src/a.ts"], levels: { "src/a.ts": { [ANY]: 2 } } };
    const result = await lawsLayer(CATALOG(W01, W04)).run(context(cwd, runner(scenario, [])));
    expect(result.verdict).toBe("pass");
    expect(
      result.findings.map((found) => [found.rule, found.law, found.verdict, found.required]),
    ).toEqual([
      ["law/W-01", "W-01", "pass", true],
      ["law/W-04", "W-04", "pass", true],
    ]);
  });

  it("an override that turns a required rule off is refuse at its config line, and ends the layer refuse", async () => {
    const cwd = project();
    const scenario: Scenario = { tracked: ["src/a.ts"], levels: { "src/a.ts": { [ANY]: 0 } } };
    const result = await lawsLayer(CATALOG(W01)).run(context(cwd, runner(scenario, [])));
    expect(result.verdict).toBe("refuse");
    expect(
      result.findings.map((found) => [found.rule, found.verdict, found.file, found.line]),
    ).toEqual([
      ["law/W-01", "refuse", undefined, undefined],
      [ANY, "refuse", "eslint.config.js", 3],
    ]);
  });

  it("a required law no reader reads is not-evaluated and ends the layer, where one not required only counts", async () => {
    const cwd = project();
    const scenario: Scenario = { tracked: ["src/a.ts"], levels: { "src/a.ts": { [ANY]: 2 } } };
    const audit = law("W-38", { rules: [{ tool: "audit", name: "audit" }] });
    const required = await lawsLayer(CATALOG(W01, audit)).run(context(cwd, runner(scenario, [])));
    expect(required.verdict).toBe("not-evaluated");
    expect(required.findings.find((found) => found.law === "W-38")?.message).toBe(
      "W-38 not-evaluated: audit has no reader yet",
    );
    const later = law("W-38", { judged: false, rules: [{ tool: "audit", name: "audit" }] });
    const counted = await lawsLayer(CATALOG(W01, later)).run(context(cwd, runner(scenario, [])));
    expect(counted.verdict).toBe("pass");
    expect(counted.findings.find((found) => found.law === "W-38")).toMatchObject({
      verdict: "not-evaluated",
      required: false,
    });
  });

  it("maps only the laws of the class, so a law the class does not map has no finding", async () => {
    const cwd = project();
    const scenario: Scenario = { tracked: ["src/a.ts"], levels: { "src/a.ts": { [ANY]: 2 } } };
    const w18 = law("W-18", {
      classes: ["ts-library"],
      rules: [{ tool: "publint", name: "publint" }],
    });
    const result = await lawsLayer(CATALOG(W01, w18)).run(
      context(cwd, runner(scenario, []), "node-service"),
    );
    expect(result.findings.map((found) => found.law)).toEqual(["W-01"]);
  });

  it("a tracked source file no ESLint config block reaches is a refusal of the layer's own, with its file", async () => {
    const cwd = project();
    const scenario: Scenario = {
      tracked: ["src/a.ts", "src/lost.mts"],
      levels: { "src/a.ts": { [ANY]: 2 } },
    };
    const result = await lawsLayer(CATALOG(W01)).run(context(cwd, runner(scenario, [])));
    expect(result.verdict).toBe("refuse");
    expect(result.findings.at(-1)).toMatchObject({
      tool: "eslint",
      rule: "file-set",
      verdict: "refuse",
      file: "src/lost.mts",
    });
  });

  it("asks ESLint once for all the readers, and runs git once", async () => {
    const cwd = project();
    const calls: string[] = [];
    const scenario: Scenario = { tracked: ["src/a.ts"], levels: { "src/a.ts": { [ANY]: 2 } } };
    await lawsLayer(CATALOG(W01, W04)).run(context(cwd, runner(scenario, calls)));
    expect(calls).toEqual(["git", "node"]);
  });

  it("a git that cannot list the tracked files fails the layer with that finding", async () => {
    const cwd = project();
    const git: ExecResult = { code: 128, stdout: "", stderr: "not a git repository" };
    const scenario: Scenario = { tracked: [], levels: {}, git };
    const result = await lawsLayer(CATALOG(W01)).run(context(cwd, runner(scenario, [])));
    expect(result.verdict).toBe("fail");
    expect(result.findings[0]?.rule).toBe("git-ls-files-failed");
  });

  it("ESLint that cannot be asked fails the laws that read it, with the reason, and not the others", async () => {
    const cwd = project();
    const broken: Exec = (command) =>
      Promise.resolve(
        command === "git"
          ? ok("src/a.ts\0")
          : { code: 1, stdout: "", stderr: "config did not load" },
      );
    const result = await lawsLayer(CATALOG(W01, W04)).run(context(cwd, broken));
    expect(result.verdict).toBe("fail");
    expect(result.findings.map((found) => [found.law, found.verdict])).toEqual([
      ["W-01", "fail"],
      ["W-04", "pass"],
    ]);
  });
});
