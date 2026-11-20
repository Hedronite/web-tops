import { describe, expect, it } from "vitest";
import { evidenceOf, judgeEntry, lawFinding, readingsOf, sentence, worse } from "./judge.ts";
import type { LawEntry, LawReading } from "../../laws/readers/types.ts";

const law = (id: string, extra: Partial<LawEntry> = {}): LawEntry => ({
  id,
  severity: "R",
  reader: "tl",
  classes: [],
  judged: true,
  rules: [{ tool: "eslint", name: "r" }],
  ...extra,
});

const reading = (verdict: LawReading["verdict"], extra: Partial<LawReading> = {}): LawReading => ({
  law: "W-01",
  verdict,
  findings: [],
  ...extra,
});

const spot = {
  tool: "eslint",
  rule: "x/r",
  law: "W-01",
  verdict: "refuse",
  message: "m",
  file: "eslint.config.js",
  line: 3,
} as const;

describe("G4d one verdict for a law, from what its readers say", () => {
  it("takes the worst of the verdicts, refuse first and pass last", () => {
    expect(worse("pass", "refuse")).toBe("refuse");
    expect(worse("not-evaluated", "fail")).toBe("fail");
    expect(worse("ack-missing", "not-evaluated")).toBe("ack-missing");
    expect(worse("pass", "pass")).toBe("pass");
  });

  it("a law passes only when every reader passes: a refusal beats a pass, and not-evaluated beats it too", () => {
    expect(
      judgeEntry(law("W-01"), "ts-library", [reading("pass"), reading("refuse")]).verdict,
    ).toBe("refuse");
    expect(
      judgeEntry(law("W-01"), "ts-library", [reading("pass"), reading("not-evaluated")]).verdict,
    ).toBe("not-evaluated");
    expect(judgeEntry(law("W-01"), "ts-library", [reading("pass"), reading("pass")]).verdict).toBe(
      "pass",
    );
  });

  it("a break of a law whose severity is A is ack-missing, not refuse", () => {
    const soft = law("W-09", { severity: "A" });
    expect(judgeEntry(soft, "ts-library", [reading("refuse")]).verdict).toBe("ack-missing");
    expect(judgeEntry(soft, "ts-library", [reading("fail")]).verdict).toBe("fail");
    expect(judgeEntry(soft, "ts-library", [reading("not-evaluated")]).verdict).toBe(
      "not-evaluated",
    );
    expect(judgeEntry(soft, "ts-library", [reading("pass")]).verdict).toBe("pass");
  });

  it("a law that is not required is counted: a break is not-evaluated, and a tool that failed is still fail", () => {
    const later = law("W-03", { judged: false });
    expect(judgeEntry(later, "ts-library", [reading("refuse")])).toMatchObject({
      required: false,
      verdict: "not-evaluated",
    });
    expect(judgeEntry(later, "ts-library", [reading("ack-missing")]).verdict).toBe("not-evaluated");
    expect(judgeEntry(later, "ts-library", [reading("fail")]).verdict).toBe("fail");
  });

  it("a law the class does not map is not required, whatever its tick", () => {
    const other = law("W-18", { classes: ["ts-library"] });
    expect(judgeEntry(other, "node-service", [reading("refuse")])).toMatchObject({
      required: false,
      verdict: "not-evaluated",
    });
  });
});

describe("G4d a tool with no reader is not-evaluated for the law, never a pass", () => {
  it("adds a not-evaluated reading for each tool no reader read, naming the tool", () => {
    const both = law("W-13", {
      rules: [
        { tool: "eslint", name: "a" },
        { tool: "tsc", name: "b" },
      ],
    });
    const given = [reading("pass")];
    const readings = readingsOf(both, given, new Set(["eslint"]));
    expect(readings.map((found) => [found.verdict, found.reason])).toEqual([
      ["pass", undefined],
      ["not-evaluated", "tsc has no reader yet"],
    ]);
  });

  it("says why a law with no tool rules has no reading, by its reader kind", () => {
    const none = (reader: LawEntry["reader"]): string | undefined =>
      readingsOf(law("W-41", { reader, rules: [] }), [], new Set())[0]?.reason;
    expect(none("an")).toBe("W-41 has no reader yet");
    expect(none("tl")).toBe("W-41 has no reader yet");
    expect(none("at")).toBe("judged by attestation, and none is recorded");
    expect(none("tbd")).toBe("no reader is built for it yet");
  });

  it("every tool read: the readings are what the readers gave, and nothing is added", () => {
    const readings = readingsOf(law("W-01"), [reading("pass")], new Set(["eslint"]));
    expect(readings).toEqual([reading("pass")]);
  });
});

describe("G4d each law is a finding of its own, so the counts can be read back", () => {
  it("is tool webtops, rule law/W-NN, with the law's verdict and whether it is required, and no place", () => {
    const judged = judgeEntry(law("W-01"), "ts-library", [reading("pass")]);
    expect(lawFinding(judged)).toEqual({
      tool: "webtops",
      rule: "law/W-01",
      law: "W-01",
      verdict: "pass",
      message: "W-01 pass",
      required: true,
    });
  });

  it("says in a sentence what the readers noted, why it was not evaluated, and how many places are listed", () => {
    const judged = judgeEntry(law("W-01"), "ts-library", [
      reading("refuse", { note: "no-explicit-any 2", findings: [spot, spot] }),
      reading("not-evaluated", { reason: "tsc has no reader yet" }),
    ]);
    expect(sentence(judged)).toBe(
      "W-01 refuse: no-explicit-any 2; tsc has no reader yet; 2 place(s) listed",
    );
  });

  it("carries the places that break the law with the law's verdict and requirement", () => {
    const judged = judgeEntry(law("W-01"), "ts-library", [reading("refuse", { findings: [spot] })]);
    expect(evidenceOf(judged)).toEqual([{ ...spot, verdict: "refuse", required: true }]);
    const later = judgeEntry(law("W-03", { judged: false }), "ts-library", [
      reading("refuse", { findings: [spot] }),
    ]);
    expect(evidenceOf(later)).toEqual([{ ...spot, verdict: "not-evaluated", required: false }]);
  });
});
