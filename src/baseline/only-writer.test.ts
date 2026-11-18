import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(import.meta.dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sources(path) : [path];
  });
}

describe("G9a: webtops baseline is the only writer of the baseline file", () => {
  const code = sources(src).filter(
    (path) =>
      path.endsWith(".ts") && !path.endsWith(".test.ts") && !/test-support|testkit/.test(path),
  );

  it("is the one place the baseline is serialized and written: src/baseline/write.ts", () => {
    const writers = code
      .filter((path) => /canonicalJson|writeBaseline/.test(readFileSync(path, "utf8")))
      .map((path) => relative(src, path))
      .sort();
    expect(writers).toEqual(
      ["baseline/canonical.ts", "baseline/index.ts", "baseline/write.ts", "cli/baseline.ts"].sort(),
    );
  });

  it("leaves every other source file without a write beside a mention of baseline.json", () => {
    const suspects = code
      .filter(
        (path) => !relative(src, path).startsWith("baseline/") && !path.endsWith("cli/baseline.ts"),
      )
      .filter((path) => {
        const text = readFileSync(path, "utf8");
        return /writeFileSync|writeFile\(/.test(text) && /baseline\.json/.test(text);
      })
      .map((path) => relative(src, path));
    expect(suspects).toEqual([]);
  });
});
