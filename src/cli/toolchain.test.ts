import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, matchesGlob, resolve } from "node:path";
import { ESLint } from "eslint";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { TOOL_PINS } from "../lock/pins.ts";

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
    ["eslint", /^10\.15\.\d+$/],
    ["@eslint/js", /^10\.0\.\d+$/],
    ["@stryker-mutator/core", /^10\.1\.\d+$/],
    ["@stryker-mutator/vitest-runner", /^10\.1\.\d+$/],
    ["@stryker-mutator/typescript-checker", /^10\.1\.\d+$/],
    ["typescript-eslint", /^8\.73\.\d+$/],
    ["vitest", /^5\.1\.\d+$/],
    ["@vitest/coverage-v8", /^5\.1\.\d+$/],
    ["prettier", /^3\.10\.\d+$/],
    ["fast-check", /^\d+\.\d+\.\d+$/],
  ];

  it.each(pinned)("package.json pins %s to %s", (name, pattern) => {
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).toHaveProperty([name]);
    expect(get({ ...pkg.dependencies, ...pkg.devDependencies }, name)).toMatch(pattern);
  });

  it("every dependency is an exact version, never a range", () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, version] of Object.entries(all)) {
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("the installed versions equal the pins", () => {
    for (const name of [
      "typescript",
      "eslint",
      "typescript-eslint",
      "vitest",
      "@vitest/coverage-v8",
      "prettier",
      "fast-check",
    ]) {
      const installed = get(readJson(join(root, "node_modules", name, "package.json")), "version");
      expect(installed, name).toBe(get({ ...pkg.dependencies, ...pkg.devDependencies }, name));
    }
  });

  it("the runtime dependencies are a JSON Schema validator, the TypeScript compiler API (src/diff reads function spans from the AST) and a YAML parser", () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["ajv", "typescript", "yaml"]);
    expect(pkg.dependencies.typescript).toBe(TOOL_PINS.typescript);
  });

  it("package.json is ESM with install, typecheck, lint, test and format:check scripts", () => {
    expect(pkg.type).toBe("module");
    expect(Object.keys(pkg.scripts)).toEqual(
      expect.arrayContaining(["typecheck", "lint", "test", "format:check"]),
    );
  });

  it("R9: exports, types, bin and files point at files the kit ships", () => {
    const dot = get(pkg.exports, ".");
    for (const target of [
      pkg.main,
      pkg.types,
      get(dot, "types"),
      get(dot, "default"),
      get(pkg.exports, "./schema/web-tops.schema.json"),
      get(pkg.exports, "./schema/gate-report.schema.json"),
      get(pkg.exports, "./schema/core.schema.json"),
      get(pkg.exports, "./schema/baseline.schema.json"),
      get(pkg.exports, "./package.json"),
      pkg.bin.webtops,
    ]) {
      expect(typeof target).toBe("string");
      expect(existsSync(join(root, String(target))), String(target)).toBe(true);
    }
    expect(pkg.files).toEqual(expect.arrayContaining(["src", "schema", "!src/**/*.test.ts"]));
  });
});

// W-04 (WEB_TOPS.md section 8.2) reads every strict flag's resolved value through the `extends`
// chain. `tsc --showConfig` keeps `strict: true` beside a disabled member, so `strict` alone is not
// enough: each member is read, and an unset member of the strict family follows `strict`.
const W04_FLAGS: readonly string[] = [
  "strict",
  "noUncheckedIndexedAccess",
  "exactOptionalPropertyTypes",
  "noImplicitOverride",
  "noFallthroughCasesInSwitch",
  "verbatimModuleSyntax",
  "isolatedModules",
  "erasableSyntaxOnly",
];

const STRICT_FAMILY: readonly string[] = [
  "alwaysStrict",
  "noImplicitAny",
  "noImplicitThis",
  "strictBindCallApply",
  "strictBuiltinIteratorReturn",
  "strictFunctionTypes",
  "strictNullChecks",
  "strictPropertyInitialization",
  "useUnknownInCatchVariables",
];

function resolvedFlag(options: ts.CompilerOptions, flag: string): unknown {
  const own: unknown = Reflect.get(options, flag);
  return own ?? (STRICT_FAMILY.includes(flag) ? options.strict : undefined);
}

/** The W-04 flags and strict-family members that do not resolve to true. */
function flagsNotTrue(tsconfig: string): string[] {
  const read = ts.readConfigFile(tsconfig, (file) => ts.sys.readFile(file));
  const { options } = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(tsconfig));
  return [...W04_FLAGS, ...STRICT_FAMILY].filter((flag) => resolvedFlag(options, flag) !== true);
}

describe("W-04: every strict member resolves to true", () => {
  const made: string[] = [];
  const allOn = Object.fromEntries(W04_FLAGS.map((flag) => [flag, true]));

  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function tsconfigs(files: Readonly<Record<string, unknown>>): string {
    const dir = mkdtempSync(join(tmpdir(), "wt-tsconfig-"));
    made.push(dir);
    for (const [name, compilerOptions] of Object.entries(files)) {
      const extending = name === "tsconfig.json" && "base.json" in files;
      const body = { ...(extending ? { extends: "./base.json" } : {}), compilerOptions };
      writeFileSync(join(dir, name), JSON.stringify(body));
    }
    return join(dir, "tsconfig.json");
  }

  it("holds for the kit's tsconfig.json", () => {
    expect(flagsNotTrue(join(root, "tsconfig.json"))).toEqual([]);
  });

  it("accepts a config that sets every flag and leaves the strict family to strict", () => {
    expect(flagsNotTrue(tsconfigs({ "tsconfig.json": allOn }))).toEqual([]);
  });

  it.each(STRICT_FAMILY)("fails strict: true beside %s: false", (member) => {
    const config = tsconfigs({ "tsconfig.json": { ...allOn, [member]: false } });
    expect(flagsNotTrue(config)).toEqual([member]);
  });

  it.each(W04_FLAGS.slice(1))("fails %s set to false", (flag) => {
    const config = tsconfigs({ "tsconfig.json": { ...allOn, [flag]: false } });
    expect(flagsNotTrue(config)).toEqual([flag]);
  });

  it.each(W04_FLAGS)("fails %s left out", (flag) => {
    const rest = Object.fromEntries(Object.entries(allOn).filter(([key]) => key !== flag));
    expect(flagsNotTrue(tsconfigs({ "tsconfig.json": rest }))).toContain(flag);
  });

  it("reads a member switched off in an extended config", () => {
    const config = tsconfigs({
      "base.json": { ...allOn, strictNullChecks: false },
      "tsconfig.json": { strict: true },
    });
    expect(flagsNotTrue(config)).toEqual(["strictNullChecks"]);
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
  [
    "W-02",
    ["@typescript-eslint/consistent-type-assertions", "@typescript-eslint/no-non-null-assertion"],
  ],
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
  [
    "W-14",
    ["@typescript-eslint/only-throw-error", "@typescript-eslint/prefer-promise-reject-errors"],
  ],
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

/**
 * Inside a Stryker worker (the kit's own mutation run) the project lies in a sandbox under the ignored `.web-tops/out`,
 * and its `node_modules` is a link, so git cannot say what it ignores there; these tests hold in the ordinary run.
 */
const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;

describe.skipIf(insideStryker)(
  "R24: ignore patterns are anchored, so a source directory of the same name stays in",
  () => {
    const ignoredByGit = (path: string): boolean | undefined => {
      const result = spawnSync("git", ["check-ignore", "-q", "--", path], { cwd: root });
      return result.status === 0 ? true : result.status === 1 ? false : undefined;
    };

    const ignoredByPrettier = (path: string): unknown => {
      const prettier = join(root, "node_modules", "prettier", "bin", "prettier.cjs");
      const result = spawnSync(process.execPath, [prettier, "--file-info", path], {
        cwd: root,
        encoding: "utf8",
      });
      const info: unknown = JSON.parse(result.stdout);
      return get(info, "ignored");
    };

    it.each(["src/layers/coverage/x.ts", "src/config/x.ts", "src/coverage/x.ts"])(
      "git does not ignore %s",
      (path) => {
        expect(ignoredByGit(path)).toBe(false);
      },
    );

    it.each([
      "coverage/lcov.info",
      "node_modules/x/index.js",
      ".web-tops/out/x.json",
      ".web-tops/report.json",
    ])("git ignores the output %s", (path) => {
      expect(ignoredByGit(path)).toBe(true);
    });

    it.each([
      "src/layers/coverage/x.ts",
      "src/config/validate.ts",
      "src/cli/main.ts",
      "schema/web-tops.schema.json",
    ])("Prettier checks %s", (path) => {
      expect(ignoredByPrettier(path)).toBe(false);
    });

    it.each([
      "coverage/lcov.info",
      "WEB_TOPS.md",
      "config/AGENTS.md.tmpl",
      "fixtures/config/valid/full.yaml",
      "bun.lock",
    ])("Prettier skips %s", (path) => {
      expect(ignoredByPrettier(path)).toBe(true);
    });
  },
);

describe("R42: lint skips the output directories the tools write", () => {
  const ignored = (path: string): Promise<boolean> =>
    new ESLint({ cwd: root }).isPathIgnored(join(root, path));

  it.each([".astro/types.d.ts", ".web-tops/out/eslint.json", "coverage/x.js", "dist/x.js"])(
    "ignores %s",
    async (path) => {
      expect(await ignored(path)).toBe(true);
    },
  );

  it.each(["src/config/validate.ts", ".dependency-cruiser.cjs", "eslint.config.js"])(
    "lints %s",
    async (path) => {
      expect(await ignored(path)).toBe(false);
    },
  );
});

describe("R9: the published sources import their neighbours with the .ts extension", () => {
  it("every relative import in a non-test source names a .ts or .json file", () => {
    const sources = readdirSync(join(root, "src"), { recursive: true, encoding: "utf8" }).filter(
      (name) =>
        name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.includes("test-support"),
    );
    expect(sources.length).toBeGreaterThan(10);
    for (const name of sources) {
      const text = readFileSync(join(root, "src", name), "utf8");
      for (const match of text.matchAll(/(?:from|import) "(\.{1,2}\/[^"]+)"/g)) {
        expect(match[1], `${name}: ${String(match[1])}`).toMatch(/\.(ts|json)$/);
      }
    }
  });
});

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

describe("G0d: probes/** and fixtures/probe/** are reserved in every tool scope", () => {
  const reserved = [
    "probes/x.ts",
    "probes/w22/run.ts",
    "probes/w22/fixtures/a.tsx",
    "fixtures/probe/x.ts",
    "fixtures/probe/e2/cheat.ts",
  ];
  const checked = ["src/x.ts", "src/config/validate.ts", "src/probes/x.ts"];
  const prettier = join(root, "node_modules/prettier/bin/prettier.cjs");
  const made: string[] = [];

  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const ignoredByPrettier = (path: string): unknown => {
    const result = spawnSync(process.execPath, [prettier, "--file-info", path], {
      cwd: root,
      encoding: "utf8",
    });
    const info: unknown = JSON.parse(result.stdout);
    return get(info, "ignored");
  };

  it.each(reserved)(
    "ESLint ignores %s, so a planted lint error there does not fail lint",
    async (path) => {
      expect(await new ESLint({ cwd: root }).isPathIgnored(join(root, path))).toBe(true);
    },
  );

  it.each(checked)("ESLint still lints %s", async (path) => {
    expect(await new ESLint({ cwd: root }).isPathIgnored(join(root, path))).toBe(false);
  });

  it.each(reserved)("Prettier skips %s", (path) => {
    expect(ignoredByPrettier(path)).toBe(true);
  });

  it.each(checked)("Prettier still checks %s", (path) => {
    expect(ignoredByPrettier(path)).toBe(false);
  });

  it("tsconfig excludes both, even if its include were widened to the whole repo", () => {
    const read = ts.readConfigFile(join(root, "tsconfig.json"), (file) => ts.sys.readFile(file));
    expect(get(get(read.config, "exclude"), "length")).toBeGreaterThanOrEqual(2);
    const dir = mkdtempSync(join(tmpdir(), "wt-tsconfig-"));
    made.push(dir);
    for (const name of [...reserved, "src/x.ts"]) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), "export const x = 1;\n");
    }
    const config: unknown = read.config;
    const widened = { ...(typeof config === "object" ? config : {}), include: ["**/*"] };
    const parsed = ts.parseJsonConfigFileContent(widened, ts.sys, dir);
    expect(parsed.fileNames.map((name) => name.slice(dir.length + 1)).sort()).toEqual(["src/x.ts"]);
  });

  it("vitest.config.ts excludes both from the tests it collects", () => {
    const text = readFileSync(join(root, "vitest.config.ts"), "utf8");
    expect(text).toMatch(/exclude: \[[^\]]*"probes\/\*\*"[^\]]*"fixtures\/probe\/\*\*"/);
    expect(text).toContain('include: ["src/**/*.test.ts"]');
  });
});

describe("G7: section 2 names the lint pins the kit and the lock carry", () => {
  const section2 = readFileSync(join(root, "WEB_TOPS.md"), "utf8");
  const row = section2.split("\n").find((line) => line.startsWith("| Lint |")) ?? "";
  const lint = [
    "eslint",
    "@eslint/js",
    "typescript-eslint",
    "eslint-plugin-astro",
    "eslint-plugin-jsx-a11y-x",
    "@eslint-community/eslint-plugin-eslint-comments",
  ] as const;
  const minor = (version: string): string => version.split(".").slice(0, 2).join(".");

  it.each(lint)("the Lint row gives %s at the minor of its pin", (name) => {
    const pin: string = TOOL_PINS[name];
    expect(row).toMatch(
      new RegExp(`\`${name}\` \\*{0,2}${minor(pin).replace(".", "\\.")}\\*{0,2}[ ,|]`),
    );
  });

  it("the kit installs the ESLint the pins table names, and no ESLint 9 is left in section 2", () => {
    expect(get(pkg.devDependencies, "eslint")).toBe(TOOL_PINS.eslint);
    expect(get(pkg.devDependencies, "@eslint/js")).toBe(TOOL_PINS["@eslint/js"]);
    expect(section2.slice(section2.indexOf("## 2. Pins"), section2.indexOf("## 3."))).not.toMatch(
      /ESLint 9|9\.39/,
    );
  });
});

describe("R55: section 2 lists the readers W-47 and W-48 name", () => {
  const section2 = readFileSync(join(root, "WEB_TOPS.md"), "utf8");
  const row = section2.split("\n").find((line) => line.startsWith("| Law readers |")) ?? "";

  it.each(["eslint-plugin-react-hooks", "knip"] as const)(
    "the Law readers row gives %s at its pin",
    (name) => {
      const [major, minor] = TOOL_PINS[name].split(".");
      expect(row).toContain(`\`${name}\` ${String(major)}.${String(minor)}`);
    },
  );
});

describe("M2 G0a: Stryker is pinned exactly at the section 2 versions", () => {
  const stryker = [
    "@stryker-mutator/core",
    "@stryker-mutator/vitest-runner",
    "@stryker-mutator/typescript-checker",
  ] as const;

  it.each(stryker)(
    "%s is a devDependency at its pin, the same exact version in all three",
    (name) => {
      expect(get(pkg.devDependencies, name)).toBe(TOOL_PINS[name]);
      expect(TOOL_PINS[name]).toBe(TOOL_PINS["@stryker-mutator/core"]);
    },
  );

  it.each(stryker)("the section 2 Mutation row names %s", (name) => {
    const spec = readFileSync(join(root, "WEB_TOPS.md"), "utf8");
    const row = spec.split("\n").find((line) => line.startsWith("| Mutation |")) ?? "";
    expect(row).toContain("StrykerJS 10.1");
    expect(row).toContain(
      name.replace("@stryker-mutator/", "").replace("core", "`@stryker-mutator/core`"),
    );
  });

  it.each(stryker)("web-tops.lock records %s at its pin", (name) => {
    expect(readFileSync(join(root, "web-tops.lock"), "utf8")).toContain(
      `"${name}": ${TOOL_PINS[name]}`,
    );
  });
});

describe("M2 G0b: the M2 source paths are in every tool's scope", () => {
  const source = [
    "src/complexity",
    "src/crap",
    "src/diff",
    "src/baseline",
    "src/survivors",
    "src/layers/crap",
    "src/layers/mutation",
  ];
  const fixtures = "fixtures/complexity";
  const prettier = join(root, "node_modules/prettier/bin/prettier.cjs");
  const made: string[] = [];

  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const eslint = new ESLint({ cwd: root });
  const ignoredByPrettier = (path: string): unknown => {
    const result = spawnSync(process.execPath, [prettier, "--file-info", path], {
      cwd: root,
      encoding: "utf8",
    });
    const info: unknown = JSON.parse(result.stdout);
    return get(info, "ignored");
  };

  it.each(source)("ESLint lints %s, at complexity error 4", async (dir) => {
    for (const file of [`${dir}/x.ts`, `${dir}/x.test.ts`]) {
      expect(await eslint.isPathIgnored(join(root, file)), file).toBe(false);
      const config: unknown = await eslint.calculateConfigForFile(join(root, file));
      expect(get(get(config, "rules"), "complexity"), file).toEqual([2, 4]);
    }
  });

  it.each(source)("Prettier checks %s", (dir) => {
    expect(ignoredByPrettier(`${dir}/x.ts`)).toBe(false);
  });

  it("tsconfig includes every one, and leaves fixtures/complexity out", () => {
    const read = ts.readConfigFile(join(root, "tsconfig.json"), (file) => ts.sys.readFile(file));
    const dir = mkdtempSync(join(tmpdir(), "wt-tsconfig-m2-"));
    made.push(dir);
    for (const name of [...source.map((path) => `${path}/x.ts`), `${fixtures}/x.ts`]) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), "export const x = 1;\n");
    }
    const config: unknown = read.config;
    const widened = { ...(typeof config === "object" ? config : {}), include: ["src", "fixtures"] };
    const parsed = ts.parseJsonConfigFileContent(widened, ts.sys, dir);
    expect(parsed.fileNames.map((name) => name.slice(dir.length + 1)).sort()).toEqual(
      source.map((path) => `${path}/x.ts`).sort(),
    );
    const own = ts.parseJsonConfigFileContent(config, ts.sys, dir);
    expect(own.fileNames.map((name) => name.slice(dir.length + 1)).sort()).toEqual(
      source.map((path) => `${path}/x.ts`).sort(),
    );
  });

  it.each(source)("Vitest collects tests in %s and counts its sources for coverage", (dir) => {
    expect(matchesGlob(`${dir}/x.test.ts`, "src/**/*.test.ts")).toBe(true);
    expect(matchesGlob(`${dir}/x.ts`, "src/**/*.ts")).toBe(true);
  });

  it("fixtures/complexity is data: skipped by lint, format, tsc and the tests, like fixtures/probe", async () => {
    expect(await eslint.isPathIgnored(join(root, `${fixtures}/x.ts`))).toBe(true);
    expect(await eslint.isPathIgnored(join(root, `${fixtures}/x.tsx`))).toBe(true);
    expect(ignoredByPrettier(`${fixtures}/x.ts`)).toBe(true);
    const text = readFileSync(join(root, "vitest.config.ts"), "utf8");
    expect(text).toContain('"fixtures/complexity/**"');
    expect(readFileSync(join(root, "tsconfig.json"), "utf8")).toContain('"fixtures/complexity"');
    expect(readFileSync(join(root, ".dependency-cruiser.cjs"), "utf8")).toContain(
      "fixtures/complexity",
    );
  });

  it("fixtures/probe from P3 is present: every case the spec lists, and the expected outcomes", () => {
    expect(existsSync(join(root, "fixtures/probe/EXPECTED.yaml"))).toBe(true);
    expect(readdirSync(join(root, "fixtures/probe")).length).toBeGreaterThan(5);
  });
});
