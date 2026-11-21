import { describe, expect, it } from "vitest";
import { isLinted, isProbe, probePaths, trackedLinted } from "./files.ts";

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
