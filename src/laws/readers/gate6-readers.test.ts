import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { bytesReader, routeBytesReader } from "./bytes.ts";
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
  const w29Static = lawOf("W-29", [{ tool: "bytes", name: "page-js-bytes" }]);
  const w29Route = lawOf("W-29", [{ tool: "route-bytes", name: "route-js-bytes" }]);

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

  it("LAC-1: refuses W-29 breaks across bytesReader and routeBytesReader even under a held ratchet", async () => {
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
