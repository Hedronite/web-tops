import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROFILES } from "./profiles.ts";

const spec = readFileSync(join(import.meta.dirname, "../../WEB_TOPS.md"), "utf8");
const section52 = spec.slice(spec.indexOf("### 5.2"), spec.indexOf("## 6. Scoring"));
const decisions = spec.slice(spec.indexOf("## 16."), spec.indexOf("## 17."));

function capRow(): number[] {
  const line =
    section52.split("\n").find((candidate) => candidate.startsWith("| CRAP cap |")) ?? "";
  return line
    .split("|")
    .slice(2, -1)
    .map((cell) => Number(cell.trim()));
}

describe("G5c: profiles.ts holds the CRAP cap section 5.2 states, class by class", () => {
  it("has one cap per launch class, in the table's column order", () => {
    expect(capRow()).toEqual(PROFILES.map((profile) => profile.crapCap));
  });

  it.each([
    ["ts-library", 4],
    ["ui-components", 5],
    ["astro-site", 6],
    ["web-app", 6],
    ["node-service", 5],
  ])("%s is %i, as measured in M2.5 and kept", (name, cap) => {
    expect(PROFILES.find((profile) => profile.class === name)?.crapCap).toBe(cap);
  });
});

describe("G5b: section 5.2 and section 16 record the measurement", () => {
  it("says the caps were measured in M2.5 over LuminosiTS and the kit, and kept", () => {
    expect(section52).toMatch(/caps were measured in M2\.5 over LuminosiTS and the kit/);
    expect(section52).toMatch(/and kept/);
    expect(section52).not.toMatch(/caps stay proposed/);
  });

  it("names what was too thin to move: astro-site (6 functions, no coverage) and node-service (none)", () => {
    expect(section52).toMatch(/`astro-site` and `node-service` keep theirs/);
    expect(section52).toMatch(/6 functions, none with coverage/);
  });

  it("states the scored unit and that no rule on changed functions was added", () => {
    expect(section52).toMatch(/callbacks folded into their container/);
    expect(decisions).toMatch(/no rule on changed functions/i);
  });

  it("keeps the floors, survivors and budgets proposed", () => {
    expect(section52).toMatch(/All numbers except the caps are \*\*proposed\*\*/);
  });

  it("records a decision in section 16 under Resolved in M2, with a number no other decision has", () => {
    const group = decisions.slice(decisions.indexOf("**Resolved in M2:**"));
    expect(group).toMatch(/\n\d+\. \*\*CRAP caps from measurement:\*\*/);
    const numbers = [...decisions.matchAll(/^(\d+)\. /gm)].map((match) => match[1]);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
