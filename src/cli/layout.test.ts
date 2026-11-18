import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const spec = readFileSync(join(root, "WEB_TOPS.md"), "utf8");
const section = spec.slice(spec.indexOf("## 17."), spec.indexOf("## 18."));
const block = section.split("```")[1] ?? "";

const LINE = /^(│ {3})?[├└]── (\S.*?)(?:\s{2,}#.*)?$/;

const namesOf = (text: string): string[] =>
  text.split(" · ").map((name) => name.split("/")[0] ?? "");

/** The entries of the tree block: top-level names, and the children of `src/`. */
function entries(): { top: string[]; src: string[] } {
  const matches = block
    .split("\n")
    .map((line) => LINE.exec(line))
    .filter((match) => match !== null);
  const pick = (nested: boolean): string[] =>
    matches
      .filter((match) => (match[1] !== undefined) === nested)
      .flatMap((match) => namesOf(match[2] ?? ""));
  return { top: pick(false), src: pick(true) };
}

const dirsIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

describe("G10a: section 17 matches the tree", () => {
  const { top, src } = entries();

  it("is not called proposed", () => {
    expect(section).toMatch(/^## 17\. Repository layout\n/);
  });

  it("names a path that exists for every entry of the block", () => {
    expect(top.length).toBeGreaterThan(10);
    for (const name of top) expect(existsSync(join(root, name)), name).toBe(true);
    for (const name of src) expect(existsSync(join(root, "src", name)), `src/${name}`).toBe(true);
  });

  it("lists every directory under src, and every top-level directory the repo tracks", () => {
    expect([...src].sort()).toEqual(dirsIn(join(root, "src")).sort());
    const real = dirsIn(root).filter(
      (name) =>
        !["node_modules", "coverage", "dist", "tmp", ".git", ".web-tops", ".astro"].includes(name),
    );
    for (const name of real) expect(top, name).toContain(name);
  });

  it("says what is not in the tree yet, and none of those paths exists", () => {
    const paragraph =
      section.split("\n").find((line) => line.startsWith("Not yet in the tree")) ?? "";
    const paths = [...paragraph.matchAll(/`([^`]+\/)`/g)].map((match) => match[1] ?? "");
    expect(paths).toEqual(
      expect.arrayContaining([
        "src/crap/",
        "src/budgets/",
        "packages/eslint-plugin-webtops/",
        "laws/",
        "fixtures/lints/",
      ]),
    );
    for (const path of paths) expect(existsSync(join(root, path)), path).toBe(false);
  });
});
