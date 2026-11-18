import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateReport, type GateReport } from "../config/report.ts";
import { cleanRepos, commit, git, write } from "../diff/test-support.ts";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";
import { realProject } from "../layers/tests/testkit.ts";
import { readBaseline } from "../baseline/read.ts";
import { runBaselineCli } from "./baseline.ts";
import { runCheckCli } from "./check.ts";
import { runGateCli } from "./gate.ts";
import type { Io } from "./io.ts";

/**
 * G9 end to end: a project with legacy debt (a function over the cap that no test runs, and coverage under the floor)
 * adopts the ratchet through the real CLI and the real gate, and is then held to it.
 */

const dirs: string[] = [];

afterEach(() => {
  cleanRepos();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const YAML = `protocol: "0.3.0"
version: "1"
package: fixture
class: ts-library
enforce: ratchet
baseline: .web-tops/baseline.json
gates:
  hygiene: { enabled: false, reason: "the end-to-end test judges the ratchet, not the lint" }
  tests: { runner: vitest, shuffle: false }
  coverage: { lines_floor: 85 }
  crap: { cap: 4 }
  mutation: { enabled: false, reason: "the end-to-end test judges the ratchet, not the mutants", base: main }
layers:
  size_limit: { enabled: false, reason: "the end-to-end test builds nothing" }
  package_exports: { enabled: false, reason: "the end-to-end test publishes nothing" }
laws: { enabled: false, reason: "the end-to-end test judges no law" }
`;

/** Complexity 6 and no test: CRAP 42 against a cap of 4, and lines no test runs. */
const LEGACY = `export function legacy(a: number, b: number): number {
  if (a > 0 && b > 0) {
    return a;
  }
  if (a < 0 || b < 0) {
    return b;
  }
  return a === b ? 0 : a + b;
}
`;

const OK = "export const ok = (n: number): number => n + 1;\n";
const OK_TEST =
  'import { expect, it } from "vitest";\nimport { ok } from "./ok.ts";\nit("ok", () => {\n  expect(ok(1)).toBe(2);\n});\n';

/** Complexity 5 and no test: a new function over the cap. */
const NEWER = `export function newer(a: number, b: number): number {
  if (a > 0 && b > 0) {
    return a;
  }
  return a < 0 || b < 0 ? b : 0;
}
`;

const DEBT_FILES = { "src/legacy.ts": LEGACY, "src/ok.ts": OK, "src/ok.test.ts": OK_TEST };

function adopter(yaml = YAML, files: Readonly<Record<string, string>> = DEBT_FILES): string {
  const { project } = realProject({
    "web-tops.yaml": yaml,
    ".gitignore": "node_modules\n.web-tops/report.json\n.web-tops/out/\n",
    ...files,
  });
  dirs.push(project.dir);
  git(project.dir, "init", "-q", "-b", "main");
  commit(project.dir, "legacy");
  git(project.dir, "switch", "-q", "-c", "adopt");
  return project.dir;
}

function streams(cwd: string): { io: Io; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  return {
    io: {
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
      cwd,
      env: { ...process.env, CI: "" },
    },
    out: () => out,
    err: () => err,
  };
}

async function gate(dir: string, ...args: string[]): Promise<{ code: number; report: GateReport }> {
  const run = streams(dir);
  const code = await runGateCli(args, run.io);
  const read = validateReport(JSON.parse(readFileSync(join(dir, ".web-tops/report.json"), "utf8")));
  if (!read.ok) throw new Error(`the report is not valid: ${JSON.stringify(read.problems)}`);
  return { code, report: read.value };
}

function layerOf(report: GateReport, layer: string): GateReport["layers"][number] | undefined {
  return report.layers.find((item) => item.id === layer);
}

function rulesOf(report: GateReport, layer: string): string[] {
  return report.layers.find((item) => item.id === layer)?.findings.map((item) => item.rule) ?? [];
}

describe("G9 end to end: legacy debt adopts the ratchet, and is held to it", () => {
  it(
    "takes its first baseline from a failing run, then passes, refuses new debt, and does not refuse legacy it touches",
    async () => {
      const dir = adopter();
      const checked = streams(dir);
      const code = await runCheckCli([], checked.io);
      expect(checked.err()).toBe("");
      expect(code).toBe(0);
      expect(checked.out()).toContain(
        "no baseline yet: run webtops gate --all --keep-going, then webtops baseline",
      );

      // 1. no baseline yet: the layers judge as hard does, so the legacy debt fails the run
      const first = await gate(dir, "--all", "--keep-going");
      expect(first.code).toBe(1);
      expect(rulesOf(first.report, "crap")).toContain("crap-over-cap");
      expect(rulesOf(first.report, "coverage")).toContain("coverage-below-floor");

      // 2. a baseline is taken from it: the legacy findings stay in it
      const taken = streams(dir);
      expect(await runBaselineCli([], taken.io)).toBe(0);
      expect(taken.out()).toMatch(/^wrote \.web-tops\/baseline\.json: 2 functions, 1 packages/);
      commit(dir, "adopt the ratchet");

      // 3. held to it, with nothing above it, the run passes: no placeholder stands in, and the legacy debt is not judged anew
      const held = await gate(dir);
      expect(held.code).toBe(0);
      expect(rulesOf(held.report, "crap")).not.toContain("crap-over-cap");

      // 4. touching a legacy function over the cap, without making it worse, is not refused
      write(dir, { "src/legacy.ts": `// still legacy\n${LEGACY}` });
      commit(dir, "touch the legacy function");
      expect((await gate(dir)).code).toBe(0);

      // 5. new debt is refused: a new function over the cap, and the coverage it leaves below the baseline
      write(dir, { "src/newer.ts": NEWER });
      commit(dir, "add a function nothing tests");
      const refused = await gate(dir);
      expect(refused.code).toBe(1);
      expect(rulesOf(refused.report, "crap")).toContain("ratchet-crap-new");
      expect(rulesOf(refused.report, "coverage")).toContain("ratchet-coverage-down");

      // 6. take it back out, and the run passes again
      git(dir, "rm", "-q", "src/newer.ts");
      commit(dir, "remove it");
      expect((await gate(dir)).code).toBe(0);
    },
    REAL_TOOL_TIMEOUT * 8,
  );

  it(
    "refuses a first baseline from a run that judged only the diff, naming --all",
    async () => {
      const dir = adopter();
      await gate(dir, "--keep-going");
      const run = streams(dir);
      expect(await runBaselineCli([], run.io)).toBe(2);
      expect(run.err()).toContain("--all");
      expect(existsSync(join(dir, ".web-tops/baseline.json"))).toBe(false);
    },
    REAL_TOOL_TIMEOUT * 3,
  );

  it(
    "refuses a first baseline when the tests failed: a baseline holds debt, not a broken suite",
    async () => {
      const dir = adopter();
      write(dir, { "src/ok.test.ts": OK_TEST.replace("toBe(2)", "toBe(3)") });
      commit(dir, "break a test");
      const first = await gate(dir, "--all", "--keep-going");
      expect(first.code).toBe(1);
      const run = streams(dir);
      expect(await runBaselineCli([], run.io)).toBe(2);
      expect(run.err()).toContain("what failed is not something a first baseline holds");
      expect(existsSync(join(dir, ".web-tops/baseline.json"))).toBe(false);
    },
    REAL_TOOL_TIMEOUT * 3,
  );
});

const LINT_YAML = YAML.replace(
  / {2}hygiene: .*\n/,
  `  hygiene:
    install: { enabled: false, reason: "the end-to-end test installs nothing" }
    tsc: { enabled: false, reason: "the end-to-end test judges the lint" }
    format: { enabled: false, reason: "the end-to-end test judges the lint" }
    dependency_cruiser: { enabled: false, reason: "the end-to-end test judges the lint" }
    audit: { enabled: false, reason: "the end-to-end test audits nothing" }
    eslint: { config: eslint.config.js }
`,
);

const ESLINT_CONFIG = `import tseslint from "typescript-eslint";
export default [
  { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser }, rules: { "no-var": "error" } },
];
`;

/** `no-var` twice: lint debt that a test covers, so that the lint is all that is wrong with it. */
const OLD = (vars: number): string =>
  `export function old(): number {\n${Array.from({ length: vars }, (_, n) => `  var v${String(n)} = ${String(n)};\n`).join("")}  return 3;\n}\n`;

const OLD_TEST =
  'import { expect, it } from "vitest";\nimport { old } from "./old.ts";\nit("old", () => {\n  expect(old()).toBe(3);\n});\n';

const LINT_FILES = {
  "eslint.config.js": ESLINT_CONFIG,
  "src/old.ts": OLD(2),
  "src/old.test.ts": OLD_TEST,
};

describe("G9-4 end to end: legacy lint adopts the ratchet, and is held at its count", () => {
  it(
    "holds the lint a baseline holds, refuses a rise, and still fails what is not a count",
    async () => {
      const dir = adopter(LINT_YAML, LINT_FILES);

      // no baseline yet: the lint fails the run, and that failure is what a first baseline holds
      const first = await gate(dir, "--all", "--keep-going");
      expect(first.code).toBe(1);
      expect(rulesOf(first.report, "hygiene")).toContain("no-var");
      expect(await runBaselineCli([], streams(dir).io)).toBe(0);
      commit(dir, "adopt the ratchet");
      const read = readBaseline(dir, ".web-tops/baseline.json");
      expect(read.ok && read.baseline.findings).toEqual({ "no-var": { "src/old.ts": 2 } });

      // held: the same lint passes, each finding still in the report, and the count is still the baseline's
      const held = await gate(dir);
      expect(held.code).toBe(0);
      expect(layerOf(held.report, "hygiene")?.verdict).toBe("pass");
      expect(rulesOf(held.report, "hygiene")).toEqual(
        expect.arrayContaining(["no-var", "ratchet-held"]),
      );

      // fewer findings than the baseline holds pass
      write(dir, { "src/old.ts": OLD(1) });
      commit(dir, "fix one");
      expect((await gate(dir)).code).toBe(0);

      // more of the same rule in the same file is refused
      write(dir, { "src/old.ts": OLD(3) });
      commit(dir, "one more");
      const more = await gate(dir);
      expect(more.code).toBe(1);
      expect(rulesOf(more.report, "hygiene")).toContain("ratchet-findings-up");

      // so is the same rule in a new file
      write(dir, { "src/old.ts": OLD(2), "src/fresh.ts": OLD(1).replace("old", "fresh") });
      commit(dir, "a new file with lint");
      const fresh = await gate(dir);
      expect(fresh.code).toBe(1);
      expect(rulesOf(fresh.report, "hygiene")).toContain("ratchet-findings-up");

      // a failure that is not a count still fails: ESLint cannot load its config
      git(dir, "rm", "-q", "-f", "src/fresh.ts");
      write(dir, { "eslint.config.js": 'throw new Error("broken config");\n' });
      commit(dir, "break the lint config");
      const broken = await gate(dir);
      expect(broken.code).toBe(1);
      expect(layerOf(broken.report, "hygiene")?.verdict).toBe("fail");
      expect(rulesOf(broken.report, "hygiene")).not.toContain("ratchet-held");
    },
    REAL_TOOL_TIMEOUT * 10,
  );
});
