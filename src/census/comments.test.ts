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

describe("scriptComments: the edges of the scan", () => {
  it("reads a line comment at the very end of the text, with no line break after it", () => {
    expect(script("x; // end")).toEqual([[1, " end"]]);
  });

  it.each([
    ["a string", '"abc'],
    ["a single-quoted string", "'abc"],
    ["a template literal", "`abc"],
    ["a template substitution", "`abc ${ x"],
    ["a regular expression", "x = /abc"],
    ["a regular expression class", "x = /[abc"],
  ])(
    "ends %s that is never closed at the end of the text, and reads no comment",
    (_name, source) => {
      expect(script(source)).toEqual([]);
    },
  );

  it("reads a block comment that is never closed to the end, and its body", () => {
    expect(script("/* x")).toEqual([[1, " x"]]);
    expect(script("/*")).toEqual([[1, ""]]);
  });

  it("does not end a block comment at its own star: `/*/` is not a whole comment", () => {
    expect(script("/*/ x */ y(); // real")).toEqual([
      [1, "/ x "],
      [1, " real"],
    ]);
  });

  it("reads a comment right after a block comment, on the same line", () => {
    expect(script("/* a */ // real")).toEqual([
      [1, " a "],
      [1, " real"],
    ]);
    expect(script("/**/ /* b */")).toEqual([
      [1, ""],
      [1, " b "],
    ]);
  });

  it("reads a comment that follows a string, a template or a regular expression with no space", () => {
    expect(script('x = "a"// real')).toEqual([[1, " real"]]);
    expect(script("x = `a`// real")).toEqual([[1, " real"]]);
    expect(script("x = /a/// real")).toEqual([[1, " real"]]);
    expect(script("x = 'a'/* real */")).toEqual([[1, " real "]]);
  });

  it("reads a slash after a string, a template or a regular expression as division", () => {
    expect(script('const a = "x" / 2; // c')).toEqual([[1, " c"]]);
    expect(script("const a = `x` / 2; // c")).toEqual([[1, " c"]]);
    expect(script("const a = /x/ / 2; // c")).toEqual([[1, " c"]]);
  });

  it("forgets a keyword once a value follows it: `return 'a' / 2` divides", () => {
    expect(script('function f() { return "a" / 2; } // c')).toEqual([[1, " c"]]);
  });

  it("reads a regular expression at the very start of the text", () => {
    expect(script("/[//]/.test(x); // real")).toEqual([[1, " real"]]);
    expect(script("return /[//]/.test(x); // real")).toEqual([[1, " real"]]);
  });

  it("counts the line breaks inside a block comment and a string, so the next comment has its line", () => {
    expect(script("/* a\nb\nc */\n// d")).toEqual([
      [1, " a\nb\nc "],
      [4, " d"],
    ]);
    expect(script("x = 'a\\\nb';\n// c")).toEqual([[3, " c"]]);
  });
});

describe("styleComments: the edges", () => {
  const style = (text: string, lineComments: boolean): [number, string][] =>
    styleComments(text, lineComments).map((comment) => [comment.line, comment.body]);

  it("skips a url( whole, with the closing bracket, so a comment right after it is read", () => {
    expect(style("a { b: url(x)/* real */ }", false)).toEqual([[1, " real "]]);
    expect(style("a { b: url(a//b)// real\n}", true)).toEqual([[1, " real"]]);
  });

  it("skips a url( that is never closed to the end of the text", () => {
    expect(style("a { b: url(x /* gone */", false)).toEqual([]);
  });

  it("reads `//` comments only when asked to", () => {
    expect(style("a {} // c", true)).toEqual([[1, " c"]]);
    expect(style("a {} // c", false)).toEqual([]);
  });

  it("reads a block comment that is never closed", () => {
    expect(style("a {} /* open", false)).toEqual([[1, " open"]]);
  });
});

describe("htmlComments: the exact text", () => {
  it("gives the text between the delimiters, untrimmed", () => {
    expect(htmlComments("<!--x-->").map((comment) => comment.body)).toEqual(["x"]);
    expect(htmlComments("<!-- a\n b -->").map((comment) => comment.body)).toEqual([" a\n b "]);
    expect(htmlComments("<!---->").map((comment) => comment.body)).toEqual([""]);
  });
});

describe("scriptComments: template substitutions and regular expressions, in detail", () => {
  it("reads a comment at the very start of a substitution", () => {
    expect(script("`${/* real */ a}`")).toEqual([[1, " real "]]);
  });

  it("closes a substitution at its own brace: nested braces inside it do not end it early", () => {
    expect(script("`${ {a: 1}.a /* real */ }`")).toEqual([[1, " real "]]);
  });

  it("goes back to template text after the substitution closes, so a comment marker there is text", () => {
    expect(script("`${a} /* text */ // text`; // real")).toEqual([[1, " real"]]);
  });

  it("ends the template at the backtick right after a substitution's brace", () => {
    expect(script("`${a}`; // real")).toEqual([[1, " real"]]);
    expect(script("`${a}${b}`; // real")).toEqual([[1, " real"]]);
  });

  it("forgets the word before a value: `x = 'a' in /[//]/` reads the regular expression after `in`", () => {
    expect(script("x = 'a' in /[//]/; // real")).toEqual([[1, " real"]]);
  });

  it("keeps a class open until its closing bracket, whatever it holds", () => {
    expect(script("const r = /[a///]/.test(x); // real")).toEqual([[1, " real"]]);
    expect(script("const r = /[^/]+[/]/.test(x); // real")).toEqual([[1, " real"]]);
  });

  it("reads the flags of a regular expression as ordinary letters", () => {
    expect(script("const r = /a/gi; // real")).toEqual([[1, " real"]]);
    expect(script("const r = /a/gi / 2; // real")).toEqual([[1, " real"]]);
  });

  it("skips a url( and then the string that follows it, not reading the comment marker in the string", () => {
    const found = styleComments("a { b: url(x)'/* no */' } /* real */", false).map(
      (comment) => comment.body,
    );
    expect(found).toEqual([" real "]);
  });
});

describe("styleComments: consecutive url( )", () => {
  it("skips each of two url( ) in a row whole, so the second one's `//` is not a comment", () => {
    const found = styleComments("a { b: url(a)url(http://x) } // real", true).map(
      (comment) => comment.body,
    );
    expect(found).toEqual([" real"]);
  });
});
