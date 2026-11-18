import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { astroParts } from "./astro.ts";
import { analyzeFile, functionAt } from "./analyze.ts";
import { loadTypeScript } from "./load.ts";
import { analyze, ts } from "./test-support.ts";
import { ComplexityError } from "./types.ts";

const own = (path: string, source: string, key: string): number | undefined =>
  analyze(path, source).records.find((found) => found.key === `${path}::${key}`)?.own;

describe("extensions", () => {
  it.each([".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"])("reads %s as code", (ext) => {
    expect(own(`a${ext}`, "export function f(a) { return a ? 1 : 2; }", "f")).toBe(2);
  });

  it("reads JSX in a .tsx and a .jsx file", () => {
    expect(own("a.tsx", "export const f = (a: number) => <b>{a ? 1 : 2}</b>;", "f")).toBe(2);
    expect(own("a.jsx", "export const f = (a) => <b>{a ? 1 : 2}</b>;", "f")).toBe(2);
  });

  it("is case-insensitive about the extension", () => {
    expect(own("A.TS", "export function f(a) { return a ? 1 : 2; }", "f")).toBe(2);
  });

  it.each([["a.py"], ["a.json"], ["a.css"], ["Makefile"]])(
    "refuses %s, naming the file",
    (path) => {
      expect(() => analyze(path, "x")).toThrow(ComplexityError);
      expect(() => analyze(path, "x")).toThrow(path);
    },
  );
});

describe("a file that is empty or has no function", () => {
  it("is its `<module>` alone, scoring 1", () => {
    const { records } = analyze("a.ts", "");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ key: "a.ts::<module>", own: 1, score: 1 });
    expect(records[0]?.span).toMatchObject({ startLine: 1, endLine: 1 });
  });

  it("ends the module on the last line, not after a final line break", () => {
    expect(analyze("a.ts", "const a = 1;\nconst b = 2;\n").records[0]?.span.endLine).toBe(2);
    expect(analyze("a.ts", "const a = 1;\r\nconst b = 2;").records[0]?.span.endLine).toBe(2);
  });
});

describe("code that does not parse is refused, with its position", () => {
  it("throws ComplexityError with file, line and column", () => {
    const error = (() => {
      try {
        analyze("src/a.ts", "const ok = 1;\nfunction (\n");
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(ComplexityError);
    expect(error instanceof ComplexityError && error.file).toBe("src/a.ts");
    expect(error instanceof ComplexityError && error.line).toBe(2);
    expect(error instanceof Error && error.message).toContain("src/a.ts:2:");
  });

  it("refuses an Astro frontmatter that does not parse, at the file's own line", () => {
    const source = "---\nconst a = 1;\nconst = ;\n---\n<p>x</p>\n";
    expect(() => analyze("a.astro", source)).toThrow("a.astro:3:");
  });

  it("refuses a frontmatter fence that is never closed", () => {
    expect(() => analyze("a.astro", "---\nconst a = 1;\n<p>x</p>\n")).toThrow("never closed");
  });

  it("refuses a `<script>` block that does not parse", () => {
    expect(() => analyze("a.astro", "<script>\nconst = ;\n</script>\n")).toThrow("a.astro:2:");
  });

  it("only reports an Astro template that is not JSX", () => {
    const found = analyze("a.astro", "<div class=card>\n<br>\n{a && b}\n</div>\n");
    expect(found.diagnostics.length).toBeGreaterThan(0);
    expect(found.diagnostics[0]?.line).toBeGreaterThan(0);
    expect(found.records[0]?.own).toBe(2);
  });
});

describe("a TypeScript that does not know a kind the spec counts", () => {
  it("is refused, naming the kind, instead of counting less", () => {
    const lacking = new Proxy(ts, {
      get(target, prop, receiver) {
        if (prop !== "SyntaxKind") {
          const value: unknown = Reflect.get(target, prop, receiver);
          return value;
        }
        return Object.fromEntries(
          Object.entries(ts.SyntaxKind).filter(([name]) => name !== "WhileStatement"),
        );
      },
    });
    expect(() => analyzeFile(lacking, "a.ts", "while (a) {}", { nullishDiscount: true })).toThrow(
      "WhileStatement",
    );
  });
});

describe("functionAt", () => {
  const source = [
    "export function outer(a: number) {", // 1
    "  const cb = (b: number) => (b ? 1 : 0);", // 2
    "  class Local { method() { return 1; } }", // 3
    "  return a;", // 4
    "}", // 5
    "const top = 1;", // 6
  ].join("\n");
  const found = analyze("a.ts", source);
  const at = (needle: string) => functionAt(found, source.indexOf(needle));

  it("gives the innermost function and the scored unit it counts toward", () => {
    expect(at("b ? 1")).toEqual({ innermost: "a.ts::outer.cb", scored: "a.ts::outer" });
  });

  it("gives a class member as its own scored unit, inside a function", () => {
    expect(at("return 1")).toEqual({
      innermost: "a.ts::outer.Local.method",
      scored: "a.ts::outer.Local.method",
    });
  });

  it("gives the function for its own code, and `<module>` for module code", () => {
    expect(at("return a")).toEqual({ innermost: "a.ts::outer", scored: "a.ts::outer" });
    expect(at("const top")).toEqual({ innermost: "a.ts::<module>", scored: "a.ts::<module>" });
  });

  it("gives `<module>` for an offset outside every span, and for a position past the end", () => {
    expect(functionAt(found, 0).innermost).toBe("a.ts::outer");
    expect(functionAt(found, source.length + 50).scored).toBe("a.ts::<module>");
  });
});

describe("astroParts", () => {
  const source =
    "---\nconst a = 1;\n---\n<!-- c -->\n<p>{a}</p>\n<style>p { color: red; }</style>\n<script>\nlet b = 2;\n</script>\n";
  const parts = astroParts(source, "a.astro");

  it("returns frontmatter, each script, then the template, in that order", () => {
    expect(parts.map((part) => part.kind)).toEqual(["frontmatter", "script", "template"]);
  });

  it("keeps every part as long as the file, with the same line breaks", () => {
    for (const part of parts) {
      expect(part.text).toHaveLength(source.length);
      expect(part.text.replace(/[^\n]/g, "")).toBe(source.replace(/[^\n]/g, ""));
    }
  });

  it("hides everything outside the part, and the style, comment, script and frontmatter from the template", () => {
    expect(parts[0]?.text.trim()).toBe("const a = 1;");
    expect(parts[1]?.text.trim()).toBe("let b = 2;");
    expect(parts[2]?.text.trim()).toBe("<p>{a}</p>");
  });

  it("has only a template when there is no frontmatter and no script", () => {
    expect(astroParts("<p>{a}</p>", "a.astro").map((part) => part.kind)).toEqual(["template"]);
  });

  it("does not take `---` later in the file for a frontmatter", () => {
    expect(astroParts("<p>x</p>\n---\n", "a.astro").map((part) => part.kind)).toEqual(["template"]);
  });

  it("takes a `---` inside a string on a line of code for code, not a fence", () => {
    const text = "---\nconst a = 'x --- y';\n---\n<p/>\n";
    expect(astroParts(text, "a.astro")[0]?.text.trim()).toBe("const a = 'x --- y';");
  });
});

describe("loadTypeScript", () => {
  it("loads the TypeScript installed under a project", () => {
    const found = loadTypeScript(process.cwd());
    expect(found.version).toBe(ts.version);
    expect(
      analyzeFile(found, "a.ts", "export const a = (b: number) => b || 1;").records[1]?.own,
    ).toBe(2);
  });

  it("throws ComplexityError when the project has none", () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-complexity-"));
    try {
      writeFileSync(join(dir, "package.json"), "{}");
      expect(() => loadTypeScript(dir)).toThrow(ComplexityError);
      mkdirSync(join(dir, "node_modules", "typescript"), { recursive: true });
      writeFileSync(join(dir, "node_modules", "typescript", "index.js"), "module.exports = {};");
      expect(() => loadTypeScript(dir)).toThrow("not installed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
