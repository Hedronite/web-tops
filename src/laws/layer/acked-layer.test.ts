import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Ack } from "../../acks/apply.ts";
import type { Collected } from "../../acks/collect.ts";
import type { SeverityOf } from "../../acks/severity.ts";
import { cfg } from "../../gate/testkit.ts";
import type { Exec, GateConfig, LayerContext, LayerResult } from "../../gate/types.ts";
import { cleanTemp, put, tempDir } from "../probe/testkit.ts";
import type { LawEntry, LawReader } from "../readers/types.ts";
import { lawsLayer } from "./index.ts";

afterAll(cleanTemp);

/**
 * The laws layer reads the acknowledgements of the project through the function it is given (the real one reads the
 * comments and the ledger: the child process test beside this one runs the real gate), and applies them.
 */

const SOFT: LawEntry = {
  id: "W-12",
  severity: "A",
  reader: "tl",
  classes: [],
  judged: true,
  rules: [{ tool: "eslint", name: "no-await-in-loop" }],
};

/** Another soft law, and a hard one: they are in the catalog, so an acknowledgement naming them is not of an unknown id. */
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

const NOTHING: Collected = { acks: [], problems: [] };

const ledgerAck: Ack = {
  source: "ledger",
  law: "W-12",
  file: "src/a.ts",
  reason: "Each step needs the one before it.",
};
const commentAck: Ack = { ...ledgerAck, source: "comment", line: 2 };

interface Seen {
  ledger?: string;
  severity?: SeverityOf;
}

async function run(
  collected: Collected,
  options: { config?: Partial<GateConfig>; reader?: LawReader; seen?: Seen } = {},
): Promise<LayerResult> {
  const cwd = tempDir();
  put(cwd, { "out/e.json": "[]\n", "out/t.json": "[]\n" });
  const ctx: LayerContext = {
    cwd,
    config: cfg({ class: "ts-library", ...options.config }),
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
  const seen = options.seen ?? {};
  return lawsLayer(
    () => [SOFT, OTHER, HARD],
    new Map([["eslint", options.reader ?? refuses]]),
    (_cwd, _files, ledger, severity) => {
      seen.ledger = ledger;
      seen.severity = severity;
      return collected;
    },
  ).run(ctx);
}

const lawOf = (result: LayerResult) => result.findings.find((found) => found.rule === "law/W-12");
const placeOf = (result: LayerResult) =>
  result.findings.find((found) => found.rule === "no-await-in-loop");
const problemsOf = (result: LayerResult) =>
  result.findings.filter(
    (found) => found.rule === "ack-not-needed" || found.rule === "ack-unknown-law",
  );

describe("a soft law that is refused with no acknowledgement", () => {
  it("is ack-missing, and the place says so", async () => {
    const result = await run(NOTHING);
    expect([result.verdict, lawOf(result)?.verdict]).toEqual(["ack-missing", "ack-missing"]);
    expect(placeOf(result)).toMatchObject({ file: "src/a.ts", line: 3, verdict: "ack-missing" });
    expect(placeOf(result)?.ack).toBeUndefined();
  });
});

describe("a soft law that an acknowledgement covers", () => {
  it("passes through a ledger entry, and the place carries the ledger's ack", async () => {
    const result = await run({ acks: [ledgerAck], problems: [] });
    expect([result.verdict, lawOf(result)?.verdict]).toEqual(["pass", "pass"]);
    expect(placeOf(result)).toMatchObject({
      verdict: "pass",
      ack: { source: "ledger", reason: "Each step needs the one before it." },
    });
  });

  it("passes through a comment on the line above the place, and carries the comment's ack", async () => {
    const result = await run({ acks: [commentAck], problems: [] });
    expect(result.verdict).toBe("pass");
    expect(placeOf(result)?.ack).toEqual({
      source: "comment",
      reason: "Each step needs the one before it.",
    });
  });

  it("does not pass through an acknowledgement of another law", async () => {
    const result = await run({ acks: [{ ...ledgerAck, law: "W-13" }], problems: [] });
    expect(result.verdict).toBe("ack-missing");
  });
});

describe("the acknowledgements are read with the ledger the config names and the catalog's severities", () => {
  it("asks for .web-tops/acks.yaml when the config names none, and for the one it names otherwise", async () => {
    const standard: Seen = {};
    await run(NOTHING, { seen: standard });
    expect(standard.ledger).toBe(".web-tops/acks.yaml");
    const named: Seen = {};
    await run(NOTHING, { config: { ackLedger: "docs/acks.yaml" }, seen: named });
    expect(named.ledger).toBe("docs/acks.yaml");
  });

  it("hands over the severity of every law of the catalog, not only those of the class, and none for an id that is no law", async () => {
    const seen: Seen = {};
    await run(NOTHING, { seen });
    expect(["W-12", "W-13", "W-04", "W-99"].map((id) => seen.severity?.(id))).toEqual([
      "A",
      "A",
      "R",
      undefined,
    ]);
  });
});

describe("an acknowledgement of a hard law or of an id that is no law fails the layer", () => {
  const at = (rule: string, file: string, line?: number) => ({
    file,
    rule,
    message: `${rule} says so`,
    ...(line === undefined ? {} : { line }),
  });

  it("is a failing finding at the comment's line, though no law is broken", async () => {
    const result = await run(
      { acks: [], problems: [at("ack-not-needed", "src/a.ts", 2)] },
      { reader: passes },
    );
    expect(problemsOf(result)).toMatchObject([
      { rule: "ack-not-needed", verdict: "fail", file: "src/a.ts", line: 2 },
    ]);
    expect(result.verdict).toBe("fail");
  });

  it("is a failing finding at the ledger, for each of the two rules", async () => {
    const result = await run(
      {
        acks: [],
        problems: [
          at("ack-not-needed", ".web-tops/acks.yaml"),
          at("ack-unknown-law", ".web-tops/acks.yaml"),
        ],
      },
      { reader: passes },
    );
    expect(problemsOf(result)).toMatchObject([
      { rule: "ack-not-needed", verdict: "fail", file: ".web-tops/acks.yaml" },
      { rule: "ack-unknown-law", verdict: "fail", file: ".web-tops/acks.yaml" },
    ]);
    expect(result.verdict).toBe("fail");
  });

  it("leaves the other problems of an acknowledgement to the census", async () => {
    const result = await run(
      {
        acks: [],
        problems: [at("ack-no-reason", "src/a.ts", 2), at("ack-ledger-unreadable", "acks.yaml")],
      },
      { reader: passes },
    );
    expect(result.findings.filter((found) => found.rule.startsWith("ack-"))).toEqual([]);
    expect(result.verdict).toBe("pass");
  });

  it("does not let a hard law's acknowledgement pass a refusal of a soft one", async () => {
    const result = await run({
      acks: [],
      problems: [at("ack-not-needed", "src/a.ts", 2)],
    });
    expect(lawOf(result)?.verdict).toBe("ack-missing");
    expect(result.verdict).toBe("fail");
  });
});
