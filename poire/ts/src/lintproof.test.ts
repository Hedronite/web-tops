// The lint proof: the detectors TS-POIRE names fire on the counter-examples in fixtures/lint/, at the
// marked lines, and nothing else fires there. ESLint judges counter.ts under the kit's preset;
// the compiler judges erasable.ts under the kit's strict tsconfig.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ESLint, type Linter } from "eslint";
import ts from "typescript";
import { expect, it } from "vitest";

const dir = path.join(import.meta.dirname, "..", "fixtures", "lint");

type Findings = Map<number, string[]>;

function add(findings: Findings, line: number, id: string): void {
  findings.set(line, [...(findings.get(line) ?? []), id]);
}

// `// want ids` marks its own line. `// want-below ids`, alone on a line, marks the next one,
// for constructs where the formatter would move an end-of-line comment.
const MARKER = /\/\/ want(-below)? (.+)$/u;

function markerAt(text: string, index: number): { line: number; ids: string[] } | undefined {
  const marker = MARKER.exec(text);
  if (marker === null) {
    return undefined;
  }
  return {
    line: marker[1] === undefined ? index + 1 : index + 2,
    ids: (marker[2] ?? "").trim().split(/\s+/u),
  };
}

async function markers(file: string): Promise<Findings> {
  const want: Findings = new Map();
  const lines = (await readFile(path.join(dir, file), "utf8")).split("\n");
  for (const { line, ids } of lines.map(markerAt).filter((marker) => marker !== undefined)) {
    for (const id of ids) {
      add(want, line, id);
    }
  }
  return want;
}

function missing(from: Findings, against: Findings, label: string): string[] {
  return [...from].flatMap(([line, ids]) =>
    ids
      .filter((id) => !(against.get(line) ?? []).includes(id))
      .map((id) => `line ${String(line)}: ${label} ${id}`),
  );
}

async function compare(file: string, got: Findings): Promise<string[]> {
  const want = await markers(file);
  expect(want.size).toBeGreaterThan(0);
  return [...missing(want, got, "did not fire:"), ...missing(got, want, "unmarked:")];
}

function lintFindings(messages: readonly Linter.LintMessage[]): Findings {
  const got: Findings = new Map();
  for (const message of messages) {
    add(got, message.line, message.ruleId ?? "(fatal)");
  }
  return got;
}

function strictProgram(): ts.Program {
  const config = ts.getParsedCommandLineOfConfigFile(
    path.join(dir, "tsconfig.json"),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
      },
    },
  );
  if (config === undefined) {
    throw new Error("fixtures/lint/tsconfig.json did not parse");
  }
  expect(config.errors).toEqual([]);
  return ts.createProgram({ rootNames: config.fileNames, options: config.options });
}

function compilerFindings(program: ts.Program, file: ts.SourceFile): Findings {
  const got: Findings = new Map();
  for (const diagnostic of ts.getPreEmitDiagnostics(program, file)) {
    const { line } = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    add(got, line + 1, `TS${String(diagnostic.code)}`);
  }
  return got;
}

it("every lint counter-example trips its rule, and nothing else fires", async () => {
  const [result] = await new ESLint({ cwd: dir }).lintFiles(["counter.ts"]);
  expect(await compare("counter.ts", lintFindings(result?.messages ?? []))).toEqual([]);
}, 60_000);

it("every compiler counter-example is refused by the strict tsconfig", async () => {
  const program = strictProgram();
  const file = program.getSourceFile(path.join(dir, "erasable.ts"));
  if (file === undefined) {
    throw new Error("erasable.ts is not in the fixture project");
  }
  expect(await compare("erasable.ts", compilerFindings(program, file))).toEqual([]);
}, 60_000);
