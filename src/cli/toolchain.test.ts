import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };

const root = resolve(import.meta.dirname, "../..");

function get(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function readJson(path: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return parsed;
}

describe("G0a: pins exactly as WEB_TOPS.md section 2", () => {
  const pinned: readonly (readonly [string, RegExp])[] = [
    ["typescript", /^6\.0\.3$/],
    ["eslint", /^9\.39\.\d+$/],
    ["typescript-eslint", /^8\.73\.\d+$/],
    ["vitest", /^5\.1\.\d+$/],
    ["@vitest/coverage-v8", /^5\.1\.\d+$/],
  ];

  it.each(pinned)("package.json pins %s to %s", (name, pattern) => {
    expect(pkg.devDependencies).toHaveProperty([name]);
    expect(get(pkg.devDependencies, name)).toMatch(pattern);
  });

  it("every dependency is an exact version, never a range", () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, version] of Object.entries(all)) {
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("the installed versions equal the pins", () => {
    for (const name of ["typescript", "eslint", "typescript-eslint", "vitest", "@vitest/coverage-v8"]) {
      const installed = get(readJson(join(root, "node_modules", name, "package.json")), "version");
      expect(installed, name).toBe(get(pkg.devDependencies, name));
    }
  });

  it("the runtime dependencies are a YAML parser and a JSON Schema validator only", () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["ajv", "yaml"]);
  });

  it("package.json is ESM with install, typecheck, lint and test scripts", () => {
    expect(pkg.type).toBe("module");
    expect(Object.keys(pkg.scripts)).toEqual(expect.arrayContaining(["typecheck", "lint", "test"]));
  });

  it("tsc --showConfig shows every W-04 flag as true", () => {
    const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
    const result = spawnSync(process.execPath, [tsc, "--showConfig", "-p", join(root, "tsconfig.json")], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const parsed: unknown = JSON.parse(result.stdout);
    const options = get(parsed, "compilerOptions");
    for (const flag of [
      "strict",
      "noUncheckedIndexedAccess",
      "exactOptionalPropertyTypes",
      "noImplicitOverride",
      "noFallthroughCasesInSwitch",
      "verbatimModuleSyntax",
      "isolatedModules",
      "erasableSyntaxOnly",
    ]) {
      expect(get(options, flag), flag).toBe(true);
    }
  });
});

const lawRules: readonly (readonly [string, readonly string[]])[] = [
  [
    "W-01",
    [
      "@typescript-eslint/no-explicit-any",
      "@typescript-eslint/no-unsafe-assignment",
      "@typescript-eslint/no-unsafe-member-access",
      "@typescript-eslint/no-unsafe-call",
      "@typescript-eslint/no-unsafe-return",
      "@typescript-eslint/no-unsafe-argument",
    ],
  ],
  ["W-02", ["@typescript-eslint/consistent-type-assertions", "@typescript-eslint/no-non-null-assertion"]],
  ["W-10", ["@typescript-eslint/switch-exhaustiveness-check"]],
  [
    "W-11",
    [
      "@typescript-eslint/no-floating-promises",
      "@typescript-eslint/no-misused-promises",
      "@typescript-eslint/await-thenable",
    ],
  ],
  ["W-13", ["@typescript-eslint/use-unknown-in-catch-callback-variable"]],
  ["W-14", ["@typescript-eslint/only-throw-error", "@typescript-eslint/prefer-promise-reject-errors"]],
  ["W-15", ["@typescript-eslint/consistent-type-imports"]],
  [
    "W-35",
    [
      "@typescript-eslint/ban-ts-comment",
      "@eslint-community/eslint-comments/require-description",
      "@eslint-community/eslint-comments/no-unlimited-disable",
    ],
  ],
];

const vitestRules = ["vitest/no-focused-tests", "vitest/no-disabled-tests"];

function severity(rules: unknown, id: string): unknown {
  const entry = get(rules, id);
  return typeof entry === "object" ? get(entry, "0") : entry;
}

async function printConfig(file: string): Promise<unknown> {
  const eslint = new ESLint({ cwd: root });
  const config: unknown = await eslint.calculateConfigForFile(join(root, file));
  return config;
}

describe("G0b: lint enables the rule behind every judged ts-library law, at error", () => {
  it.each(lawRules)("%s", async (_law, ids) => {
    const rules = get(await printConfig("src/cli/main.ts"), "rules");
    for (const id of ids) {
      expect([2, "error"], id).toContain(severity(rules, id));
    }
  });

  it("W-34 on test files", async () => {
    const rules = get(await printConfig("src/cli/main.test.ts"), "rules");
    for (const id of vitestRules) {
      expect([2, "error"], id).toContain(severity(rules, id));
    }
  });

  it("W-02 allows no assertion style but as const", async () => {
    const rules = get(await printConfig("src/cli/main.ts"), "rules");
    const options = get(get(rules, "@typescript-eslint/consistent-type-assertions"), "1");
    expect(get(options, "assertionStyle")).toBe("never");
  });

  it("W-35 bans @ts-ignore and @ts-nocheck and wants a reason on @ts-expect-error", async () => {
    const rules = get(await printConfig("src/cli/main.ts"), "rules");
    const options = get(get(rules, "@typescript-eslint/ban-ts-comment"), "1");
    expect(get(options, "ts-ignore")).toBe(true);
    expect(get(options, "ts-nocheck")).toBe(true);
    expect(get(options, "ts-expect-error")).toBe("allow-with-description");
  });

  it("W-35 reports unused disable directives as errors", async () => {
    const linterOptions = get(await printConfig("src/cli/main.ts"), "linterOptions");
    expect([2, "error"]).toContain(get(linterOptions, "reportUnusedDisableDirectives"));
  });
});
