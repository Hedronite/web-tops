import { describe, expect, it } from "vitest";
import { readKnip } from "./knip.ts";

const unused = (file: string): object => ({ file, files: [{ name: file }] });

describe("readKnip: what the gate leaves in its own folders is no source of the project's", () => {
  it("drops an unused file in .web-tops/out, coverage, dist or node_modules, at any depth, and keeps the rest", () => {
    const issues = [
      "src/real.ts",
      ".web-tops/out/tests/vitest.config.mjs",
      "examples/app/.web-tops/out/tests/coverage/lcov-report/prettify.js",
      "coverage/lcov-report/sorter.js",
      "dist/index.js",
      "node_modules/pkg/index.js",
      "src/coverage-report.ts",
    ].map(unused);
    const files = (readKnip(JSON.stringify({ issues })) ?? []).map((finding) => finding.file);
    expect(files).toEqual(["src/real.ts", "src/coverage-report.ts"]);
  });

  it("keeps a finding whose item is no file, such as a dependency in package.json", () => {
    const text = JSON.stringify({
      issues: [{ file: "package.json", devDependencies: [{ name: "left-pad" }] }],
    });
    expect(readKnip(text)?.map((finding) => finding.message)).toEqual([
      "unused devDependency left-pad",
    ]);
  });
});
