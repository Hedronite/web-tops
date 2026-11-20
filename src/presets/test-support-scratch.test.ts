import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ROOT, TSCONFIG, scratchProject } from "./test-support-scratch.ts";

const made: string[] = [];

afterAll(() => {
  expect(made.length).toBeGreaterThan(0);
  for (const dir of made) expect(existsSync(dir), dir).toBe(false);
});

describe("the scratch project helper", () => {
  it("makes a project that reaches the kit as node_modules/web-tops, with the files it is given", () => {
    const dir = scratchProject({ "src/a.ts": "export {};\n" });
    made.push(dir);
    expect(basename(dir)).toMatch(/^wt-preset-/u);
    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe('{ "type": "module" }\n');
    expect(readFileSync(join(dir, "src/a.ts"), "utf8")).toBe("export {};\n");
    expect(lstatSync(join(dir, "node_modules", "web-tops")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(dir, "node_modules", "web-tops", "package.json"))).toBe(true);
    expect(readlinkSync(join(dir, "node_modules", "web-tops"))).toBe(ROOT);
  });

  it("removes each project when its test finishes, even one that holds files", () => {
    made.push(scratchProject({ "deep/er/file.txt": "x" }));
  });

  it("writes a tsconfig that extends the kit's strict one over src", () => {
    expect(JSON.parse(TSCONFIG)).toEqual({
      extends: "web-tops/tsconfig/strict.json",
      compilerOptions: { noEmit: true },
      include: ["src"],
    });
  });
});
