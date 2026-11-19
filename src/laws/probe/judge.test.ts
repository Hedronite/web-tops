import { describe, expect, it } from "vitest";
import { judgeLaw, type LawEvidence } from "./judge.ts";
import type { Expectation, Observed, ProbeLaw, Twin } from "./types.ts";

const LAW: ProbeLaw = { id: "W-99", proofs: ["no-thing", "noImplicitAny"] };
const BAD = "W-99/bad/a.ts";
const CLEAN = "W-99/clean/a.ts";

const twin = (kind: Twin["kind"], file: string): Twin => ({ law: "W-99", kind, file });
const TWINS: readonly Twin[] = [twin("bad", BAD), twin("clean", CLEAN)];

const mark = (line: number, ...rules: string[]): Expectation => ({ file: BAD, line, rules });
const seen = (file: string, line: number, rule: string): Observed => ({ file, line, rule });

/** The good case: the bad twin marks each proof and both fire, and the clean twin is quiet. */
const GOOD: LawEvidence = {
  law: LAW,
  twins: TWINS,
  marks: [mark(1, "no-thing"), mark(2, "noImplicitAny")],
  seen: [seen(BAD, 1, "plugin/no-thing"), seen(BAD, 2, "TS7006")],
};

function kinds(evidence: LawEvidence): string[] {
  return judgeLaw(evidence).failures.map((failure) => failure.kind);
}

describe("G3b the judge: a reader that is silent on its bad twin, or noisy on its clean one, fails the law", () => {
  it("passes when the bad twin fires what it marks and nothing else, and the clean twin is quiet", () => {
    const probe = judgeLaw({
      ...GOOD,
      seen: [seen(BAD, 1, "plugin/no-thing"), seen(BAD, 2, "TS7006")],
    });
    expect(probe).toEqual({ id: "W-99", verdict: "pass", failures: [], unrelated: [] });
  });

  it("a rule that stays quiet on its marked line is silent, and the message says which", () => {
    const probe = judgeLaw({ ...GOOD, seen: [seen(BAD, 2, "TS7006")] });
    expect(probe.verdict).toBe("fail");
    expect(probe.failures).toEqual([
      {
        kind: "silent",
        file: BAD,
        line: 1,
        rule: "no-thing",
        message: "W-99/bad/a.ts:1 stayed quiet: no-thing did not fire on its bad twin",
      },
    ]);
  });

  it("a rule that fires on a different line than its marker is silent there and unexpected where it fired", () => {
    expect(kinds({ ...GOOD, seen: [seen(BAD, 3, "no-thing"), seen(BAD, 2, "TS7006")] })).toEqual([
      "silent",
      "unexpected",
    ]);
  });

  it("a rule of the law that fires on a bad twin line that does not name it is unexpected", () => {
    const probe = judgeLaw({ ...GOOD, seen: [...GOOD.seen, seen(BAD, 4, "other/no-thing")] });
    expect(probe.failures).toEqual([
      {
        kind: "unexpected",
        file: BAD,
        line: 4,
        rule: "other/no-thing",
        message: "W-99/bad/a.ts:4 reports other/no-thing, which no marker on that line names",
      },
    ]);
  });

  it("a rule of the law on a clean twin is noisy", () => {
    const probe = judgeLaw({ ...GOOD, seen: [...GOOD.seen, seen(CLEAN, 7, "no-thing")] });
    expect(probe.failures).toEqual([
      {
        kind: "noisy",
        file: CLEAN,
        line: 7,
        rule: "no-thing",
        message: "W-99/clean/a.ts:7 fired no-thing on its clean twin",
      },
    ]);
  });

  it("a flag counts on a clean twin through its codes", () => {
    expect(kinds({ ...GOOD, seen: [...GOOD.seen, seen(CLEAN, 1, "TS7006")] })).toEqual(["noisy"]);
  });

  it("a twin its tool could not evaluate fails the law, bad or clean, and is not an unrelated finding", () => {
    const clean = seen(CLEAN, 0, "eslint-fatal");
    const bad = seen(BAD, 0, "stylelint-fatal");
    for (const fatal of [clean, bad]) {
      const probe = judgeLaw({ ...GOOD, seen: [...GOOD.seen, fatal] });
      expect(probe.failures.map((failure) => failure.kind)).toEqual(["not-evaluated"]);
      expect(probe.failures[0]?.message).toContain(`${fatal.file} was not evaluated`);
      expect(probe.unrelated).toEqual([]);
    }
  });

  it("a not-evaluated finding on a file that is not the law's twin does not fail it", () => {
    expect(
      kinds({ ...GOOD, seen: [...GOOD.seen, seen("W-98/bad/a.ts", 0, "eslint-fatal")] }),
    ).toEqual([]);
  });

  it("a finding no proof of the law explains is unrelated, and never fails the law", () => {
    const stray = seen(CLEAN, 1, "elsewhere/some-rule");
    const probe = judgeLaw({ ...GOOD, seen: [...GOOD.seen, stray] });
    expect(probe.verdict).toBe("pass");
    expect(probe.unrelated).toEqual([stray]);
  });

  it("a finding that a marker names is not unrelated, though no proof of the law explains it", () => {
    const named: LawEvidence = {
      ...GOOD,
      marks: [mark(1, "no-thing", "elsewhere/some-rule"), mark(2, "noImplicitAny")],
      seen: [...GOOD.seen, seen(BAD, 1, "elsewhere/some-rule")],
    };
    expect(judgeLaw(named)).toMatchObject({ verdict: "pass", unrelated: [] });
  });

  it("a finding on a file of another law is not this law's", () => {
    const other = seen("W-98/bad/a.ts", 1, "no-thing");
    expect(judgeLaw({ ...GOOD, seen: [...GOOD.seen, other] })).toMatchObject({
      verdict: "pass",
      unrelated: [],
    });
  });

  it("a law with no bad twin, or no clean twin, has nothing to prove its reader", () => {
    expect(kinds({ ...GOOD, twins: [twin("clean", CLEAN)] })).toContain("no-bad-twin");
    expect(kinds({ ...GOOD, twins: [twin("bad", BAD)] })).toEqual(["no-clean-twin"]);
    expect(kinds({ ...GOOD, twins: [] })).toEqual(
      expect.arrayContaining(["no-bad-twin", "no-clean-twin"]),
    );
  });

  it("the failure for a missing twin names the directory it belongs in", () => {
    const [failure] = judgeLaw({ ...GOOD, twins: [twin("bad", BAD)] }).failures;
    expect(failure?.message).toBe("W-99 has no clean twin under W-99/clean/");
  });

  it("a bad twin file with no marker proves nothing, unless it only supports the twins beside it", () => {
    const loose = twin("bad", "W-99/bad/b.ts");
    expect(kinds({ ...GOOD, twins: [...TWINS, loose] })).toEqual(["no-marker"]);
    const support = twin("bad", "W-99/bad/_types.ts");
    expect(kinds({ ...GOOD, twins: [...TWINS, support] })).toEqual([]);
  });

  it("a file that only supports a twin is still judged: a finding on it is noisy or unexpected", () => {
    const support = "W-99/bad/_types.ts";
    const evidence = { ...GOOD, twins: [...TWINS, twin("bad", support)] };
    expect(kinds({ ...evidence, seen: [...GOOD.seen, seen(support, 1, "no-thing")] })).toEqual([
      "unexpected",
    ]);
  });

  it("a clean twin that carries a marker is a mistake, whether or not the rule fires", () => {
    const stray: Expectation = { file: CLEAN, line: 1, rules: ["no-thing"] };
    const probe = judgeLaw({ ...GOOD, marks: [...GOOD.marks, stray] });
    expect(probe.failures).toEqual([
      {
        kind: "marker-in-clean",
        file: CLEAN,
        line: 1,
        message: "W-99/clean/a.ts:1 is a clean twin and carries an // expect: marker",
      },
    ]);
  });

  it("a rule the law maps that no bad twin marks is unproven, though the twins are otherwise right", () => {
    const probe = judgeLaw({
      ...GOOD,
      marks: [mark(1, "no-thing")],
      seen: [seen(BAD, 1, "no-thing")],
    });
    expect(probe.failures).toEqual([
      {
        kind: "unproven",
        rule: "noImplicitAny",
        message: "W-99 maps noImplicitAny, and no bad twin proves it fires",
      },
    ]);
  });

  it("a flag is proven by a marker that names its code as well as one that names it", () => {
    const byCode = judgeLaw({ ...GOOD, marks: [mark(1, "no-thing"), mark(2, "TS7006")] });
    expect(byCode.verdict).toBe("pass");
  });

  it("a marker on a clean twin does not prove a rule", () => {
    const onClean: Expectation = { file: CLEAN, line: 1, rules: ["noImplicitAny"] };
    const evidence = { ...GOOD, marks: [mark(1, "no-thing"), onClean] };
    expect(kinds(evidence)).toContain("unproven");
  });

  it("collects every failure of a law, in the order bad twin, clean twin, unproven", () => {
    const evidence: LawEvidence = {
      ...GOOD,
      marks: [mark(1, "no-thing")],
      seen: [seen(CLEAN, 1, "no-thing")],
    };
    expect(kinds(evidence)).toEqual(["silent", "noisy", "unproven"]);
  });
});
