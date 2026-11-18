import { describe, expect, it } from "vitest";
import { htmlComments, scriptComments, styleComments } from "./comments.ts";

const script = (text: string): [number, string][] =>
  scriptComments(text).map((comment) => [comment.line, comment.body]);

describe("scriptComments: what is a comment in JavaScript and TypeScript", () => {
  it("reads a line comment and a block comment, with the line each starts on", () => {
    expect(script("a();\n// one\n/* two */\nb();\n/* three\nfour */")).toEqual([
      [2, " one"],
      [3, " two "],
      [5, " three\nfour "],
    ]);
  });

  it("reads a comment at the end of a code line, and does not read past the line break", () => {
    expect(script("run(); // tail\nnext();")).toEqual([[1, " tail"]]);
  });

  it("reads an unterminated block comment to the end of the text", () => {
    expect(script("x;\n/* never closed\nstill")).toEqual([[2, " never closed\nstill"]]);
  });

  it("does not find a comment marker inside a string", () => {
    expect(script("const a = \"// not\"; const b = '/* not */';")).toEqual([]);
  });

  it("finds the comment after a string, and a string that holds an escaped quote", () => {
    expect(script('const a = "say \\"//\\" now"; // real')).toEqual([[1, " real"]]);
  });

  it("ends a string that is never closed at the end of its line", () => {
    expect(script("const a = 'open\n// real")).toEqual([[2, " real"]]);
  });

  it("does not find a comment marker inside a template literal, and reads one in its substitution", () => {
    expect(script("const a = `// not ${1 /* real */} // not`;")).toEqual([[1, " real "]]);
  });

  it("reads a template literal with a nested template and a brace in its substitution", () => {
    expect(script("const a = `x ${ f({ k: `// no` }) } y`; // yes")).toEqual([[1, " yes"]]);
  });

  it("keeps the line count through a template literal that spans lines", () => {
    expect(script("const a = `one\ntwo\nthree`;\n// after")).toEqual([[4, " after"]]);
  });

  it("does not find a comment marker inside a regular expression", () => {
    expect(script("const r = /\\/\\//; const s = /[/*]/g; // real")).toEqual([[1, " real"]]);
  });

  it("reads a regular expression after return, and after an operator", () => {
    expect(script("function f() { return /a\\/\\/b/.test(x); } // real")).toEqual([[1, " real"]]);
    expect(script("const ok = a && /\\/\\//.test(b); // real")).toEqual([[1, " real"]]);
  });

  it("reads a regular expression after a keyword, whose class holds an unescaped double slash", () => {
    expect(script("function f() { return /[//]/.test(x); } // real")).toEqual([[1, " real"]]);
    expect(script("if (a) { typeof /[/*]/; } /* real */")).toEqual([[1, " real "]]);
  });

  it("reads a character class in a regular expression, which a slash does not end", () => {
    expect(script("const r = /[/]x/; // real")).toEqual([[1, " real"]]);
    expect(script("const r = /[a]/ + /[/]/; // real")).toEqual([[1, " real"]]);
    expect(script("const r = /[///]/; // real")).toEqual([[1, " real"]]);
  });

  it("reads a slash after a name or a bracket as division, so `a / b // c` has its comment", () => {
    expect(script("const x = a / b; // c")).toEqual([[1, " c"]]);
    expect(script("const x = (a) / b; const y = c[0] / d; // c")).toEqual([[1, " c"]]);
  });

  it("ends a regular expression that is never closed at its line", () => {
    expect(script("x = /open\n// real")).toEqual([[2, " real"]]);
  });

  it("reads an empty text, and text with no comment", () => {
    expect(script("")).toEqual([]);
    expect(script("const a = 1;\nconst b = 2;\n")).toEqual([]);
  });

  it("reads a comment on the first line, with no code before it", () => {
    expect(script("// top\ncode();")).toEqual([[1, " top"]]);
  });
});

describe("styleComments", () => {
  const style = (text: string, lineComments: boolean): [number, string][] =>
    styleComments(text, lineComments).map((comment) => [comment.line, comment.body]);

  it("reads block comments, with their lines", () => {
    expect(style("a {}\n/* one */\nb {\n  /* two */\n}", false)).toEqual([
      [2, " one "],
      [4, " two "],
    ]);
  });

  it("does not read `//` in CSS, where it is not a comment", () => {
    expect(style("a { background: url(http://x/y.png); }\n// not", false)).toEqual([]);
  });

  it("reads `//` comments in Sass, SCSS and Less, but not inside url( )", () => {
    expect(style("a { background: url(http://x/y.png); } // yes\n", true)).toEqual([[1, " yes"]]);
  });

  it("does not read a marker inside a string", () => {
    expect(style('a::after { content: "/* no */"; } /* yes */', false)).toEqual([[1, " yes "]]);
  });

  it("reads a url( that is never closed to the end", () => {
    expect(style("a { b: url(oops\n/* gone */", false)).toEqual([]);
  });
});

describe("htmlComments", () => {
  it("reads each `<!-- -->` with its line", () => {
    const found = htmlComments("<p>a</p>\n<!-- one -->\n<p>b</p>\n<!--\n two\n-->");
    expect(found.map((comment) => [comment.line, comment.body.trim()])).toEqual([
      [2, "one"],
      [4, "two"],
    ]);
  });

  it("reads none when there is no comment", () => {
    expect(htmlComments("<p>no comment</p>")).toEqual([]);
  });
});
