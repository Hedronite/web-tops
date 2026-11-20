import { describe, expect, it } from "vitest";
import type { EslintFacts } from "../../census/eslint.ts";
import { isData, trackedSource, unlinted } from "./files.ts";

describe("G4 file-set completeness", () => {
  it("takes the tracked TypeScript source outside the output and dependency folders", () => {
    const tracked = [
      "src/a.ts",
      "src/b.tsx",
      "c.mts",
      "d.cts",
      "src/e.js",
      "README.md",
      "node_modules/x/y.ts",
      "dist/z.ts",
      "src/page.astro",
    ];
    expect(trackedSource(tracked)).toEqual(["src/a.ts", "src/b.tsx", "c.mts", "d.cts"]);
  });

  it("names a tracked source file that an ignore drops, and one that no config block reaches, with the reason", () => {
    const facts: EslintFacts = {
      ignored: new Map([
        ["scripts/x.ts", true],
        ["src/a.ts", false],
      ]),
      levels: new Map([["src/a.ts", new Map()]]),
    };
    const found = unlinted(["src/a.ts", "scripts/x.ts", "src/lost.mts"], facts);
    expect(found).toEqual([
      {
        tool: "eslint",
        rule: "file-set",
        verdict: "refuse",
        message: "scripts/x.ts is not linted: an ESLint ignore drops it, so no lint law judges it",
        file: "scripts/x.ts",
      },
      {
        tool: "eslint",
        rule: "file-set",
        verdict: "refuse",
        message:
          "src/lost.mts is not linted: no ESLint config block reaches it, so no lint law judges it",
        file: "src/lost.mts",
      },
    ]);
  });

  it("only the data trees of section 17 are exempt, whether ESLint ignores them or not", () => {
    const facts: EslintFacts = {
      ignored: new Map([["fixtures/laws/x.ts", true]]),
      levels: new Map(),
    };
    const source = [
      "fixtures/laws/x.ts",
      "probes/w22/y.tsx",
      "src/fixtures/z.ts",
      "examples/node-service/a.ts",
    ];
    expect(unlinted(source, facts).map((found) => found.file)).toEqual([
      "src/fixtures/z.ts",
      "examples/node-service/a.ts",
    ]);
    expect(isData("fixtures/a.ts") && isData("probes/b.ts")).toBe(true);
    expect(isData("src/fixtures/a.ts") || isData("fixtures-old/a.ts") || isData("probes.ts")).toBe(
      false,
    );
  });
});

describe("G4 file-set completeness: the edges", () => {
  it("a file name that only contains an extension is not source", () => {
    expect(trackedSource(["a.ts.bak", "b.tsx.map", "c.mts.orig", "d.ts"])).toEqual(["d.ts"]);
  });

  it("a file ESLint ignores is named, even when a config block also reached it", () => {
    const facts: EslintFacts = {
      ignored: new Map([["scripts/x.ts", true]]),
      levels: new Map([["scripts/x.ts", new Map()]]),
    };
    const found = unlinted(["scripts/x.ts"], facts);
    expect(found.map((one) => one.message)).toEqual([
      "scripts/x.ts is not linted: an ESLint ignore drops it, so no lint law judges it",
    ]);
  });
});
