import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { REAL_TOOL_TIMEOUT } from "./test-support-timeouts.ts";

/** A test that starts a real tool sets its own timeout: the 5 s default flaked on a slow macOS runner. */

const root = resolve(import.meta.dirname, "../..");

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return testFiles(path);
    return path.endsWith(".test.ts") ? [path] : [];
  });
}

function isTestName(expression: ts.Expression): boolean {
  return ts.isIdentifier(expression) && (expression.text === "it" || expression.text === "test");
}

/** `it(...)`, `test(...)`, and the call `it.each(table)(...)` makes. */
function isTestCall(expression: ts.Expression): boolean {
  if (isTestName(expression)) return true;
  return (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    isTestCall(expression.expression.expression)
  );
}

interface RealTest {
  readonly where: string;
  readonly timeout: string | undefined;
}

function testBody(call: ts.CallExpression): ts.Node | undefined {
  return call.arguments.find((item) => ts.isArrowFunction(item) || ts.isFunctionExpression(item));
}

/** A test whose function runs a real process: it hands `realExec` to a layer or a runner. */
function startsRealTool(call: ts.CallExpression, source: ts.SourceFile): boolean {
  return testBody(call)?.getText(source).includes("realExec") === true;
}

function describeTest(call: ts.CallExpression, file: string, source: ts.SourceFile): RealTest {
  const title = call.arguments[0]?.getText(source) ?? "";
  return {
    where: `${relative(root, file)}: ${title}`,
    timeout: call.arguments[2]?.getText(source),
  };
}

function realTestOf(node: ts.Node, file: string, source: ts.SourceFile): RealTest | undefined {
  if (!ts.isCallExpression(node) || !isTestCall(node.expression)) return undefined;
  return startsRealTool(node, source) ? describeTest(node, file, source) : undefined;
}

function realTests(file: string): RealTest[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: RealTest[] = [];
  const visit = (node: ts.Node): void => {
    const real = realTestOf(node, file, source);
    if (real !== undefined) found.push(real);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** What starts a real tool in a src/init test: a process spawn, or a call into ESLint or Prettier. */
const TOOL_TOKENS = [
  "spawnSync",
  "realExec",
  "new ESLint",
  ".lintText(",
  ".lintFiles(",
  ".isPathIgnored(",
  "prettier.check",
  "prettier.format",
];

const mentionsTool = (text: string): boolean => TOOL_TOKENS.some((token) => text.includes(token));

const callsAny = (text: string, names: ReadonlySet<string>): boolean =>
  [...names].some((name) => new RegExp(`\\b${name}\\(`).test(text));

/** Whether code starts a real tool itself, or calls a helper that does. */
const startsTool = (text: string, helpers: ReadonlySet<string>): boolean =>
  mentionsTool(text) || callsAny(text, helpers);

/** Every function declared in the file, nested ones included, by name, with its text. */
function declaredFunctions(source: ts.SourceFile): Map<string, string> {
  const found = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      found.set(node.name.text, node.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The helpers of a test file that start a real tool, directly or through another helper that does. */
function toolHelpers(source: ts.SourceFile): Set<string> {
  const functions = declaredFunctions(source);
  const helpers = new Set<string>();
  for (let round = 0; round < functions.size; round += 1) {
    for (const [name, text] of functions) {
      if (startsTool(text, helpers)) helpers.add(name);
    }
  }
  return helpers;
}

const bodyText = (call: ts.CallExpression, source: ts.SourceFile): string =>
  testBody(call)?.getText(source) ?? "";

function isRealInitTest(
  node: ts.Node,
  helpers: ReadonlySet<string>,
  source: ts.SourceFile,
): node is ts.CallExpression {
  if (!ts.isCallExpression(node) || !isTestCall(node.expression)) return false;
  return startsTool(bodyText(node, source), helpers);
}

/** The init tests of one file that start a real tool: their body spawns or calls ESLint or Prettier, or calls a helper that does. */
function realInitTests(file: string): RealTest[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const helpers = toolHelpers(source);
  const found: RealTest[] = [];
  const visit = (node: ts.Node): void => {
    if (isRealInitTest(node, helpers, source)) found.push(describeTest(node, file, source));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const FOUND = testFiles(join(root, "src/layers")).flatMap(realTests);
const FOUND_INIT = testFiles(join(root, "src/init")).flatMap(realInitTests);

describe("every layers test that starts a real tool sets its own timeout", () => {
  it("finds the tests that hand realExec to a layer", () => {
    expect(FOUND.length).toBeGreaterThan(30);
  });

  it("gives each of them REAL_TOOL_TIMEOUT as its third argument", () => {
    const missing = FOUND.filter((item) => item.timeout !== "REAL_TOOL_TIMEOUT").map(
      (item) => item.where,
    );
    expect(missing).toEqual([]);
  });

  it("is far above Vitest's 5 s default", () => {
    expect(REAL_TOOL_TIMEOUT).toBeGreaterThanOrEqual(30_000);
  });
});

describe("every init test that starts a real tool sets its own timeout", () => {
  it("finds the tests that run ESLint, Prettier, dependency-cruiser or the CLI on generated files", () => {
    expect(FOUND_INIT.length).toBeGreaterThan(10);
    const files = new Set(FOUND_INIT.map((item) => item.where.split(":")[0]));
    expect(files).toContain("src/init/generated.test.ts");
    expect(files).toContain("src/init/check.test.ts");
  });

  it("gives each of them REAL_TOOL_TIMEOUT as its third argument", () => {
    const missing = FOUND_INIT.filter((item) => item.timeout !== "REAL_TOOL_TIMEOUT").map(
      (item) => item.where,
    );
    expect(missing).toEqual([]);
  });

  it("does not count a test that only renders files", () => {
    const names = FOUND_INIT.map((item) => item.where);
    expect(names.some((name) => name.includes("ignores .astro/ and the usual output"))).toBe(false);
    expect(names.some((name) => name.includes("validates and passes the semantic checks"))).toBe(
      false,
    );
  });
});
