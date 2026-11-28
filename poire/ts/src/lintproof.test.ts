// The lint proof: the detectors TS-POIRE names fire on the counter-examples in fixtures/lint/, at the
// marked lines, and nothing else fires there. ESLint judges counter.ts under the kit's preset;
// the compiler judges erasable.ts under the kit's strict tsconfig.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ESLint } from "eslint";
import ts from "typescript";
import { expect, it } from "vitest";

const dir = path.join(import.meta.dirname, "..", "fixtures", "lint");

type Findings = Map<number, string[]>;

function add(findings: Findings, line: number, id: string): void {
  findings.set(line, [...(findings.get(line) ?? []), id]);
}

async function markers(file: string): Promise<Findings> {
  const want: Findings = new Map();
  const lines = (await readFile(path.join(dir, file), "utf8")).split("\n");
  // `// want ids` marks its own line. `// want-below ids`, alone on a line, marks the next one,
  // for constructs where the formatter would move an end-of-line comment.
  for (const [index, line] of lines.entries()) {
    const marker = /\/\/ want(-below)? (.+)$/.exec(line);
    const target = marker?.[1] === undefined ? index + 1 : index + 2;
    for (const id of marker?.[2]?.trim().split(/\s+/) ?? []) {
      add(want, target, id);
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

it("every lint counter-example trips its rule, and nothing else fires", async () => {
  const [result] = await new ESLint({ cwd: dir }).lintFiles(["counter.ts"]);
  const got: Findings = new Map();
  for (const message of result?.messages ?? []) {
    add(got, message.line, message.ruleId ?? "(fatal)");
  }
  expect(await compare("counter.ts", got)).toEqual([]);
}, 60_000);

it("every compiler counter-example is refused by the strict tsconfig", async () => {
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
  expect(config?.errors).toEqual([]);
  const program = ts.createProgram({
    rootNames: config?.fileNames ?? [],
    options: config?.options ?? {},
  });
  const file = program.getSourceFile(path.join(dir, "erasable.ts"));
  expect(file).toBeDefined();
  const got: Findings = new Map();
  for (const diagnostic of ts.getPreEmitDiagnostics(program, file)) {
    const line = file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line ?? -1;
    add(got, line + 1, `TS${String(diagnostic.code)}`);
  }
  expect(await compare("erasable.ts", got)).toEqual([]);
}, 60_000);
