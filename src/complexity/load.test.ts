import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ComplexityError, loadTypeScript } from "./index.ts";

/** G4c: loadTypeScript takes the project's own TypeScript, and refuses a module that is not one. */

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A project whose `node_modules/typescript` exports whatever `body` says. */
function projectExporting(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "webtops-load-"));
  dirs.push(dir);
  const home = join(dir, "node_modules", "typescript");
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, "package.json"),
    JSON.stringify({ name: "typescript", main: "index.js" }),
  );
  writeFileSync(join(home, "index.js"), body);
  return dir;
}

describe("G4c loadTypeScript", () => {
  it("returns the TypeScript the project has", () => {
    const ts = loadTypeScript(resolve(import.meta.dirname, "../.."));
    expect(typeof ts.createSourceFile).toBe("function");
  });

  it.each([
    ["a number", "module.exports = 42;"],
    ["null", "module.exports = null;"],
    ["an object without the compiler API", "module.exports = { version: '1' };"],
    [
      "an object whose SyntaxKind is not an object",
      "module.exports = { createSourceFile() {}, forEachChild() {}, isTypeNode() {}, flattenDiagnosticMessageText() {}, SyntaxKind: 1 };",
    ],
  ])("refuses a module that is %s", (_label, body) => {
    expect(() => loadTypeScript(projectExporting(body))).toThrow(ComplexityError);
  });

  it("says where it looked when TypeScript is not installed", () => {
    const dir = mkdtempSync(join(tmpdir(), "webtops-load-"));
    dirs.push(dir);
    expect(() => loadTypeScript(dir)).toThrow(/typescript is not installed under/u);
  });
});
