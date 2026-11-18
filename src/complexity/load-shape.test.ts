import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTypeScript } from "./load.ts";
import { ComplexityError } from "./types.ts";

describe("loadTypeScript: what counts as TypeScript", () => {
  const withModule = (source: string): string => {
    const dir = mkdtempSync(join(tmpdir(), "wt-complexity-load-"));
    writeFileSync(join(dir, "package.json"), "{}");
    mkdirSync(join(dir, "node_modules", "typescript"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "typescript", "index.js"), source);
    return dir;
  };

  const FUNCTIONS =
    "createSourceFile() {}, forEachChild() {}, isTypeNode() {}, flattenDiagnosticMessageText() {}";

  it("accepts a module that has the four functions and a SyntaxKind", () => {
    const dir = withModule(`module.exports = { ${FUNCTIONS}, SyntaxKind: {} };`);
    try {
      expect(() => loadTypeScript(dir)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ["createSourceFile"],
    ["forEachChild"],
    ["isTypeNode"],
    ["flattenDiagnosticMessageText"],
  ])("refuses a module whose %s is not a function, though the other three are", (name) => {
    const body = FUNCTIONS.split(", ")
      .map((part) => (part.startsWith(name) ? `${name}: 1` : part))
      .join(", ");
    const dir = withModule(`module.exports = { ${body}, SyntaxKind: {} };`);
    try {
      expect(() => loadTypeScript(dir)).toThrow("not installed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a module with the functions and no SyntaxKind object", () => {
    const dir = withModule(`module.exports = { ${FUNCTIONS} };`);
    try {
      expect(() => loadTypeScript(dir)).toThrow("not installed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ComplexityError: its message and its name", () => {
  it("is `file: message` with no position, and `file:line:column: message` with one", () => {
    expect(new ComplexityError("bad", "a.ts").message).toBe("a.ts: bad");
    expect(new ComplexityError("bad", "a.ts", 3, 7).message).toBe("a.ts:3:7: bad");
  });

  it("takes column 1 when only a line is given", () => {
    const error = new ComplexityError("bad", "a.ts", 3);
    expect(error.message).toBe("a.ts:3:1: bad");
    expect(error.column).toBeUndefined();
  });

  it("is named ComplexityError and keeps what it was given", () => {
    const error = new ComplexityError("bad", "a.ts", 3, 7);
    expect(error.name).toBe("ComplexityError");
    expect([error.file, error.line, error.column]).toEqual(["a.ts", 3, 7]);
  });
});
