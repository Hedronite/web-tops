import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { analyze, ts } from "./test-support.ts";

/**
 * The differential oracle (plan section 2.2): ESLint's own `complexity` rule, run over this kit's
 * source. ESLint counts everything WEB_TOPS.md 6.3 counts, and also `??`, `?.` and default values; it
 * does not fold nested functions. So with `nullishDiscount: false`, a function's `own` is never more
 * than ESLint's number, and equals it wherever the function has no default value.
 */

const SRC = fileURLToPath(new URL("../", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

const linter = new Linter({ configType: "flat" });
const CONFIG: Linter.Config[] = [
  {
    files: ["**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    rules: { complexity: ["error", { max: 0 }] },
  },
];

function grouped<T>(pairs: readonly (readonly [number, T])[]): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const [line, value] of pairs) out.set(line, [...(out.get(line) ?? []), value]);
  return out;
}

/** The complexity a message states; none for a class field or static block, which are not functions here. */
function complexityOf(message: Linter.LintMessage): number | undefined {
  if (/initializer|static block/i.test(message.message)) return undefined;
  const found = /complexity of (\d+)/.exec(message.message);
  return found?.[1] === undefined ? undefined : Number(found[1]);
}

/** ESLint's complexity of each function, by the line it starts on. */
function eslintByLine(source: string): Map<number, number[]> {
  const messages = linter.verify(source, CONFIG, { filename: "file.ts" });
  return grouped(
    messages.flatMap((message): [number, number][] => {
      const value = complexityOf(message);
      return value === undefined ? [] : [[message.line, value]];
    }),
  );
}

function isDefaulted(node: ts.Node): boolean {
  if (ts.isParameter(node) || ts.isBindingElement(node)) return node.initializer !== undefined;
  return ts.isShorthandPropertyAssignment(node) && node.objectAssignmentInitializer !== undefined;
}

/** True when a default value (parameter, destructuring or assignment pattern) is written anywhere under the node. */
const holdsDefault = (node: ts.Node): boolean =>
  isDefaulted(node) || ts.forEachChild(node, holdsDefault) === true;

/** The lines on which a function that holds a default value starts: ESLint adds one for each, and we do not. */
function defaultLines(source: string): Set<number> {
  const sf = ts.createSourceFile("file.ts", source, ts.ScriptTarget.Latest, true);
  const lines = new Set<number>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && holdsDefault(node)) {
      lines.add(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return lines;
}

interface Tally {
  compared: number;
  equal: number;
  worse: string[];
}

const only = (list: readonly number[] | undefined): number | undefined =>
  list?.length === 1 ? list[0] : undefined;

function oursByLine(path: string, source: string): Map<number, number[]> {
  const records = analyze(path, source, false).records.filter((found) => found.kind !== "module");
  return grouped(records.map((found): [number, number] => [found.span.startLine, found.own]));
}

/** The lines on which both sides have exactly one function: [line, ours, eslint's]. */
function singles(
  ours: Map<number, number[]>,
  theirs: Map<number, number[]>,
): [number, number, number][] {
  return [...ours].flatMap(([line, mine]): [number, number, number][] => {
    const a = only(mine);
    const b = only(theirs.get(line));
    return a === undefined || b === undefined ? [] : [[line, a, b]];
  });
}

function judge(
  path: string,
  tally: Tally,
  withDefault: Set<number>,
  row: [number, number, number],
): void {
  const [line, a, b] = row;
  const where = `${path}:${String(line)} ours ${String(a)}, eslint ${String(b)}`;
  tally.compared += 1;
  if (a > b) tally.worse.push(where);
  if (withDefault.has(line)) return;
  tally.equal += 1;
  if (a !== b) tally.worse.push(where);
}

function compare(path: string, tally: Tally): void {
  const source = readFileSync(path, "utf8");
  const withDefault = defaultLines(source);
  for (const row of singles(oursByLine(path, source), eslintByLine(source))) {
    judge(path, tally, withDefault, row);
  }
}

describe("differential check against ESLint's complexity rule, on this kit's own source", () => {
  const tally: Tally = { compared: 0, equal: 0, worse: [] };
  for (const path of sourceFiles(SRC)) compare(path, tally);

  it("compares a real number of functions, not a vacuous few", () => {
    expect(tally.compared).toBeGreaterThan(500);
    expect(tally.equal).toBeGreaterThan(400);
  });

  it("never counts a function higher than ESLint, and counts it the same where it has no default value", () => {
    expect(tally.worse).toEqual([]);
  });

  it("counts the three constructs ESLint adds only when the discount is off", () => {
    const source = "export function f(a?: { b: number }, c?: number) { return a?.b ?? c; }";
    const eslint = eslintByLine(source).get(1);
    expect(eslint).toEqual([3]);
    expect(analyze("a.ts", source, false).records[1]?.own).toBe(3);
    expect(analyze("a.ts", source, true).records[1]?.own).toBe(1);
  });
});
