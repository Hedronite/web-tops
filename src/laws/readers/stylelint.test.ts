import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cfg } from "../../gate/testkit.ts";
import type { Exec, ExecResult } from "../../gate/types.ts";
import { sheetsOf, stylelintReader } from "./stylelint.ts";
import { inputFor, lawOf } from "./testkit.ts";
import type { LawReading } from "./types.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(files: Readonly<Record<string, string>> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-style-"));
  roots.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

const LAW = lawOf("W-26", [
  { tool: "stylelint", name: "color-no-invalid-hex" },
  { tool: "stylelint", name: "block-no-empty" },
  { tool: "eslint", name: "not-a-style-rule" },
]);

const ERROR = { level: 2, options: "[]" };
const ALL = { "color-no-invalid-hex": ERROR, "block-no-empty": ERROR };

/** Stands in for the question asked of the project's Stylelint: `rules` for each file it reaches. */
const answering =
  (rules: Readonly<Record<string, object>>, over: Partial<ExecResult> = {}): Exec =>
  () =>
    Promise.resolve({ code: 0, stdout: JSON.stringify({ rules }), stderr: "", ...over });

interface Given {
  readonly tracked?: readonly string[];
  readonly rules?: Readonly<Record<string, object>>;
  readonly results?: unknown;
  readonly held?: boolean;
  readonly className?: "astro-site" | "web-app";
  readonly files?: Readonly<Record<string, string>>;
  readonly exec?: Exec;
}

const DEFAULTS = {
  tracked: ["src/a.css"],
  rules: { "src/a.css": ALL },
  results: [],
  held: false,
  className: "web-app" as const,
};

function inputOver(given: Required<Omit<Given, "files" | "exec">> & Given) {
  const kept = ".web-tops/out/hygiene/stylelint.json";
  const dir = project({ [kept]: JSON.stringify(given.results), ...given.files });
  const input = inputFor([LAW], {
    cwd: dir,
    tracked: given.tracked,
    held: given.held,
    artifacts: { "stylelint-json": join(dir, kept) },
  });
  const config = cfg({ class: given.className });
  const exec = given.exec ?? answering(given.rules);
  return { ...input, ctx: { ...input.ctx, config, exec } };
}

async function read(given: Given): Promise<LawReading> {
  const [reading] = await stylelintReader(inputOver({ ...DEFAULTS, ...given }));
  if (reading === undefined) throw new Error("no reading");
  return reading;
}

const source = (file: string, over: object): object => ({ source: file, warnings: [], ...over });

const warning = (rule: string, line: number, text = `${rule} here`): object => ({
  rule,
  line,
  text,
  severity: "error",
});

describe("the stylesheets the reader judges", () => {
  const tracked = ["src/a.css", "src/p.astro", "src/a.ts", "dist/b.css", "fixtures/c.css"];

  it("are the tracked source ones, and .astro pages only for an astro-site", () => {
    expect(sheetsOf(tracked, "web-app")).toEqual({ files: ["src/a.css"], probes: [] });
    expect(sheetsOf(tracked, "astro-site")).toEqual({
      files: ["src/a.css", "src/p.astro"],
      probes: [],
    });
  });

  it("have a probe path for each type the project has none of", () => {
    expect(sheetsOf([], "astro-site")).toEqual({
      files: [],
      probes: ["src/__webtops_probe__.css", "src/__webtops_probe__.astro"],
    });
    expect(sheetsOf(["src/p.astro"], "astro-site").probes).toEqual(["src/__webtops_probe__.css"]);
  });
});

describe("W-26 from gate 1's Stylelint JSON and the effective rules", () => {
  it("passes rules at error for every file and no error of theirs", async () => {
    const results = [source("src/a.css", { warnings: [warning("some-other-rule", 3)] })];
    expect(await read({ results })).toEqual({ law: "W-26", verdict: "pass", findings: [] });
  });

  it("asks the project's Stylelint about the tracked sheets and the probes", async () => {
    let asked: unknown;
    await read({
      tracked: ["src/a.css"],
      className: "astro-site",
      exec: (_command, _args, options) => {
        const list = String(options?.env?.["WEBTOPS_LAWDIFF_FILES"]);
        asked = JSON.parse(readFileSync(list, "utf8"));
        return answering({ "src/a.css": ALL })("node", []);
      },
    });
    expect(asked).toEqual(["src/a.css", "src/__webtops_probe__.astro"]);
  });

  it("refuses each break at its file and line: a warning of its rule, or a file it could not parse", async () => {
    const results = [
      source("src/a.css", {
        warnings: [warning("color-no-invalid-hex", 2, "bad hex"), warning("CssSyntaxError", 7)],
        parseErrors: [{ line: 9, text: "bad value" }],
      }),
      source("dist/b.css", { warnings: [warning("block-no-empty", 1)] }),
      source("fixtures/c.css", { warnings: [warning("block-no-empty", 1)] }),
      source("src/b.css", { warnings: [{ rule: "block-no-empty" }] }),
    ];
    const reading = await read({ results });
    expect(reading.verdict).toBe("refuse");
    expect(reading.findings).toEqual([
      refusedAt("color-no-invalid-hex", "bad hex", "src/a.css", 2),
      refusedAt("CssSyntaxError", "CssSyntaxError here", "src/a.css", 7),
      refusedAt("parse-error", "bad value", "src/a.css", 9),
      {
        tool: "stylelint",
        rule: "block-no-empty",
        verdict: "refuse",
        message: "no message",
        file: "src/b.css",
      },
    ]);
  });

  it("leaves a counted break to the ratchet when it holds counts", async () => {
    const results = [source("src/a.css", { warnings: [warning("block-no-empty", 1)] })];
    expect(await read({ results, held: true })).toEqual({
      law: "W-26",
      verdict: "pass",
      findings: [],
      note: "1 held by the baseline",
    });
  });

  it.each([
    ["a rule at warning", { ...ALL, "block-no-empty": { level: 1, options: "[]" } }],
    ["a rule switched off", { ...ALL, "block-no-empty": { level: 0, options: "[]" } }],
    ["a rule the config never sets", { "color-no-invalid-hex": ERROR }],
  ])("refuses %s, at the config, whatever gate 1 reported", async (_name, rules) => {
    const reading = await read({
      held: true,
      rules: { "src/a.css": ALL, "src/b.css": rules },
      tracked: ["src/a.css", "src/b.css"],
      files: { ".stylelintrc.json": "{}\n" },
    });
    expect(reading.verdict).toBe("refuse");
    expect(reading.findings).toEqual([
      refusedAt(
        "block-no-empty",
        "block-no-empty is below error for 1 file(s), such as src/b.css",
        ".stylelintrc.json",
        1,
      ),
    ]);
  });

  it("names stylelint.config.js when no config file is found", async () => {
    const reading = await read({ rules: { "src/a.css": {} } });
    expect(reading.findings.map((finding) => finding.file)).toEqual([
      "stylelint.config.js",
      "stylelint.config.js",
    ]);
  });

  it("refuses a tracked sheet an ignore drops", async () => {
    const reading = await read({ tracked: ["src/a.css", "src/skipped.css"] });
    expect(reading).toEqual({
      law: "W-26",
      verdict: "refuse",
      findings: [
        {
          tool: "stylelint",
          rule: "file-set",
          verdict: "refuse",
          message: "src/skipped.css is not linted by Stylelint: an ignore drops it",
          file: "src/skipped.css",
        },
      ],
    });
  });

  it("says when its pass rests on a probe path", async () => {
    const reading = await read({ tracked: [], rules: { "src/__webtops_probe__.css": ALL } });
    expect(reading).toEqual({
      law: "W-26",
      verdict: "pass",
      findings: [],
      note: "judged on a probe path: the project has no stylesheet",
    });
  });

  it("keeps a break's own reading on a probe-only project", async () => {
    const results = [source("src/gone.css", { warnings: [warning("block-no-empty", 1)] })];
    const rules = { "src/__webtops_probe__.css": ALL };
    const reading = await read({ tracked: [], rules, results });
    expect(reading.verdict).toBe("refuse");
    expect(reading.note).toBeUndefined();
  });
});

describe("W-26 when the reader cannot judge", () => {
  it("is not-evaluated when the config reaches no stylesheet", async () => {
    expect(await read({ rules: {} })).toEqual({
      law: "W-26",
      verdict: "not-evaluated",
      reason: "Stylelint's config reaches no stylesheet, so no rule can be judged",
      findings: [],
    });
  });

  it("is not-evaluated when a rule's option made Stylelint skip it", async () => {
    const results = [source("src/a.css", { invalidOptionWarnings: [{ text: "bad option" }] })];
    expect(await read({ results })).toMatchObject({
      verdict: "not-evaluated",
      reason: "Stylelint's config holds an option it cannot use, so its rules did not all run",
    });
  });

  it("fails when Stylelint cannot be asked", async () => {
    const reading = await read({ exec: answering({}, { code: 1, stderr: "no config" }) });
    expect(reading.verdict).toBe("fail");
    expect(reading.reason).toMatch(/^Stylelint could not be asked .*no config/u);
    expect(reading.findings).toEqual([]);
  });

  it.each([
    ["gate 1 kept no JSON", {}],
    ["the JSON is not a list", { "stylelint-json": "not-a-list" }],
  ])("is not-evaluated when %s, and asks nothing", async (_name, kept) => {
    const dir = project({ "not-a-list": "{}" });
    const artifacts = Object.fromEntries(
      Object.entries(kept).map(([name, file]) => [name, join(dir, file)]),
    );
    const [reading] = await stylelintReader(inputFor([LAW], { cwd: dir, artifacts }));
    expect(reading).toEqual({
      law: "W-26",
      verdict: "not-evaluated",
      reason: "the Stylelint JSON of gate 1 is missing or is not an array of file results",
      findings: [],
    });
  });
});

function refusedAt(rule: string, message: string, file: string, line: number): object {
  return { tool: "stylelint", rule, verdict: "refuse", message, file, line };
}
