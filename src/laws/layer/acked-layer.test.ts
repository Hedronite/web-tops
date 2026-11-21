import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cfg } from "../../gate/testkit.ts";
import type { Exec, GateConfig, LayerContext, LayerResult } from "../../gate/types.ts";
import { cleanTemp, put, tempDir } from "../probe/testkit.ts";
import type { LawEntry, LawReader } from "../readers/types.ts";
import { lawsLayer } from "./index.ts";

afterAll(cleanTemp);

/** The laws layer reads the acknowledgements of the project, the comments and the ledger `laws.ack_ledger` names. */

const SOFT: LawEntry = {
  id: "W-12",
  severity: "A",
  reader: "tl",
  classes: [],
  judged: true,
  rules: [{ tool: "eslint", name: "no-await-in-loop" }],
};

/** Another soft law, and a hard one: a comment or an entry of either names a law, so it is not an unknown id. */
const OTHER: LawEntry = { ...SOFT, id: "W-13", judged: false };
const HARD: LawEntry = { ...SOFT, id: "W-04", severity: "R", judged: false };

/** A reader that refuses the soft law at `src/a.ts` line 3. */
const refuses: LawReader = (input) =>
  Promise.resolve(
    input.laws.map((law) => ({
      law: law.id,
      verdict: "refuse" as const,
      findings: [
        {
          tool: "eslint" as const,
          rule: "no-await-in-loop",
          verdict: "refuse" as const,
          message: "an await in a loop",
          file: "src/a.ts",
          line: 3,
        },
      ],
    })),
  );

/** A reader that finds nothing wrong. */
const passes: LawReader = (input) =>
  Promise.resolve(
    input.laws.map((law) => ({ law: law.id, verdict: "pass" as const, findings: [] })),
  );

const LEDGER = [
  "version: 1",
  "acks:",
  "  - law: W-12",
  "    file: src/a.ts",
  "    reason: Each step needs the one before it.",
  "    owner: web-platform",
  "",
].join("\n");

const WHOLE = "export const a = 1;\nawait Promise.resolve();\nawait Promise.resolve();\n";

/** A fake process runner: `git ls-files` lists the project's files, and `node` answers the ESLint question. */
const runner: Exec = (command) =>
  Promise.resolve({
    code: 0,
    stdout:
      command === "git"
        ? "src/a.ts\0"
        : JSON.stringify({ ignored: { "src/a.ts": false }, levels: { "src/a.ts": {} } }),
    stderr: "",
  });

async function run(
  files: Readonly<Record<string, string>>,
  config: Partial<GateConfig> = {},
  reader: LawReader = refuses,
): Promise<LayerResult> {
  const cwd = tempDir();
  put(cwd, { "src/a.ts": WHOLE, "out/e.json": "[]\n", "out/t.json": "[]\n", ...files });
  const ctx: LayerContext = {
    cwd,
    config: cfg({ class: "ts-library", ...config }),
    base: "origin/main",
    enforce: "hard",
    env: {},
    exec: runner,
    outDir: join(cwd, ".web-tops", "out"),
    artifacts: new Map([
      ["eslint-json", join(cwd, "out/e.json")],
      ["tsc-diagnostics", join(cwd, "out/t.json")],
    ]),
  };
  return lawsLayer(() => [SOFT, OTHER, HARD], new Map([["eslint", reader]])).run(ctx);
}

const runQuiet = (files: Readonly<Record<string, string>>) => run(files, {}, passes);

const lawOf = (result: LayerResult) => result.findings.find((found) => found.rule === "law/W-12");
const placeOf = (result: LayerResult) =>
  result.findings.find((found) => found.rule === "no-await-in-loop");

describe("a soft law that is refused with no acknowledgement", () => {
  it("is ack-missing, and the place says so", async () => {
    const result = await run({});
    expect([result.verdict, lawOf(result)?.verdict]).toEqual(["ack-missing", "ack-missing"]);
    expect(placeOf(result)).toMatchObject({ file: "src/a.ts", line: 3, verdict: "ack-missing" });
    expect(placeOf(result)?.ack).toBeUndefined();
  });
});

describe("a soft law acknowledged in the ledger", () => {
  it("passes, and the place carries the ledger's ack", async () => {
    const result = await run({ ".web-tops/acks.yaml": LEDGER });
    expect([result.verdict, lawOf(result)?.verdict]).toEqual(["pass", "pass"]);
    expect(placeOf(result)).toMatchObject({
      verdict: "pass",
      ack: { source: "ledger", reason: "Each step needs the one before it." },
    });
  });

  it("is read from the file `laws.ack_ledger` names, and not from the default one", async () => {
    const named = await run({ "docs/acks.yaml": LEDGER }, { ackLedger: "docs/acks.yaml" });
    expect(named.verdict).toBe("pass");
    const other = await run({ ".web-tops/acks.yaml": LEDGER }, { ackLedger: "docs/acks.yaml" });
    expect(other.verdict).toBe("ack-missing");
  });

  it("does not pass it when the entry has expired", async () => {
    const result = await run({
      ".web-tops/acks.yaml": LEDGER.replace("    owner:", "    expires: 2000-01-01\n    owner:"),
    });
    expect(result.verdict).toBe("ack-missing");
  });

  it("does not pass it when the ledger cannot be read: the census fails the run for that", async () => {
    const result = await run({ ".web-tops/acks.yaml": "version: [" });
    expect(result.verdict).toBe("ack-missing");
  });
});

describe("a soft law acknowledged by a comment", () => {
  it("passes when the comment is on the line above the place, and carries the comment's ack", async () => {
    const text =
      "export const a = 1;\n// webtops-ack W-12: Each step needs the one before it.\nawait Promise.resolve();\n";
    const result = await run({ "src/a.ts": text });
    expect(result.verdict).toBe("pass");
    expect(placeOf(result)?.ack).toEqual({
      source: "comment",
      reason: "Each step needs the one before it.",
    });
  });

  it("does not pass when the comment is for another law", async () => {
    const text =
      "export const a = 1;\n// webtops-ack W-13: Each step needs the one before it.\nawait Promise.resolve();\n";
    expect((await run({ "src/a.ts": text })).verdict).toBe("ack-missing");
  });
});

const problemsOf = (result: LayerResult) =>
  result.findings.filter(
    (found) => found.rule === "ack-not-needed" || found.rule === "ack-unknown-law",
  );

describe("an acknowledgement of a hard law or of an id that is no law fails the layer", () => {
  const quiet = "export const a = 1;\n";

  it("fails a comment of a hard law, at its line, though no law is broken", async () => {
    const text = `${quiet}// webtops-ack W-04: Reviewed with the owner.\n`;
    const result = await runQuiet({ "src/a.ts": text });
    expect(problemsOf(result)).toMatchObject([
      { rule: "ack-not-needed", verdict: "fail", file: "src/a.ts", line: 2 },
    ]);
    expect(result.verdict).toBe("fail");
  });

  it("fails a comment of an id that is no law", async () => {
    const result = await runQuiet({
      "src/a.ts": `${quiet}// webtops-ack W-99: Reviewed with the owner.\n`,
    });
    expect(problemsOf(result)).toMatchObject([
      { rule: "ack-unknown-law", verdict: "fail", file: "src/a.ts", line: 2 },
    ]);
    expect(result.verdict).toBe("fail");
  });

  it("fails a ledger entry of a hard law and one of an id that is no law, at the ledger", async () => {
    const entry = (law: string): string =>
      `  - law: ${law}\n    file: src/a.ts\n    reason: Reviewed with the owner.\n    owner: web-platform\n`;
    const result = await runQuiet({
      ".web-tops/acks.yaml": `version: 1\nacks:\n${entry("W-04")}${entry("W-99")}`,
    });
    expect(problemsOf(result)).toMatchObject([
      { rule: "ack-not-needed", verdict: "fail", file: ".web-tops/acks.yaml" },
      { rule: "ack-unknown-law", verdict: "fail", file: ".web-tops/acks.yaml" },
    ]);
    expect(result.verdict).toBe("fail");
  });

  it("says nothing of an acknowledgement of a soft law that is well formed, and of one with no reason, which the census says", async () => {
    const text = `${quiet}// webtops-ack W-12: Reviewed with the owner.\n// webtops-ack W-13:\n`;
    const result = await runQuiet({ "src/a.ts": text });
    expect(problemsOf(result)).toEqual([]);
    expect(result.verdict).toBe("pass");
  });

  it("does not let a hard law's acknowledgement pass a refusal of a soft one", async () => {
    const text =
      "export const a = 1;\n// webtops-ack W-04: Reviewed with the owner.\nawait Promise.resolve();\n";
    const result = await run({ "src/a.ts": text });
    expect(lawOf(result)?.verdict).toBe("ack-missing");
    expect(result.verdict).toBe("fail");
  });
});
