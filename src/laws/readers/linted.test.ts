import { describe, expect, it } from "vitest";
import {
  askedOf,
  isLinted,
  isProbe,
  isScriptBlock,
  probeKind,
  probePaths,
  scriptPaths,
  trackedLinted,
} from "./files.ts";

describe("the files ESLint is asked about", () => {
  it("are the tracked TypeScript and Astro files outside the output and dependency folders", () => {
    const tracked = [
      "src/a.ts",
      "src/b.tsx",
      "src/c.mts",
      "src/d.cts",
      "src/page.astro",
      "src/Page.ASTRO",
      "src/x.js",
      "src/x.css",
      "dist/out.ts",
      "node_modules/p/i.ts",
      "README.md",
    ];
    expect(trackedLinted(tracked)).toEqual([
      "src/a.ts",
      "src/b.tsx",
      "src/c.mts",
      "src/d.cts",
      "src/page.astro",
      "src/Page.ASTRO",
    ]);
  });

  it("know which types are linted", () => {
    expect(["a.ts", "a.tsx", "a.mts", "a.cts", "a.astro"].every(isLinted)).toBe(true);
    expect(["a.js", "a.css", "a.md", "a"].some(isLinted)).toBe(false);
  });
});

describe("the probe paths", () => {
  it("are one for each linted type the project has no file of, under src/, in a fixed order", () => {
    expect(probePaths(["src/a.ts", "src/p.astro"])).toEqual([
      "src/__webtops_probe__.tsx",
      "src/__webtops_probe__.mts",
      "src/__webtops_probe__.cts",
    ]);
    expect(probePaths([])).toEqual([
      "src/__webtops_probe__.ts",
      "src/__webtops_probe__.tsx",
      "src/__webtops_probe__.mts",
      "src/__webtops_probe__.cts",
      "src/__webtops_probe__.astro",
    ]);
    expect(probePaths(["a.ts", "b.tsx", "c.mts", "d.cts", "e.astro"])).toEqual([]);
  });

  it("are told from files by their name", () => {
    expect(isProbe("src/__webtops_probe__.tsx")).toBe(true);
    expect(isProbe("src/probe.tsx")).toBe(false);
  });
});

describe("what ESLint is asked about", () => {
  it("is the tracked files it judges, a probe path for each type the project lacks, and each page's script blocks", () => {
    expect(askedOf(["src/a.ts", "src/p.astro"])).toEqual([
      "src/a.ts",
      "src/p.astro",
      "src/__webtops_probe__.tsx",
      "src/__webtops_probe__.mts",
      "src/__webtops_probe__.cts",
      "src/p.astro/0.ts",
      "src/p.astro/0.js",
    ]);
  });

  it("asks about the script blocks of a probe page when the project has no page", () => {
    expect(askedOf(["src/a.ts"])).toEqual([
      "src/a.ts",
      "src/__webtops_probe__.tsx",
      "src/__webtops_probe__.mts",
      "src/__webtops_probe__.cts",
      "src/__webtops_probe__.astro",
      "src/__webtops_probe__.astro/0.ts",
      "src/__webtops_probe__.astro/0.js",
    ]);
    expect(askedOf([])).toHaveLength(7);
  });

  it("asks about the script blocks of every page, each as TypeScript and as JavaScript", () => {
    const asked = askedOf(["a.ts", "b.tsx", "c.mts", "d.cts", "x/e.astro", "y/F.ASTRO"]);
    expect(asked.slice(6)).toEqual([
      "x/e.astro/0.ts",
      "x/e.astro/0.js",
      "y/F.ASTRO/0.ts",
      "y/F.ASTRO/0.js",
    ]);
  });
});

describe("a page's script blocks", () => {
  it("are paths of the form page.astro/N.ts or page.astro/N.js, and are linted", () => {
    expect(scriptPaths("src/p.astro")).toEqual(["src/p.astro/0.ts", "src/p.astro/0.js"]);
    expect(["src/p.astro/0.ts", "src/p.astro/12.js"].every(isScriptBlock)).toBe(true);
    expect(
      ["src/p.astro", "src/p.astro/x.ts", "src/p.astro/0.css", "src/p.astro/0.tsx"].some(
        isScriptBlock,
      ),
    ).toBe(false);
    expect(["src/p.astro/0.js", "src/p.astro/0.ts"].every(isLinted)).toBe(true);
    expect(isLinted("src/p.js")).toBe(false);
  });

  it("are told apart from the types of file a probe stands for", () => {
    expect(probeKind("src/__webtops_probe__.astro/0.ts")).toEqual({
      one: ".astro script block",
      many: ".astro script blocks",
    });
    expect(probeKind("src/__webtops_probe__.tsx")).toEqual({
      one: ".tsx file",
      many: ".tsx files",
    });
    expect(isProbe("src/__webtops_probe__.astro/0.js")).toBe(true);
  });
});
