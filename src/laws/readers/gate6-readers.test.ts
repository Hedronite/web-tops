import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { axeReader } from "./axe.ts";
import { bytesReader, routeBytesReader } from "./bytes.ts";
import { htmlValidateReader } from "./html-validate.ts";
import { inputFor, lawOf } from "./testkit.ts";
import type { LawEntry, LawReader, LawReading } from "./types.ts";

const made: string[] = [];

afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeArtifact(name: string, body: string): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), "wt-g6-readers-"));
  made.push(dir);
  const path = join(dir, "report.json");
  writeFileSync(path, body);
  return { [name]: path };
}

async function readOne(
  reader: LawReader,
  law: LawEntry,
  artifact?: string,
  body?: string,
): Promise<LawReading> {
  const artifacts =
    artifact !== undefined && body !== undefined ? writeArtifact(artifact, body) : {};
  const [reading] = await reader(inputFor([law], { artifacts }));
  if (reading === undefined) throw new Error("expected reading");
  return reading;
}

async function readHeld(
  reader: LawReader,
  law: LawEntry,
  artifact: string,
  body: string,
): Promise<LawReading> {
  const artifacts = writeArtifact(artifact, body);
  const [reading] = await reader(inputFor([law], { artifacts, held: true }));
  if (reading === undefined) throw new Error("expected reading");
  return reading;
}

describe("Gate 6 law readers edge cases", () => {
  const w20 = lawOf("W-20", [{ tool: "html-validate", name: "html-validate" }]);
  const w21 = lawOf("W-21", [{ tool: "axe", name: "axe" }]);
  const w44 = lawOf("W-44", [{ tool: "axe", name: "target-size" }]);
  const w29Static = lawOf("W-29", [{ tool: "bytes", name: "page-js-bytes" }]);
  const w29Route = lawOf("W-29", [{ tool: "route-bytes", name: "route-js-bytes" }]);

  it("htmlValidateReader rejects missing, malformed JSON, wrong shapes, and 0-page reports with exact reasons", async () => {
    const missing = await readOne(htmlValidateReader, w20);
    expect(missing).toMatchObject({
      verdict: "not-evaluated",
      reason:
        "the html-report artifact of gate 6 is missing or is not a valid html-validate JSON report",
    });
    expect((await readOne(htmlValidateReader, w20, "html-report", "{not-json")).verdict).toBe(
      "not-evaluated",
    );
    expect((await readOne(htmlValidateReader, w20, "html-report", '{"pages":1}')).verdict).toBe(
      "not-evaluated",
    );
    expect(
      await readOne(htmlValidateReader, w20, "html-report", '{"pages":0,"findings":[]}'),
    ).toMatchObject({
      verdict: "not-evaluated",
      reason: "no HTML pages were validated in html-report",
    });
  });

  it("htmlValidateReader emits exact findings with and without line numbers", async () => {
    const payload = JSON.stringify({
      version: 1,
      pages: 1,
      findings: [
        { law: "W-22", rule: "a11y", message: "other-law", file: "dist/a.html", line: 2 },
        { law: "W-20", rule: 42 },
        { law: "W-20", rule: "bad", message: "m", file: "dist/a.html", line: 0 },
        { law: "W-20", rule: "void", message: "m2", file: "dist/b.html", line: 1 },
      ],
    });
    const partial = await readOne(htmlValidateReader, w20, "html-report", payload);
    expect(partial.verdict).toBe("refuse");
    expect(partial.findings).toEqual([
      { tool: "webtops", rule: "bad", verdict: "refuse", message: "m", file: "dist/a.html" },
      {
        tool: "webtops",
        rule: "void",
        verdict: "refuse",
        message: "m2",
        file: "dist/b.html",
        line: 1,
      },
    ]);
  });

  it("axeReader rejects missing, bad shapes, 0 routes, and incomplete results with exact reasons", async () => {
    const missing = await readOne(axeReader, w21);
    expect(missing).toMatchObject({
      verdict: "not-evaluated",
      reason: "the axe-report artifact of gate 6 is missing or is not a valid axe JSON report",
    });
    const invalidReason =
      "the axe-report artifact of gate 6 is missing or is not a valid axe JSON report";
    for (const bad of [
      "null",
      "{}",
      '{"violations":[],"incomplete":[]}',
      '{"routes":["/"],"incomplete":[]}',
      '{"routes":["/"],"violations":[]}',
    ]) {
      expect(await readOne(axeReader, w21, "axe-report", bad)).toMatchObject({
        verdict: "not-evaluated",
        reason: invalidReason,
      });
    }

    const zeroRoutes = await readOne(
      axeReader,
      w21,
      "axe-report",
      '{"routes":[],"violations":[],"incomplete":[]}',
    );
    expect(zeroRoutes).toMatchObject({
      verdict: "not-evaluated",
      reason: "no routes were evaluated in axe-report",
    });

    const incomplete = await readOne(
      axeReader,
      w44,
      "axe-report",
      JSON.stringify({ routes: ["/"], violations: [], incomplete: [{ rule: "target-size" }] }),
    );
    expect(incomplete).toMatchObject({
      verdict: "not-evaluated",
      reason: "axe left 1 result(s) incomplete",
    });
  });

  it("axeReader judges minor, moderate, unknown impact, file vs empty file, and malformed selectors", async () => {
    const passPayload = JSON.stringify({
      routes: ["/"],
      violations: [
        { rule: "meta-viewport", impact: "moderate", selector: "meta" },
        { rule: "region", impact: "minor", selector: "main" },
        { rule: "target-size", impact: "serious", selector: "button" },
        { rule: 123, impact: "serious", selector: "img" },
        { rule: "alt", impact: "serious", selector: 99 },
      ],
      incomplete: [{ rule: "target-size" }],
    });
    expect((await readOne(axeReader, w21, "axe-report", passPayload)).verdict).toBe("pass");

    const failPayload = JSON.stringify({
      routes: ["/"],
      violations: [
        { rule: "target-size", selector: "button", file: "dist/index.html" },
        { rule: "color-contrast", impact: "serious", selector: "p", file: "" },
      ],
      incomplete: [],
    });
    const w44Res = await readOne(axeReader, w44, "axe-report", failPayload);
    expect(w44Res.verdict).toBe("refuse");
    expect(w44Res.findings).toEqual([
      {
        tool: "webtops",
        rule: "axe:target-size",
        verdict: "refuse",
        message: "axe target-size at button",
        file: "dist/index.html",
      },
    ]);

    const w21Res = await readOne(axeReader, w21, "axe-report", failPayload);
    expect(w21Res.findings).toEqual([
      {
        tool: "webtops",
        rule: "axe:color-contrast",
        verdict: "refuse",
        message: "axe color-contrast at p",
      },
    ]);
    expect("file" in (w21Res.findings[0] ?? {})).toBe(false);
  });

  it("bytesReader and routeBytesReader report exact reasons, file fields, and byte formatting", async () => {
    expect(await readOne(bytesReader, w29Static)).toMatchObject({
      verdict: "not-evaluated",
      reason: "the bytes-json artifact of gate 6 is missing or is not a report of judged entries",
    });
    expect(await readOne(bytesReader, w29Static, "bytes-json", '{"pages":[]}')).toMatchObject({
      verdict: "not-evaluated",
      reason: "no pages were evaluated in bytes-json",
    });

    const pageFail = await readOne(
      bytesReader,
      w29Static,
      "bytes-json",
      JSON.stringify({
        pages: [
          {
            route: "/x",
            totalBytes: 60000,
            budgetBytes: 51200,
            passed: false,
            file: "dist/x.html",
          },
        ],
      }),
    );
    expect(pageFail.findings).toEqual([
      {
        tool: "webtops",
        rule: "page-js-bytes",
        verdict: "refuse",
        message: "/x: 60000 B exceeds JS budget 51200 B",
        file: "dist/x.html",
      },
    ]);

    const badRoute = await readOne(
      routeBytesReader,
      w29Route,
      "route-bytes-json",
      '{"routes":[{"passed":false,"file":""}]}',
    );
    expect(badRoute.findings).toEqual([
      {
        tool: "webtops",
        rule: "route-js-bytes",
        verdict: "refuse",
        message: "/: ? B exceeds JS budget ? B",
      },
    ]);
    expect("file" in (badRoute.findings[0] ?? {})).toBe(false);
  });

  it("LAC-1: refuses breaks across all 4 Gate 6 readers even under a held ratchet", async () => {
    const htmlRes = await readHeld(
      htmlValidateReader,
      w20,
      "html-report",
      JSON.stringify({
        pages: 1,
        findings: [
          { law: "W-20", rule: "void-style", message: "bad html", file: "dist/index.html" },
        ],
      }),
    );
    expect(htmlRes.verdict).toBe("refuse");
    expect(htmlRes.findings).toHaveLength(1);

    const axeRes = await readHeld(
      axeReader,
      w21,
      "axe-report",
      JSON.stringify({
        routes: ["/"],
        violations: [{ rule: "color-contrast", impact: "serious", selector: "p" }],
        incomplete: [],
      }),
    );
    expect(axeRes.verdict).toBe("refuse");
    expect(axeRes.findings).toHaveLength(1);

    const bytesRes = await readHeld(
      bytesReader,
      w29Static,
      "bytes-json",
      JSON.stringify({
        pages: [{ route: "/", totalBytes: 60000, budgetBytes: 51200, passed: false }],
      }),
    );
    expect(bytesRes.verdict).toBe("refuse");
    expect(bytesRes.findings).toHaveLength(1);

    const routeBytesRes = await readHeld(
      routeBytesReader,
      w29Route,
      "route-bytes-json",
      JSON.stringify({
        routes: [{ route: "/app", totalBytes: 200000, budgetBytes: 174080, passed: false }],
      }),
    );
    expect(routeBytesRes.verdict).toBe("refuse");
    expect(routeBytesRes.findings).toHaveLength(1);
  });

  it.each([
    ["no verdict", "{}"],
    ["a verdict that is not a boolean", '{"passed":"false"}'],
    ["no object", "7"],
  ])("never passes a report with an entry that has %s", async (_name, entry) => {
    const pages = `{"pages":[{"passed":true},${entry}]}`;
    const routes = `{"routes":[{"passed":true},${entry}]}`;
    const readings = [
      await readOne(bytesReader, w29Static, "bytes-json", pages),
      await readOne(routeBytesReader, w29Route, "route-bytes-json", routes),
    ];
    expect(readings.map((reading) => reading.verdict)).toEqual(["not-evaluated", "not-evaluated"]);
  });
});

/** One planted violation per law that only these readers judge (see `planted-coverage.test.ts`). */
const page = (findings: readonly object[]): object => ({ version: 1, pages: 1, findings });
const visit = (violations: readonly object[]): object => ({
  version: 1,
  routes: ["/"],
  violations,
  incomplete: [],
});
const file = "dist/index.html";

const PLANTS = [
  {
    id: "W-20",
    reader: htmlValidateReader,
    law: lawOf("W-20", [{ tool: "html-validate", name: "html-validate" }]),
    artifact: "html-report",
    bad: page([{ law: "W-20", file, line: 2, column: 1, rule: "void-style", message: "bad" }]),
    clean: page([]),
  },
  {
    id: "W-21",
    reader: axeReader,
    law: lawOf("W-21", [{ tool: "axe", name: "axe" }]),
    artifact: "axe-report",
    bad: visit([{ law: "W-21", rule: "color-contrast", impact: "serious", selector: "p", file }]),
    clean: visit([]),
  },
  {
    id: "W-44",
    reader: axeReader,
    law: lawOf("W-44", [{ tool: "axe", name: "target-size" }]),
    artifact: "axe-report",
    bad: visit([{ law: "W-44", rule: "target-size", impact: "serious", selector: "a", file }]),
    clean: visit([]),
  },
];

describe.each(PLANTS)("$id, planted", (plant) => {
  it("refuses its violation, passes its clean twin, and is not evaluated with no report", async () => {
    const readings = [
      await readOne(plant.reader, plant.law, plant.artifact, JSON.stringify(plant.bad)),
      await readOne(plant.reader, plant.law, plant.artifact, JSON.stringify(plant.clean)),
      await readOne(plant.reader, plant.law),
    ];
    expect(readings.map((reading) => [reading.law, reading.verdict])).toEqual([
      [plant.id, "refuse"],
      [plant.id, "pass"],
      [plant.id, "not-evaluated"],
    ]);
  });
});
