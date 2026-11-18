import { describe, expect, it } from "vitest";
import { parseLedger } from "./ledger.ts";
import { CLAMP_KEY, SUM_KEY, entryYaml, ledgerYaml } from "./test-support.ts";

const problemsOf = (source: string): readonly [string, string][] => {
  const parsed = parseLedger(source);
  return parsed.ok
    ? []
    : parsed.problems.map((found): [string, string] => [found.pointer, found.message]);
};

const GOOD = entryYaml(CLAMP_KEY, [
  "reason: boundary is equivalent here",
  "owner: web-platform",
  "expires: 2027-03-31",
]);

describe("parseLedger: a valid ledger", () => {
  it("reads the six key fields beside reason, owner and expires", () => {
    expect(parseLedger(ledgerYaml(GOOD))).toEqual({
      ok: true,
      entries: [
        {
          key: CLAMP_KEY,
          reason: "boundary is equivalent here",
          owner: "web-platform",
          expires: "2027-03-31",
        },
      ],
    });
  });

  it("takes expires as optional", () => {
    const parsed = parseLedger(ledgerYaml(entryYaml(CLAMP_KEY)));
    expect(parsed.ok && parsed.entries[0]?.expires).toBeUndefined();
  });

  it("takes a YAML date written bare as the text it is", () => {
    const parsed = parseLedger(
      ledgerYaml(entryYaml(CLAMP_KEY, ["reason: r", "owner: o", "expires: 2026-12-31"])),
    );
    expect(parsed.ok && parsed.entries[0]?.expires).toBe("2026-12-31");
  });

  it.each([
    [""],
    ["\n\n"],
    ["# only a comment\n"],
    ["version: 1\n"],
    ["version: 1\nsurvivors: []\n"],
    ["---\n"],
  ])("reads %j as an empty ledger", (source) => {
    expect(parseLedger(source)).toEqual({ ok: true, entries: [] });
  });

  it("keeps the spaces at the edges of an original and a replacement, and an empty replacement", () => {
    const key = { ...CLAMP_KEY, original: " < ", replacement: "" };
    const parsed = parseLedger(ledgerYaml(entryYaml(key)));
    expect(parsed.ok && parsed.entries[0]?.key).toEqual(key);
  });

  it("reads CRLF line breaks, and a byte-order mark", () => {
    const source = ledgerYaml(GOOD);
    expect(parseLedger(source.replaceAll("\n", "\r\n")).ok).toBe(true);
    expect(parseLedger(`${String.fromCharCode(0xfeff)}${source}`).ok).toBe(true);
  });

  it("reads many entries in file order", () => {
    const parsed = parseLedger(ledgerYaml(entryYaml(SUM_KEY), GOOD));
    expect(parsed.ok && parsed.entries.map((found) => found.key.file)).toEqual([
      "src/total.ts",
      "src/clamp.ts",
    ]);
  });
});

describe("parseLedger: what is refused, each at its JSON pointer", () => {
  const withMore = (more: readonly string[]): string => ledgerYaml(entryYaml(CLAMP_KEY, more));

  it.each([
    ["no reason", ["owner: o"], "/survivors/0/reason", "reason is missing"],
    ["no owner", ["reason: r"], "/survivors/0/owner", "owner is missing"],
    ["an empty reason", ['reason: ""', "owner: o"], "/survivors/0/reason", "reason is blank"],
    ["a reason of spaces", ['reason: "   "', "owner: o"], "/survivors/0/reason", "reason is blank"],
    ["a blank owner", ["reason: r", 'owner: " "'], "/survivors/0/owner", "owner is blank"],
    [
      "a reason that is a number",
      ["reason: 5", "owner: o"],
      "/survivors/0/reason",
      "reason must be text",
    ],
    [
      "a reason that is a list",
      ["reason: [a]", "owner: o"],
      "/survivors/0/reason",
      "reason must be text",
    ],
  ])("%s", (_name, more, pointer, message) => {
    expect(problemsOf(withMore(more))).toEqual([[pointer, message]]);
  });

  it.each([
    ["2026-02-30"],
    ["2026-13-01"],
    ["soon"],
    ["20261231"],
    ["2026-1-5"],
    ['"2026-12-31T00:00:00Z"'],
  ])("an expires of %s", (bad) => {
    const found = problemsOf(withMore(["reason: r", "owner: o", `expires: ${bad}`]));
    expect(found).toEqual([
      ["/survivors/0/expires", "expires must be a real date written YYYY-MM-DD"],
    ]);
  });

  it.each([["0"], ["1.5"], ['"1"'], ["-2"], ["one"]])("an occurrence of %s", (bad) => {
    const source = ledgerYaml(
      entryYaml({ ...CLAMP_KEY, occurrence: 1 }).replace("occurrence: 1", `occurrence: ${bad}`),
    );
    expect(problemsOf(source)).toEqual([
      ["/survivors/0/occurrence", "occurrence must be a whole number, 1 or more"],
    ]);
  });

  it("a missing occurrence", () => {
    const source = ledgerYaml(entryYaml(CLAMP_KEY).replace("    occurrence: 1\n", ""));
    expect(problemsOf(source)[0]).toEqual([
      "/survivors/0/occurrence",
      "occurrence must be a whole number, 1 or more",
    ]);
  });

  it("an unknown field", () => {
    const found = problemsOf(withMore(["reason: r", "owner: o", "color: red"]));
    expect(found).toEqual([["/survivors/0/color", "color is not a ledger field"]]);
  });

  it("a function that is not in the file", () => {
    const source = ledgerYaml(entryYaml({ ...CLAMP_KEY, function: "src/other.ts::clamp" }));
    expect(problemsOf(source)).toEqual([
      ["/survivors/0/function", 'function must start with "src/clamp.ts::"'],
    ]);
  });

  it("two entries for one key, at the later one", () => {
    expect(problemsOf(ledgerYaml(GOOD, GOOD))).toEqual([
      ["/survivors/1", "duplicates the entry at /survivors/0"],
    ]);
  });

  it("every problem of every entry in one answer", () => {
    const source = ledgerYaml(
      entryYaml(CLAMP_KEY, ["owner: o"]),
      entryYaml(SUM_KEY, ["reason: r"]),
    );
    expect(problemsOf(source).map(([pointer]) => pointer)).toEqual([
      "/survivors/0/reason",
      "/survivors/1/owner",
    ]);
  });

  it("an entry that is not a map", () => {
    expect(problemsOf("version: 1\nsurvivors:\n  - just text\n")).toEqual([
      ["/survivors/0", "an entry must be a map"],
    ]);
  });
});

describe("parseLedger: the file around the entries", () => {
  it.each([
    ["a version other than 1", "version: 2\nsurvivors: []\n", "/version"],
    ["no version in a file that has entries", `survivors:\n${GOOD}\n`, "/version"],
    ["a version that is text", 'version: "1"\nsurvivors: []\n', "/version"],
    ["survivors that is not a list", "version: 1\nsurvivors: {}\n", "/survivors"],
    ["a top-level key it does not know", "version: 1\nextra: 1\n", "/extra"],
  ])("%s", (_name, source, pointer) => {
    expect(problemsOf(source).map(([at]) => at)).toContain(pointer);
  });

  it("a top level that is a list", () => {
    expect(problemsOf("- a\n- b\n")).toEqual([
      ["", "the ledger must be a map with version and survivors"],
    ]);
  });

  it("YAML that does not parse", () => {
    const found = problemsOf("version: 1\nsurvivors: [\n");
    expect(found).toHaveLength(1);
    expect(found[0]?.[0]).toBe("");
  });

  it("a repeated map key", () => {
    expect(problemsOf("version: 1\nversion: 1\n")[0]?.[1]).toContain("unique");
  });

  it("an alias, which could hide a repeated entry", () => {
    const source = `version: 1\nsurvivors:\n${GOOD.replace("  - file:", "  - &a file:")}\n  - *a\n`;
    expect(problemsOf(source).some(([, message]) => message.includes("alias"))).toBe(true);
  });

  it("a tag the schema does not know", () => {
    expect(problemsOf("version: 1\nsurvivors: !custom []\n").length).toBeGreaterThan(0);
  });
});
