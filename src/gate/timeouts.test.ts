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

const FOUND = testFiles(join(root, "src/layers")).flatMap(realTests);

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
