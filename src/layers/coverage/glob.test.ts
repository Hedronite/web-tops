import { describe, expect, it } from "vitest";
import { matchesGlob } from "./glob.ts";

/** The globs section 6.1 and `gates.coverage.exclude` use: `**`, `*`, `?`, `{a,b}`, `[abc]` and `?(a|b)`. */

describe("G4c glob: the subset the coverage scope reads", () => {
  it.each([
    ["src/**/*.{ts,tsx}", "src/a.ts", true],
    ["src/**/*.{ts,tsx}", "src/ui/deep/b.tsx", true],
    ["src/**/*.{ts,tsx}", "src/a.js", false],
    ["src/**/*.{ts,tsx}", "lib/a.ts", false],
    ["src/**/*.{ts,tsx}", "other/src/a.ts", false],
    ["src/**/*.{ts,tsx}", "src/a.tsx.map", false],
    ["**/*.d.ts", "src/types.d.ts", true],
    ["**/*.d.ts", "types.d.ts", true],
    ["**/*.d.ts", "src/types.ts", false],
    ["**/*.{test,spec}.?(c|m)[jt]s?(x)", "src/a.test.ts", true],
    ["**/*.{test,spec}.?(c|m)[jt]s?(x)", "src/a.spec.tsx", true],
    ["**/*.{test,spec}.?(c|m)[jt]s?(x)", "src/a.test.mjs", true],
    ["**/*.{test,spec}.?(c|m)[jt]s?(x)", "src/a.test.cts", true],
    ["**/*.{test,spec}.?(c|m)[jt]s?(x)", "src/a.test.py", false],
    ["**/*.{test,spec}.?(c|m)[jt]s?(x)", "src/a.tests.ts", false],
    ["**/__tests__/**", "src/__tests__/x.ts", true],
    ["**/__tests__/**", "src/x.ts", false],
    ["**/node_modules/**", "node_modules/p/i.js", true],
    ["**/*.config.*", "vite.config.ts", true],
    ["**/*.config.*", "src/app.config.ts", true],
    ["**/.*rc.*", ".eslintrc.cjs", true],
    ["**/.*rc.*", "src/.eslintrc.cjs", true],
    ["src/gen/**", "src/gen/g.ts", true],
    ["src/gen/**", "src/gen/deep/g.ts", true],
    ["src/gen/**", "src/generated/g.ts", false],
    ["src/gen/**", "lib/src/gen/g.ts", false],
    ["src/*.ts", "src/a.ts", true],
    ["src/*.ts", "src/deep/a.ts", false],
    ["src/?.ts", "src/a.ts", true],
    ["src/?.ts", "src/ab.ts", false],
    ["src/[ab].ts", "src/a.ts", true],
    ["src/[ab].ts", "src/c.ts", false],
    ["src/a+b.ts", "src/a+b.ts", true],
    ["src/a.ts", "src/aXts", false],
    ["{src,lib}/**/*.ts", "lib/a/b.ts", true],
    ["{src,lib}/**/*.ts", "app/a.ts", false],
  ])("%s on %s is %s", (glob, path, expected) => {
    expect(matchesGlob(path, glob)).toBe(expected);
  });

  it("treats a glob character in a path literally when it is escaped by being a regex special", () => {
    expect(matchesGlob("src/(a).ts", "src/(a).ts")).toBe(true);
    expect(matchesGlob("src/a|b.ts", "src/a|b.ts")).toBe(true);
    expect(matchesGlob("src/aXb.ts", "src/a|b.ts")).toBe(false);
    expect(matchesGlob("src/$a.ts", "src/$a.ts")).toBe(true);
  });

  it("does not treat an unclosed brace or group as a pattern", () => {
    expect(matchesGlob("src/{a.ts", "src/{a.ts")).toBe(true);
    expect(matchesGlob("src/x(a.ts", "src/?(a.ts")).toBe(true);
  });
});
