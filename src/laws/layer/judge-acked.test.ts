import { describe, expect, it } from "vitest";
import type { LawEntry, LawReading } from "../readers/types.ts";
import { evidenceOf, type Judged } from "./judge.ts";

/** The places of a law carry the law's verdict, except a place an acknowledgement covers, which passes and keeps its ack. */

const SOFT: LawEntry = {
  id: "W-12",
  severity: "A",
  reader: "tl",
  classes: [],
  judged: true,
  rules: [{ tool: "eslint", name: "no-await-in-loop" }],
};

const reading: LawReading = {
  law: "W-12",
  verdict: "refuse",
  findings: [
    {
      tool: "eslint",
      rule: "no-await-in-loop",
      verdict: "pass",
      message: "m",
      file: "src/a.ts",
      line: 3,
      ack: { source: "ledger", reason: "Reviewed with the owner." },
    },
    {
      tool: "eslint",
      rule: "no-await-in-loop",
      verdict: "refuse",
      message: "m",
      file: "src/b.ts",
      line: 7,
    },
  ],
};

const judged: Judged = { law: SOFT, required: true, verdict: "ack-missing", readings: [reading] };

describe("evidenceOf with acknowledged places", () => {
  it("keeps the pass and the ack of an acknowledged place, and gives the others the law's verdict", () => {
    const places = evidenceOf(judged);
    expect(places.map((place) => [place.file, place.verdict, place.ack?.source])).toEqual([
      ["src/a.ts", "pass", "ledger"],
      ["src/b.ts", "ack-missing", undefined],
    ]);
  });

  it("marks every place as required or not as the law is", () => {
    expect(evidenceOf(judged).map((place) => place.required)).toEqual([true, true]);
    expect(evidenceOf({ ...judged, required: false }).map((place) => place.required)).toEqual([
      false,
      false,
    ]);
  });
});
