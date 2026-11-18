import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { analyze, goldens } from "./test-support.ts";

/**
 * Identity (WEB_TOPS.md 6.7): a function keeps its key and its numbers under edits that are not
 * about it, so a baseline and a survivor ledger can find it again.
 */

const FILES = [
  "../cli/lock.ts",
  "../lock/format.ts",
  "../lock/node.ts",
  "../lock/installed.ts",
  "./walk.ts",
].map((name) => {
  const path = fileURLToPath(new URL(name, import.meta.url));
  return { path: path.slice(path.indexOf("src/")), text: readFileSync(path, "utf8") };
});

const view = (path: string, text: string): string[] =>
  analyze(path, text).records.map(
    (found) => `${found.key} ${String(found.own)} ${String(found.score)}`,
  );

const insertLine = (text: string, at: number, line: string): string => {
  const rows = text.split("\n");
  rows.splice(at % (rows.length + 1), 0, line);
  return rows.join("\n");
};

describe("keys and counts are stable under edits that leave the functions alone", () => {
  const pick = fc.constantFrom(...FILES);

  it("a comment line added anywhere", () => {
    fc.assert(
      fc.property(pick, fc.nat(2000), ({ path, text }, at) => {
        expect(view(path, insertLine(text, at, "// a note"))).toEqual(view(path, text));
      }),
      { numRuns: 60 },
    );
  });

  it("blank lines added anywhere", () => {
    fc.assert(
      fc.property(
        pick,
        fc.nat(2000),
        fc.integer({ min: 1, max: 4 }),
        ({ path, text }, at, count) => {
          expect(view(path, insertLine(text, at, "\n".repeat(count)))).toEqual(view(path, text));
        },
      ),
      { numRuns: 60 },
    );
  });

  it("every line indented a further level", () => {
    for (const { path, text } of FILES) {
      expect(view(path, text.replace(/^(?=.)/gm, "    "))).toEqual(view(path, text));
    }
  });

  it("a statement that has no function, and an import, added at the top", () => {
    for (const { path, text } of FILES) {
      expect(view(path, `import "node:fs";\nconst unrelated = 1;\n${text}`)).toEqual(
        view(path, text),
      );
    }
  });

  it("a named function added at the end: the old keys and numbers stay, one key is new", () => {
    for (const { path, text } of FILES) {
      const before = view(path, text);
      const after = view(
        path,
        `${text}\nfunction addedAtTheEnd(a: number) { return a ? 1 : 2; }\n`,
      );
      expect(after.slice(0, before.length)).toEqual(before);
      expect(after.slice(before.length)).toEqual([`${path}::addedAtTheEnd 2 2`]);
    }
  });

  it("a function renamed is a new key, and its old key is gone", () => {
    const text = "export function oldName(a: number) { return a ? 1 : 2; }\n";
    expect(view("a.ts", text.replace("oldName", "newName"))).toEqual([
      "a.ts::<module> 1 1",
      "a.ts::newName 2 2",
    ]);
  });

  it("a function moved within its file keeps its key", () => {
    const a =
      "export function one() { return 1; }\nexport function two(a: number) { return a ? 1 : 2; }\n";
    const b =
      "export function two(a: number) { return a ? 1 : 2; }\nexport function one() { return 1; }\n";
    expect([...view("a.ts", a)].sort()).toEqual([...view("a.ts", b)].sort());
  });

  it("a function moved to another file is a new key", () => {
    const text = "export function f(a: number) { return a ? 1 : 2; }\n";
    expect(view("a.ts", text)[1]).toBe("a.ts::f 2 2");
    expect(view("b.ts", text)[1]).toBe("b.ts::f 2 2");
  });
});

describe("an anonymous function inserted shifts the ordinals of its own parent only", () => {
  const byName = (name: string) => {
    const golden = goldens().find((found) => found.name === name);
    if (golden === undefined) throw new Error(`no fixture ${name}`);
    return analyze("input.ts", golden.text).records.map((found) => `${found.key} ${found.kind}`);
  };

  it("keeps `other~1` and the module's `<module>~1` where they were", () => {
    const before = byName("anonymous-order");
    const after = byName("anonymous-inserted");
    for (const key of [
      "input.ts::other~1 arrow",
      "input.ts::<module>~1 arrow",
      "input.ts::other function",
    ]) {
      expect(before).toContain(key);
      expect(after).toContain(key);
    }
    expect(before.filter((key) => key.includes("::host~"))).toHaveLength(3);
    expect(after.filter((key) => key.includes("::host~"))).toHaveLength(4);
  });
});
