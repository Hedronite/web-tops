import { describe, expect, it } from "vitest";
import type { Ack } from "../../acks/apply.ts";
import type { RawFinding } from "../../report/findings.ts";
import type { LawEntry, LawReading } from "../readers/types.ts";
import { ackAll, ackReading, lawAckFindings } from "./acked.ts";

/** What an acknowledgement does to the reading of a soft law (WEB_TOPS.md sections 3.3 and 8.1). */

const TODAY = "2026-11-20";

const law = (id: string, severity: "R" | "A"): LawEntry => ({
  id,
  severity,
  reader: "tl",
  classes: [],
  judged: true,
  rules: [{ tool: "eslint", name: "no-await-in-loop" }],
});

const SOFT = law("W-12", "A");

const place = (file: string, line: number | undefined): RawFinding => ({
  tool: "eslint",
  rule: "no-await-in-loop",
  verdict: "refuse",
  message: "an await in a loop",
  file,
  ...(line === undefined ? {} : { line }),
});

const refusal = (...findings: RawFinding[]): LawReading => ({
  law: "W-12",
  verdict: "refuse",
  findings,
});

const comment = (file: string, line: number, lawId = "W-12"): Ack => ({
  source: "comment",
  law: lawId,
  file,
  line,
  reason: "Each step needs the one before it.",
});

const ledger = (file: string, expires?: string, lawId = "W-12"): Ack => ({
  source: "ledger",
  law: lawId,
  file,
  reason: "Reviewed with the owner.",
  ...(expires === undefined ? {} : { expires }),
});

describe("a comment acknowledges the place on its line or just below it", () => {
  it("passes a place whose own line has the comment, and carries the ack", () => {
    const read = ackReading(SOFT, refusal(place("src/a.ts", 3)), [comment("src/a.ts", 3)], TODAY);
    expect(read.verdict).toBe("pass");
    expect(read.findings).toEqual([
      {
        ...place("src/a.ts", 3),
        verdict: "pass",
        ack: { source: "comment", reason: "Each step needs the one before it." },
      },
    ]);
  });

  it("passes a place whose line above has the comment", () => {
    const read = ackReading(SOFT, refusal(place("src/a.ts", 3)), [comment("src/a.ts", 2)], TODAY);
    expect(read.verdict).toBe("pass");
  });

  it("does not pass a place two lines below the comment, or one above it, or in another file", () => {
    for (const ack of [comment("src/a.ts", 1), comment("src/a.ts", 4), comment("src/b.ts", 3)]) {
      const read = ackReading(SOFT, refusal(place("src/a.ts", 3)), [ack], TODAY);
      expect([read.verdict, read.findings[0]?.verdict, read.findings[0]?.ack]).toEqual([
        "refuse",
        "refuse",
        undefined,
      ]);
    }
  });

  it("does not pass a place that has no line, whatever line a comment is on", () => {
    const read = ackReading(
      SOFT,
      refusal(place("src/a.ts", undefined)),
      [comment("src/a.ts", 1)],
      TODAY,
    );
    expect(read.verdict).toBe("refuse");
  });
});

describe("a ledger entry acknowledges every place of its law in its file", () => {
  it("passes places on any line of the file, with the ack's source and reason", () => {
    const read = ackReading(
      SOFT,
      refusal(place("src/a.ts", 3), place("src/a.ts", 90), place("src/a.ts", undefined)),
      [ledger("src/a.ts")],
      TODAY,
    );
    expect(read.verdict).toBe("pass");
    expect(read.findings.map((finding) => finding.ack)).toEqual([
      { source: "ledger", reason: "Reviewed with the owner." },
      { source: "ledger", reason: "Reviewed with the owner." },
      { source: "ledger", reason: "Reviewed with the owner." },
    ]);
  });

  it("does not cover another file, or an entry for another law", () => {
    for (const ack of [ledger("src/b.ts"), ledger("src/a.ts", undefined, "W-13")]) {
      const read = ackReading(SOFT, refusal(place("src/a.ts", 3)), [ack], TODAY);
      expect(read.verdict).toBe("refuse");
    }
  });

  it("covers through its expiry day and nothing after it", () => {
    const through = ackReading(
      SOFT,
      refusal(place("src/a.ts", 3)),
      [ledger("src/a.ts", TODAY)],
      TODAY,
    );
    const past = ackReading(
      SOFT,
      refusal(place("src/a.ts", 3)),
      [ledger("src/a.ts", "2026-11-19")],
      TODAY,
    );
    expect([through.verdict, past.verdict]).toEqual(["pass", "refuse"]);
  });
});

describe("the reading passes only when every place is acknowledged", () => {
  it("keeps the refusal, with the acknowledged place passing and the other refused", () => {
    const read = ackReading(
      SOFT,
      refusal(place("src/a.ts", 3), place("src/b.ts", 7)),
      [ledger("src/a.ts")],
      TODAY,
    );
    expect(read.verdict).toBe("refuse");
    expect(
      read.findings.map((finding) => [finding.file, finding.verdict, finding.ack?.source]),
    ).toEqual([
      ["src/a.ts", "pass", "ledger"],
      ["src/b.ts", "refuse", undefined],
    ]);
  });

  it("keeps the rest of the reading", () => {
    const given: LawReading = { ...refusal(place("src/a.ts", 3)), note: "1 rule", reason: "why" };
    expect(ackReading(SOFT, given, [ledger("src/a.ts")], TODAY)).toMatchObject({
      law: "W-12",
      note: "1 rule",
      reason: "why",
    });
  });
});

describe("what an acknowledgement leaves alone", () => {
  const acks = [ledger("src/a.ts"), comment("src/a.ts", 3)];

  it("never acknowledges a hard law", () => {
    const given = refusal(place("src/a.ts", 3));
    expect(ackReading(law("W-12", "R"), given, acks, TODAY)).toBe(given);
  });

  it("leaves a reading that is not a refusal as it is", () => {
    for (const verdict of ["pass", "not-evaluated", "fail"] as const) {
      const given: LawReading = { ...refusal(place("src/a.ts", 3)), verdict };
      expect(ackReading(SOFT, given, acks, TODAY)).toBe(given);
    }
  });

  it("leaves a refusal that lists no place as it is", () => {
    const given = refusal();
    expect(ackReading(SOFT, given, acks, TODAY)).toBe(given);
  });

  it("leaves a place that names no file as it is", () => {
    const bare: RawFinding = { tool: "eslint", rule: "r", verdict: "refuse", message: "m" };
    const read = ackReading(SOFT, refusal(bare), acks, TODAY);
    expect([read.verdict, read.findings]).toEqual(["refuse", [bare]]);
  });
});

const firstVerdict = (all: ReadonlyMap<string, readonly LawReading[]>, id: string) =>
  all.get(id)?.[0]?.verdict;

describe("ackAll: every law's readings, acknowledged by that law's acks", () => {
  it("answers for each law given, with no readings for one that had none", () => {
    const other = law("W-13", "A");
    const byLaw = new Map<string, readonly LawReading[]>([
      ["W-12", [refusal(place("src/a.ts", 3))]],
    ]);
    const all = ackAll([SOFT, other], byLaw, [ledger("src/a.ts")], TODAY);
    expect([...all.keys()]).toEqual(["W-12", "W-13"]);
    expect(all.get("W-12")?.map((read) => read.verdict)).toEqual(["pass"]);
    expect(all.get("W-13")).toEqual([]);
  });

  it("applies a law's own acks and not another's", () => {
    const other = law("W-13", "A");
    const byLaw = new Map<string, readonly LawReading[]>([
      ["W-12", [refusal(place("src/a.ts", 3))]],
      ["W-13", [{ ...refusal(place("src/a.ts", 3)), law: "W-13" }]],
    ]);
    const all = ackAll([SOFT, other], byLaw, [ledger("src/a.ts")], TODAY);
    expect([firstVerdict(all, "W-12"), firstVerdict(all, "W-13")]).toEqual(["pass", "refuse"]);
  });
});

describe("lawAckFindings: the problems the laws layer says", () => {
  const problem = (rule: string, line?: number) => ({
    file: "src/a.ts",
    rule,
    message: "m",
    ...(line === undefined ? {} : { line }),
  });

  it("is a failing finding for each of the two rules, with its line only when it has one", () => {
    expect(
      lawAckFindings([problem("ack-not-needed", 4), problem("ack-unknown-law")]),
    ).toStrictEqual([
      {
        tool: "webtops",
        rule: "ack-not-needed",
        verdict: "fail",
        message: "m",
        file: "src/a.ts",
        line: 4,
      },
      { tool: "webtops", rule: "ack-unknown-law", verdict: "fail", message: "m", file: "src/a.ts" },
    ]);
  });

  it("is nothing for the other rules", () => {
    expect(
      lawAckFindings([
        problem("ack-no-reason", 1),
        problem("ack-malformed", 1),
        problem("ack-ledger-unreadable"),
      ]),
    ).toEqual([]);
  });
});
