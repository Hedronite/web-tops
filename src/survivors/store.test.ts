import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { madeDirs, put, tempDir } from "../init/test-support.ts";
import { parseLedger } from "./ledger.ts";
import { readLedger, recordEntry } from "./store.ts";
import { CLAMP_KEY, SUM_KEY, entry, entryYaml, ledgerYaml } from "./test-support.ts";

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

const PATH = ".web-tops/survivors.yaml";
const text = (dir: string, path = PATH): string => readFileSync(join(dir, path), "utf8");
const names = (dir: string): string[] => readdirSync(join(dir, ".web-tops"));

describe("readLedger", () => {
  it("is an empty ledger when there is no file", () => {
    expect(readLedger(tempDir(), PATH)).toEqual({ ok: true, entries: [], text: undefined });
  });

  it("reads the entries and keeps the text", () => {
    const dir = tempDir();
    put(dir, PATH, ledgerYaml(entryYaml(CLAMP_KEY)));
    const read = readLedger(dir, PATH);
    expect(read.ok && read.entries).toHaveLength(1);
    expect(read.ok && read.text).toBe(ledgerYaml(entryYaml(CLAMP_KEY)));
  });

  it("reports the problems of an invalid ledger", () => {
    const dir = tempDir();
    put(dir, PATH, ledgerYaml(entryYaml(CLAMP_KEY, ["owner: o"])));
    const read = readLedger(dir, PATH);
    expect(!read.ok && read.problems[0]?.pointer).toBe("/survivors/0/reason");
  });
});

describe("a path the ledger may not have", () => {
  const refused = (dir: string, path: string): string => {
    const read = readLedger(dir, path);
    return read.ok ? "" : (read.problems[0]?.message ?? "");
  };

  it.each([
    ["../outside.yaml"],
    ["/etc/hosts"],
    [""],
    ["."],
    ["package.json"],
    ["web-tops.yaml"],
    ["web-tops.lock"],
    ["WEB-TOPS.YAML"],
  ])("%j", (path) => {
    const dir = tempDir();
    writeFileSync(join(dir, "package.json"), "{}");
    expect(refused(dir, path)).toContain("ledger");
  });

  it("a directory", () => {
    const dir = tempDir();
    mkdirSync(join(dir, ".web-tops", "survivors.yaml"), { recursive: true });
    expect(refused(dir, PATH)).toContain("not a regular file");
  });

  it("a symbolic link as the file, even one that points inside the project", () => {
    const dir = tempDir();
    put(dir, "real.yaml", "version: 1\n");
    mkdirSync(join(dir, ".web-tops"));
    symlinkSync(join(dir, "real.yaml"), join(dir, PATH));
    expect(refused(dir, PATH)).toContain("symbolic link");
  });

  it("a `.web-tops` that is a symbolic link out of the project", () => {
    const dir = tempDir();
    const elsewhere = tempDir();
    symlinkSync(elsewhere, join(dir, ".web-tops"), "dir");
    expect(refused(dir, PATH)).toContain("leads out of the project");
    expect(recordEntry(dir, PATH, entry(CLAMP_KEY)).ok).toBe(false);
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("a `.web-tops` that is a symbolic link to a directory inside the project is fine", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "state"));
    symlinkSync(join(dir, "state"), join(dir, ".web-tops"), "dir");
    expect(recordEntry(dir, PATH, entry(CLAMP_KEY)).ok).toBe(true);
  });
});

describe("recordEntry", () => {
  it("creates the file, with the header, the version and the one entry", () => {
    const dir = tempDir();
    expect(recordEntry(dir, PATH, entry(CLAMP_KEY, { expires: "2027-03-31" }))).toEqual({
      ok: true,
      replaced: false,
    });
    const written = text(dir);
    expect(written.startsWith("# .web-tops/survivors.yaml")).toBe(true);
    expect(written).toContain("`original` is the exact source text");
    expect(parseLedger(written)).toEqual({
      ok: true,
      entries: [entry(CLAMP_KEY, { expires: "2027-03-31" })],
    });
  });

  it("puts a new entry in sorted place, whatever order they arrive in", () => {
    const dir = tempDir();
    recordEntry(dir, PATH, entry(SUM_KEY));
    recordEntry(dir, PATH, entry(CLAMP_KEY));
    const read = readLedger(dir, PATH);
    expect(read.ok && read.entries.map((found) => found.key.file)).toEqual([
      "src/clamp.ts",
      "src/total.ts",
    ]);
  });

  it("orders occurrences 2 and 10 as numbers", () => {
    const dir = tempDir();
    for (const occurrence of [10, 2, 1])
      recordEntry(dir, PATH, entry({ ...CLAMP_KEY, occurrence }));
    const read = readLedger(dir, PATH);
    expect(read.ok && read.entries.map((found) => found.key.occurrence)).toEqual([1, 2, 10]);
  });

  it("replaces the entry that has the same key and nothing else, and says so", () => {
    const dir = tempDir();
    recordEntry(dir, PATH, entry(CLAMP_KEY));
    recordEntry(dir, PATH, entry(SUM_KEY));
    const result = recordEntry(
      dir,
      PATH,
      entry(CLAMP_KEY, { reason: "changed", owner: "else", expires: "2030-01-01" }),
    );
    expect(result).toEqual({ ok: true, replaced: true });
    const read = readLedger(dir, PATH);
    expect(read.ok && read.entries).toEqual([
      entry(CLAMP_KEY, { reason: "changed", owner: "else", expires: "2030-01-01" }),
      entry(SUM_KEY),
    ]);
  });

  it("is idempotent: recording the same entry again leaves the same bytes", () => {
    const dir = tempDir();
    recordEntry(dir, PATH, entry(CLAMP_KEY, { expires: "2027-01-01" }));
    recordEntry(dir, PATH, entry(SUM_KEY));
    const once = text(dir);
    recordEntry(dir, PATH, entry(CLAMP_KEY, { expires: "2027-01-01" }));
    expect(text(dir)).toBe(once);
  });

  it("keeps the comments of a ledger a person wrote, and the entries it does not touch", () => {
    const dir = tempDir();
    const mine = `# kept\nversion: 1\nsurvivors:\n  # about clamp\n${entryYaml(CLAMP_KEY, ["reason: r", "owner: o"])}\n`;
    put(dir, PATH, mine);
    recordEntry(dir, PATH, entry(SUM_KEY));
    const written = text(dir);
    expect(written).toContain("# kept");
    expect(written).toContain("# about clamp");
    const read = readLedger(dir, PATH);
    expect(read.ok && read.entries.map((found) => found.key.file)).toEqual([
      "src/clamp.ts",
      "src/total.ts",
    ]);
  });

  it("writes into a ledger that holds `survivors: []`", () => {
    const dir = tempDir();
    put(dir, PATH, "version: 1\nsurvivors: []\n");
    expect(recordEntry(dir, PATH, entry(CLAMP_KEY)).ok).toBe(true);
    expect(text(dir)).not.toContain("[]");
  });

  it("writes nothing when the ledger as it stands is invalid, and says why", () => {
    const dir = tempDir();
    const broken = ledgerYaml(entryYaml(CLAMP_KEY, ["owner: o"]));
    put(dir, PATH, broken);
    const result = recordEntry(dir, PATH, entry(SUM_KEY));
    expect(!result.ok && result.message).toContain("reason is missing");
    expect(text(dir)).toBe(broken);
  });

  it("writes nothing for a path it refuses", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "package.json"), "{}");
    expect(recordEntry(dir, "package.json", entry(CLAMP_KEY)).ok).toBe(false);
    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe("{}");
  });

  it("replaces the file by renaming a finished one over it, so a failed write cannot leave half a ledger", () => {
    const dir = tempDir();
    recordEntry(dir, PATH, entry(CLAMP_KEY));
    const before = statSync(join(dir, PATH)).ino;
    recordEntry(dir, PATH, entry(SUM_KEY));
    expect(statSync(join(dir, PATH)).ino).not.toBe(before);
  });

  it("reports a write that fails, and changes nothing", () => {
    const dir = tempDir();
    writeFileSync(join(dir, ".web-tops"), "not a directory");
    const result = recordEntry(dir, PATH, entry(CLAMP_KEY));
    expect(!result.ok && result.message).toContain("could not write");
    expect(readFileSync(join(dir, ".web-tops"), "utf8")).toBe("not a directory");
  });

  it("leaves no temporary file behind", () => {
    const dir = tempDir();
    recordEntry(dir, PATH, entry(CLAMP_KEY));
    recordEntry(dir, PATH, entry(SUM_KEY));
    expect(names(dir)).toEqual(["survivors.yaml"]);
  });

  it("round-trips any text a mutant can hold: quotes, colons, hashes, braces, newlines, wide characters", () => {
    const piece = fc.constantFrom(..."ab 1<>=!&|:#-[]{},\"'\\\n\té\u{1f600}".split(""));
    const some = fc.array(piece, { minLength: 1, maxLength: 24 }).map((chars) => chars.join(""));
    const reason = some.filter((value) => value.trim() !== "");
    fc.assert(
      fc.property(some, some, reason, (original, replacement, why) => {
        const dir = tempDir();
        const written = entry({ ...CLAMP_KEY, original, replacement }, { reason: why });
        recordEntry(dir, PATH, written);
        const read = readLedger(dir, PATH);
        expect(read.ok && read.entries).toEqual([written]);
      }),
      { numRuns: 60 },
    );
  });
});
