import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ackDirectivesIn, allDirectivesIn, directivesIn } from "../census/directives.ts";
import { ackFor, fromLedger, lawProblem } from "./apply.ts";
import type { Ack } from "./apply.ts";
import { ackProblem, parseAck } from "./comment.ts";
import { readAckLedger } from "./ledger.ts";
import type { SeverityOf } from "./severity.ts";

// G8: `// webtops-ack W-NN: reason` and `.web-tops/acks.yaml` (WEB_TOPS.md section 8.1).

const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function project(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-acks-"));
  made.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

describe("parseAck: webtops-ack W-NN: reason", () => {
  it.each([
    [
      "webtops-ack W-28: the hero must paint before hydration",
      "W-28",
      "the hero must paint before hydration",
    ],
    ["webtops-ack W-28:no space after the colon", "W-28", "no space after the colon"],
    ["webtops-ack   W-100 : a three-digit law", "W-100", "a three-digit law"],
    ["  webtops-ack W-28: padded  ", "W-28", "padded"],
    ["webtops-ack W-28: a", "W-28", "a"],
    ["webtops-ack W-28 : a space before the colon", "W-28", "a space before the colon"],
    ["webtops-ack W-28: first line\nsecond line", "W-28", "first line"],
  ])("reads %j", (body, law, reason) => {
    expect(parseAck(body)).toEqual({ ok: true, law, reason });
  });

  it.each([
    "webtops-ack W-28",
    "webtops-ack W-28:",
    "webtops-ack W-28:   ",
    "webtops-ack W-28: ...",
    "webtops-ack W-28: -",
    "webtops-ack  W-28",
    "webtops-ack W-28 :",
    "webtops-ack W-28 : ...",
  ])("gives no reason for %j", (body) => {
    expect(parseAck(body)).toEqual({
      ok: false,
      rule: "ack-no-reason",
      message: "the acknowledgement of W-28 gives no reason: write webtops-ack W-28: <why>",
    });
  });

  it.each([
    "webtops-ack",
    "webtops-ack: because",
    "webtops-ack because",
    "webtops-ack W-2: one digit",
    "webtops-ack w-28: lower case",
    "webtops-ack W-28 because there is no colon",
    "webtops-ack X-28: not a law id",
    "run webtops-ack W-28: why",
    "run webtops-ack W-28",
    "run webtops-ack W-28:",
  ])("is malformed: %j", (body) => {
    expect(parseAck(body)).toEqual({
      ok: false,
      rule: "ack-malformed",
      message: "an acknowledgement reads webtops-ack W-NN: <reason>, and this one does not",
    });
  });

  it("makes no finding of an acknowledgement and a failing one of anything else, at its file and line", () => {
    expect(ackProblem(parseAck("webtops-ack W-28: why"), "src/a.astro", 4)).toEqual([]);
    expect(ackProblem(parseAck("webtops-ack W-28:"), "src/a.astro", 4)).toEqual([
      {
        tool: "webtops",
        rule: "ack-no-reason",
        verdict: "fail",
        message: "the acknowledgement of W-28 gives no reason: write webtops-ack W-28: <why>",
        file: "src/a.astro",
        line: 4,
      },
    ]);
  });
});

describe("directivesIn: the webtops-ack comment in each form", () => {
  const found = (file: string, text: string) =>
    ackDirectivesIn(file, text).map((directive) => `${String(directive.line)}:${directive.body}`);

  it.each([
    ["a.ts", "x();\n// webtops-ack W-01: why\n", "2:webtops-ack W-01: why"],
    ["a.tsx", "/* webtops-ack W-01: why */\n", "1:webtops-ack W-01: why"],
    ["a.css", "\n/* webtops-ack W-26: why */\n", "2:webtops-ack W-26: why"],
    ["a.scss", "// webtops-ack W-26: why\n", "1:webtops-ack W-26: why"],
    ["a.html", "<p></p>\n<!-- webtops-ack W-28: why -->\n", "2:webtops-ack W-28: why"],
    ["a.astro", "---\n// webtops-ack W-31: why\n---\n<p/>\n", "2:webtops-ack W-31: why"],
    [
      "a.astro",
      "---\n---\n<Hero client:load />\n<!-- webtops-ack W-28: why -->\n",
      "4:webtops-ack W-28: why",
    ],
  ])("counts it in %s", (file, text, expected) => {
    expect(found(file, text)).toEqual([expected]);
  });

  it.each([
    ["prose that mentions it", "// we never write webtops-ack here"],
    ["a longer word", "// webtops-acknowledged"],
    ["a string", 'const text = "// webtops-ack W-01: why";'],
  ])("does not count %s", (_name, text) => {
    expect(found("a.ts", text)).toEqual([]);
  });

  it("leaves the acknowledgement out of the suppression directives, and the suppressions out of the acknowledgements", () => {
    const text = "// webtops-ack W-01: why\n// @ts-ignore: why\n";
    expect(directivesIn("a.ts", text).map((directive) => directive.kind)).toEqual(["ts-ignore"]);
    expect(ackDirectivesIn("a.ts", text).map((directive) => directive.kind)).toEqual([
      "webtops-ack",
    ]);
    expect(
      allDirectivesIn("a.ts", text).map((directive) => [directive.kind, directive.line]),
    ).toEqual([
      ["webtops-ack", 1],
      ["ts-ignore", 2],
    ]);
    expect(allDirectivesIn("a.txt", text)).toEqual([]);
  });

  it("keeps the other directives' kind and line, and gives each one its text", () => {
    expect(directivesIn("a.ts", "// @ts-ignore: why\n")).toEqual([
      { kind: "ts-ignore", line: 1, body: "@ts-ignore: why" },
    ]);
  });

  it("keeps the text of a style block's comment and counts its line from the file's top", () => {
    expect(directivesIn("a.html", "<p></p>\n<style>\n/* stylelint-disable */\n</style>\n")).toEqual(
      [{ kind: "stylelint-disable", line: 3, body: "stylelint-disable" }],
    );
  });
});

const LEDGER = [
  "version: 1",
  "acks:",
  "  - law: W-28",
  "    file: src/pages/index.astro",
  "    reason: The hero must paint before hydration.",
  "    owner: web-platform",
  "    expires: 2027-01-31",
  "  - law: W-30",
  "    file: src/pages/about.astro",
  "    reason: A remote image with no known size.",
  "    owner: web-platform",
  "",
].join("\n");

describe("readAckLedger: .web-tops/acks.yaml against schema/acks.schema.json", () => {
  const read = (text: string | undefined) =>
    readAckLedger(
      project(text === undefined ? {} : { ".web-tops/acks.yaml": text }),
      ".web-tops/acks.yaml",
    );

  it("is an empty ledger when there is no file", () => {
    expect(read(undefined)).toEqual({ ok: true, acks: [] });
  });

  it("reads each entry with its law, file, reason, owner and optional expiry", () => {
    expect(read(LEDGER)).toEqual({
      ok: true,
      acks: [
        {
          law: "W-28",
          file: "src/pages/index.astro",
          reason: "The hero must paint before hydration.",
          owner: "web-platform",
          expires: "2027-01-31",
        },
        {
          law: "W-30",
          file: "src/pages/about.astro",
          reason: "A remote image with no known size.",
          owner: "web-platform",
        },
      ],
    });
  });

  it("reads a ledger with no entry", () => {
    expect(read("version: 1\nacks: []\n")).toEqual({ ok: true, acks: [] });
  });

  it.each(["", "\n", "# nothing acknowledged yet\n", "---\n"])(
    "is an empty ledger when the file is empty or only comments: %j",
    (text) => {
      expect(read(text)).toEqual({ ok: true, acks: [] });
    },
  );

  it("is still refused when the file holds a value that is not a ledger", () => {
    expect(read("[]\n")).toMatchObject({ ok: false });
    expect(read("3\n")).toMatchObject({ ok: false });
  });

  const problems = (text: string): string[] => {
    const result = read(text);
    return result.ok ? [] : result.problems.map((item) => `${item.pointer}: ${item.message}`);
  };

  const entry = (fields: string): string =>
    `version: 1\nacks:\n  - law: W-28\n    file: a.astro\n    owner: me\n${fields}`;

  it("fails an entry with no reason", () => {
    const text = "version: 1\nacks:\n  - law: W-28\n    file: a.astro\n    owner: me\n";
    expect(problems(text).join("\n")).toContain("/acks/0/reason");
  });

  it.each(["''", '"   "', '"..."', '"-"'])("fails an entry whose reason is %s", (reason) => {
    expect(problems(entry(`    reason: ${reason}\n`)).join("\n")).toContain("/acks/0/reason");
  });

  it.each([
    [
      "a law that is not a W-NN id",
      entry("    reason: why\n").replace("W-28", "T-04"),
      "/acks/0/law",
    ],
    [
      "an owner that is blank",
      entry("    reason: why\n").replace("owner: me", 'owner: " "'),
      "/acks/0/owner",
    ],
    ["a field the ledger does not have", entry("    reason: why\n    line: 4\n"), "/acks/0/line"],
    ["no version", "acks: []\n", "/version"],
    ["a version this reader does not know", "version: 2\nacks: []\n", "/version"],
    [
      "an expiry that is not a date",
      entry("    reason: why\n    expires: soon\n"),
      "/acks/0/expires",
    ],
    [
      "an expiry that is not a real day",
      entry("    reason: why\n    expires: 2027-02-30\n"),
      "/acks/0/expires",
    ],
  ])("fails %s, at its pointer", (_name, text, pointer) => {
    expect(problems(text).join("\n")).toContain(pointer);
  });

  it("fails a law acknowledged twice for one file", () => {
    const twice = `${entry("    reason: why\n")}  - law: W-28\n    file: a.astro\n    reason: again\n    owner: me\n`;
    expect(problems(twice)).toEqual(["/acks/1: W-28 is acknowledged twice for a.astro"]);
  });

  it("fails YAML that does not parse, with the first line of what the parser says, and one that repeats a key", () => {
    expect(problems("version: [")).toEqual([
      ": Flow sequence in block collection must be sufficiently indented and end with a ] at line 1, column 11:",
    ]);
    expect(problems("version: 1\nversion: 1\nacks: []\n")).not.toEqual([]);
  });

  it("names a day that is no day", () => {
    expect(problems(entry("    reason: why\n    expires: 2027-02-30\n"))).toEqual([
      "/acks/0/expires: expires must be a real date written YYYY-MM-DD",
    ]);
  });

  it.each([".", "..", ""])("refuses %j, which is no file inside the project", (path) => {
    expect(readAckLedger(project({}), path)).toEqual({
      ok: false,
      problems: [{ pointer: "", message: `ledger "${path}" must name a file inside the project` }],
    });
  });

  it("refuses a file the kit must not overwrite", () => {
    expect(readAckLedger(project({}), "web-tops.yaml")).toEqual({
      ok: false,
      problems: [
        {
          pointer: "",
          message:
            'ledger "web-tops.yaml" names a file the kit must not overwrite (web-tops.yaml, web-tops.lock, package.json)',
        },
      ],
    });
  });

  it("refuses a path that leaves the project", () => {
    const dir = project({});
    expect(readAckLedger(dir, "../acks.yaml")).toEqual({
      ok: false,
      problems: [
        { pointer: "", message: 'ledger "../acks.yaml" must name a file inside the project' },
      ],
    });
  });
});

/** Soft laws W-28 and W-30, the hard law W-04, and no other id. */
const SEVERITY: SeverityOf = (law) =>
  new Map<string, "R" | "A">([
    ["W-28", "A"],
    ["W-30", "A"],
    ["W-04", "R"],
  ]).get(law);

describe("ackFor: which acknowledgement turns ack-missing into pass", () => {
  const comment: Ack = { source: "comment", law: "W-28", file: "a.astro", line: 4, reason: "why" };
  const ledger: Ack = fromLedger({
    law: "W-30",
    file: "b.astro",
    reason: "because",
    owner: "me",
    expires: "2027-01-31",
  });
  const today = "2027-01-31";

  it("accepts a comment on the finding's line, and on the line above it", () => {
    expect(ackFor([comment], "W-28", "a.astro", 4, today, SEVERITY)).toEqual({
      source: "comment",
      reason: "why",
    });
    expect(ackFor([comment], "W-28", "a.astro", 5, today, SEVERITY)).toEqual({
      source: "comment",
      reason: "why",
    });
  });

  it.each([
    ["two lines above", "W-28", "a.astro", 6],
    ["a line below", "W-28", "a.astro", 3],
    ["no line", "W-28", "a.astro", undefined],
    ["another law", "W-30", "a.astro", 4],
    ["another file", "W-28", "b.astro", 4],
  ])("does not accept a comment for a finding with %s", (_name, law, file, line) => {
    expect(ackFor([comment], law, file, line, today, SEVERITY)).toBeUndefined();
  });

  it("accepts a ledger entry for any line of its file, with or without one, through the day it expires", () => {
    expect(ackFor([ledger], "W-30", "b.astro", 99, today, SEVERITY)).toEqual({
      source: "ledger",
      reason: "because",
    });
    expect(ackFor([ledger], "W-30", "b.astro", undefined, today, SEVERITY)).toEqual({
      source: "ledger",
      reason: "because",
    });
  });

  it("accepts nothing from a ledger entry the day after it expires", () => {
    expect(ackFor([ledger], "W-30", "b.astro", 1, "2027-02-01", SEVERITY)).toBeUndefined();
  });

  it("accepts a ledger entry that has no expiry on any day", () => {
    const forever = fromLedger({ law: "W-30", file: "b.astro", reason: "r", owner: "me" });
    expect(forever).toStrictEqual({ source: "ledger", law: "W-30", file: "b.astro", reason: "r" });
    expect(ackFor([forever], "W-30", "b.astro", 1, "2099-12-31", SEVERITY)).toEqual({
      source: "ledger",
      reason: "r",
    });
  });

  it("is nothing when there is no acknowledgement", () => {
    expect(ackFor([], "W-28", "a.astro", 4, today, SEVERITY)).toBeUndefined();
  });

  it("gives nothing for a law that is hard or is no law, whatever the acknowledgement says", () => {
    for (const law of ["W-04", "W-99"]) {
      const comment: Ack = { source: "comment", law, file: "a.astro", line: 4, reason: "why" };
      const ledger: Ack = { source: "ledger", law, file: "a.astro", reason: "why" };
      expect(ackFor([comment], law, "a.astro", 4, today, SEVERITY)).toBeUndefined();
      expect(ackFor([ledger], law, "a.astro", 4, today, SEVERITY)).toBeUndefined();
    }
  });
});

describe("lawProblem: an ack of a law that needs none fails", () => {
  const severities = new Map<string, "R" | "A">([
    ["W-01", "R"],
    ["W-28", "A"],
  ]);
  const severity = (law: string): "R" | "A" | undefined => severities.get(law);

  it("accepts a soft law", () => {
    expect(lawProblem("W-28", severity)).toBeUndefined();
  });

  it("fails a hard law: its break is refused, and no ack turns that into a pass", () => {
    expect(lawProblem("W-01", severity)).toEqual({
      rule: "ack-not-needed",
      message:
        "W-01 is a hard law: a break is refused, and no acknowledgement turns it into a pass",
    });
  });

  it("fails an id that is no law", () => {
    expect(lawProblem("W-99", severity)).toEqual({
      rule: "ack-unknown-law",
      message: "W-99 is not a law",
    });
  });
});
