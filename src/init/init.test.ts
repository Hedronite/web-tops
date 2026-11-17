import { readFileSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import ts from "typescript";
import { parse } from "yaml";
import { afterAll, describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { PROTOCOL } from "../config/protocol.ts";
import { TOOL_PINS } from "../lock/pins.ts";
import { parseLock } from "../lock/format.ts";
import { runInit } from "./run.ts";
import { at, madeDirs, put, snapshot, tempDir } from "./test-support.ts";

const root = resolve(import.meta.dirname, "../..");
const CLASSES = ["ts-library", "ui-components", "astro-site", "web-app", "node-service"] as const;
type Class = (typeof CLASSES)[number];

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

// The oracle, written from WEB_TOPS.md section 5.2 and the M1 rulings, not from the code.
const FLOORS: Record<Class, { coverage: number; crap: number; survivors: number }> = {
  "ts-library": { coverage: 85, crap: 4, survivors: 0 },
  "ui-components": { coverage: 80, crap: 5, survivors: 1 },
  "astro-site": { coverage: 70, crap: 6, survivors: 2 },
  "web-app": { coverage: 70, crap: 6, survivors: 2 },
  "node-service": { coverage: 80, crap: 5, survivors: 1 },
};

/** Where each switchable layer sits in web-tops.yaml. */
const PATH: Record<string, readonly string[]> = {
  stylelint: ["gates", "hygiene", "stylelint"],
  crap: ["gates", "crap"],
  mutation: ["gates", "mutation"],
  package_exports: ["layers", "package_exports"],
  size_limit: ["layers", "size_limit"],
  html_validate: ["layers", "html_validate"],
  axe: ["layers", "axe"],
  rendered: ["layers", "rendered"],
  themes: ["layers", "themes"],
  laws: ["laws"],
};

const NO_CSS = "class";
/** Layers a class leaves off in M1: "class" = the class does not map it; Mn = built in milestone n. */
const DISABLED: Record<Class, Record<string, string>> = {
  "ts-library": {
    stylelint: NO_CSS,
    crap: "M2",
    mutation: "M2",
    size_limit: "M4",
    html_validate: "class",
    axe: "class",
    rendered: "class",
    themes: "class",
    laws: "M3",
  },
  "ui-components": {
    crap: "M2",
    mutation: "M2",
    size_limit: "M4",
    html_validate: "M4",
    axe: "M4",
    rendered: "class",
    themes: "class",
    laws: "M3",
  },
  "astro-site": {
    crap: "M2",
    mutation: "M2",
    package_exports: "class",
    size_limit: "class",
    html_validate: "M4",
    axe: "M4",
    rendered: "M4",
    themes: "M4",
    laws: "M3",
  },
  "web-app": {
    crap: "M2",
    mutation: "M2",
    package_exports: "class",
    size_limit: "class",
    html_validate: "M4",
    axe: "M4",
    rendered: "M4",
    themes: "M4",
    laws: "M3",
  },
  "node-service": {
    stylelint: NO_CSS,
    crap: "M2",
    mutation: "M2",
    package_exports: "class",
    size_limit: "class",
    html_validate: "class",
    axe: "class",
    rendered: "class",
    themes: "class",
    laws: "M3",
  },
};

const FILES = [
  ".dependency-cruiser.cjs",
  ".github/workflows/web-tops.yml",
  "AGENTS.md",
  "eslint.config.js",
  "stylelint.config.js",
  "tsconfig.strict.json",
  "web-tops.lock",
  "web-tops.yaml",
];

const BASE_TOOLS = [
  "@eslint-community/eslint-plugin-eslint-comments",
  "@eslint/js",
  "@vitest/coverage-v8",
  "@vitest/eslint-plugin",
  "dependency-cruiser",
  "eslint",
  "prettier",
  "typescript",
  "typescript-eslint",
  "vitest",
  "webtops",
];
const PACKAGE_TOOLS = ["@arethetypeswrong/cli", "publint"];
const REACT_TOOLS = ["eslint-plugin-jsx-a11y", "stylelint"];
const TOOLS: Record<Class, readonly string[]> = {
  "ts-library": [...BASE_TOOLS, ...PACKAGE_TOOLS],
  "ui-components": [...BASE_TOOLS, ...PACKAGE_TOOLS, ...REACT_TOOLS, "@playwright/test"],
  "astro-site": [
    ...BASE_TOOLS,
    ...REACT_TOOLS,
    "@astrojs/check",
    "astro",
    "eslint-plugin-astro",
    "@playwright/test",
  ],
  "web-app": [...BASE_TOOLS, ...REACT_TOOLS, "@astrojs/check", "astro", "@playwright/test"],
  "node-service": BASE_TOOLS,
};
const NEEDS_PLAYWRIGHT: Record<Class, boolean> = {
  "ts-library": false,
  "ui-components": true,
  "astro-site": true,
  "web-app": true,
  "node-service": false,
};

function initInto(
  className: string,
  files: Record<string, string> = {},
): { dir: string; out: ReturnType<typeof runInit> } {
  const dir = tempDir();
  for (const [name, text] of Object.entries(files)) put(dir, name, text);
  return { dir, out: runInit({ className, dir, force: false }) };
}

function read(dir: string, relative: string): string {
  return readFileSync(join(dir, relative), "utf8");
}

function syntaxErrors(source: string, fileName: string): number {
  const result = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: { allowJs: true, module: ts.ModuleKind.ESNext },
  });
  return result.diagnostics?.length ?? 0;
}

const lawRules = (source: string): ReadonlySet<string> =>
  new Set(
    [...source.matchAll(/"((?:@[\w-]+\/)?[\w-]+(?:\/[\w-]+)?)":\s*\[?\s*"error"/g)].map(
      (m) => m[1] ?? "",
    ),
  );

describe.each(CLASSES)("webtops init --class %s", (className) => {
  const { dir, out } = initInto(className, {
    "package.json": JSON.stringify({ name: "@example/subject", version: "1.2.3" }),
  });
  const config: unknown = parse(read(dir, "web-tops.yaml"));

  it("succeeds and writes the section 4 drop-in set, no baseline, no stryker file", () => {
    expect(out.code).toBe(0);
    expect([...snapshot(dir).keys()].filter((p) => p !== "package.json")).toEqual(FILES);
    expect(out.deferred).toEqual(["stryker.config.json"]);
  });

  it("writes the identity, the floors and enforce hard", () => {
    const floors = FLOORS[className];
    expect(at(config, "protocol")).toBe(PROTOCOL);
    expect(at(config, "class")).toBe(className);
    expect(at(config, "package")).toBe("@example/subject");
    expect(at(config, "version")).toBe("1.2.3");
    expect(at(config, "enforce")).toBe("hard");
    expect(at(config, "exemption")).toBeUndefined();
    expect(at(config, "gates", "hygiene", "format")).toEqual({ tool: "prettier" });
    expect(at(config, "toolchain", "typescript")).toBe("6.0.3");
    expect(at(config, "gates", "coverage", "lines_floor")).toBe(floors.coverage);
    expect(at(config, "gates", "crap", "cap")).toBe(floors.crap);
    expect(at(config, "gates", "mutation", "unexplained_survivors_max")).toBe(floors.survivors);
  });

  it("disables exactly the unmapped layers, each with a reason that names why", () => {
    const expected = DISABLED[className];
    for (const [layer, path] of Object.entries(PATH)) {
      const node = at(config, ...path);
      const why = expected[layer];
      if (why === undefined) {
        expect(at(node, "enabled"), layer).not.toBe(false);
        continue;
      }
      expect(at(node, "enabled"), layer).toBe(false);
      expect(at(node, "reason"), layer).toMatch(
        why === "class" ? /^not mapped for class: \S/ : new RegExp(`^milestone ${why}: \\S`),
      );
    }
  });

  it("selects the default laws, and writes laws.select rather than the 0.2.0 laws.enable", () => {
    expect(at(config, "laws", "select")).toBe("default");
    expect(at(config, "laws", "enable")).toBeUndefined();
  });

  it("switches off nothing a hard config forbids: only crap, mutation, build output, laws or unmapped layers", () => {
    const off = Object.keys(DISABLED[className]);
    for (const layer of off) {
      expect([
        "stylelint",
        "crap",
        "mutation",
        "package_exports",
        "size_limit",
        "html_validate",
        "axe",
        "rendered",
        "themes",
        "laws",
      ]).toContain(layer);
    }
    for (const mappedGate of ["eslint", "audit", "format"]) {
      expect(at(config, "gates", "hygiene", mappedGate, "enabled"), mappedGate).not.toBe(false);
    }
    expect(at(config, "gates", "tests", "enabled")).not.toBe(false);
    expect(at(config, "gates", "coverage", "enabled")).not.toBe(false);
  });

  it("writes no placeholder that is still unreplaced", () => {
    for (const [path, text] of snapshot(dir)) {
      expect(text, path).not.toMatch(/\{[A-Z][A-Z_]+\}/);
    }
  });

  it("fills the AGENTS section from the template with this class's numbers", () => {
    const text = read(dir, "AGENTS.md");
    const floors = FLOORS[className];
    expect(text).toContain(`**Class:** \`${className}\``);
    expect(text).toContain("**Package:** `@example/subject`");
    expect(text).toContain("**Enforce:** `hard`");
    expect(text).toContain(`Line coverage ≥ \`${String(floors.coverage)}%\``);
    expect(text).toContain(`CRAP cap ≤ \`${String(floors.crap)}\``);
    expect(text).toContain(`survivors ≤ \`${String(floors.survivors)}\``);
  });

  it("carries every W-04 flag in tsconfig.strict.json", () => {
    const tsconfig: unknown = JSON.parse(read(dir, "tsconfig.strict.json"));
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
      expect(at(tsconfig, "compilerOptions", flag), flag).toBe(true);
    }
  });

  it("writes an eslint.config.js that parses, with the astro and a11y plugins only where mapped", () => {
    const source = read(dir, "eslint.config.js");
    expect(syntaxErrors(source, "eslint.config.js")).toBe(0);
    const a11y =
      className === "ui-components" || className === "web-app" || className === "astro-site";
    expect(source.includes("eslint-plugin-jsx-a11y")).toBe(a11y);
    expect(source.includes("eslint-plugin-astro")).toBe(className === "astro-site");
    expect(source).toContain("strictTypeChecked");
    expect(source).toContain('reportUnusedDisableDirectives: "error"');
  });

  it("writes a dependency-cruiser config that parses and forbids cycles and deep dist imports", () => {
    const source = read(dir, ".dependency-cruiser.cjs");
    expect(syntaxErrors(source, ".dependency-cruiser.cjs")).toBe(0);
    expect(source).toContain("no-circular");
    expect(source).toContain("no-deep-dist-imports");
  });

  it("writes a stylelint config that parses", () => {
    expect(syntaxErrors(read(dir, "stylelint.config.js"), "stylelint.config.js")).toBe(0);
  });

  it("writes web-tops.lock with exactly this class's tools at the kit's exact versions", () => {
    const lock = parseLock(read(dir, "web-tops.lock"));
    expect(lock.ok).toBe(true);
    if (!lock.ok) return;
    expect(Object.keys(lock.lock).sort()).toEqual([...TOOLS[className]].sort());
    for (const [tool, version] of Object.entries(lock.lock)) {
      expect(version, tool).toBe(tool === "webtops" ? pkg.version : Reflect.get(TOOL_PINS, tool));
    }
  });

  it("writes the section 11 workflow: one gate job, pinned actions, minimal permissions", () => {
    const workflow: unknown = parse(read(dir, ".github/workflows/web-tops.yml"));
    expect(at(workflow, "permissions")).toEqual({ contents: "read" });
    const jobs = at(workflow, "jobs");
    expect(Object.keys(typeof jobs === "object" && jobs !== null ? jobs : {})).toEqual([
      "gate",
      "nightly",
      "release-verify",
    ]);
    const text = read(dir, ".github/workflows/web-tops.yml");
    for (const [, ref] of text.matchAll(/uses:\s*(\S+)/g)) {
      expect(ref, "an action ref").toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    }
    expect(text.match(/fetch-depth: 0/g)?.length).toBe(3);
    expect(text).toContain("bunx webtops gate --max-tier 1");
    expect(text).toContain("bunx webtops gate --max-tier 2");
    expect(text).toContain("bunx webtops gate --max-tier 3");
    expect(text).toContain("bun install --frozen-lockfile");
    for (const line of text.split("\n").filter((l) => /^\s*-?\s*run:/.test(l))) {
      expect(line, "a run step beside the gate").not.toMatch(
        /\b(eslint|tsc|vitest|stylelint|prettier|depcruise|publint|attw)\b/,
      );
    }
    expect(text.includes("playwright install")).toBe(NEEDS_PLAYWRIGHT[className]);
  });
});

describe("webtops init, the gate's own rule set", () => {
  it("ts-library's eslint config enables the same law rules as the kit's own config", () => {
    const { dir } = initInto("ts-library");
    expect(lawRules(read(dir, "eslint.config.js"))).toEqual(
      lawRules(readFileSync(join(root, "eslint.config.js"), "utf8")),
    );
  });

  it("every class's eslint config sets every mapped law rule to error", () => {
    const kit = lawRules(readFileSync(join(root, "eslint.config.js"), "utf8"));
    expect(kit.size).toBeGreaterThanOrEqual(15);
    for (const className of CLASSES) {
      const { dir } = initInto(className);
      for (const rule of kit)
        expect(lawRules(read(dir, "eslint.config.js")), `${className} ${rule}`).toContain(rule);
    }
  });
});

describe("webtops init, inputs", () => {
  it("falls back to the directory name and version 0.0.0 without a package.json", () => {
    const { dir } = initInto("ts-library");
    const config: unknown = parse(read(dir, "web-tops.yaml"));
    expect(at(config, "package")).toBe(basename(dir));
    expect(at(config, "version")).toBe("0.0.0");
  });

  it("falls back to the directory name when package.json has no usable name", () => {
    const { dir } = initInto("ts-library", { "package.json": JSON.stringify({ name: 7 }) });
    expect(at(parse(read(dir, "web-tops.yaml")), "package")).toBe(basename(dir));
  });

  it("falls back to the directory name when package.json is not JSON", () => {
    const { dir } = initInto("ts-library", { "package.json": "{ nope" });
    expect(at(parse(read(dir, "web-tops.yaml")), "package")).toBe(basename(dir));
  });

  it("writes the same bytes into two directories given the same inputs", () => {
    const meta = { "package.json": JSON.stringify({ name: "same", version: "1.0.0" }) };
    for (const className of CLASSES) {
      const a = initInto(className, meta);
      const b = initInto(className, meta);
      expect(snapshot(a.dir), className).toEqual(snapshot(b.dir));
    }
  });
});

describe("webtops init, refusals", () => {
  it("refuses a second run with exit 4 and leaves every file byte for byte as it was", () => {
    const { dir } = initInto("web-app");
    const before = snapshot(dir);
    const again = runInit({ className: "web-app", dir, force: false });
    expect(again.code).toBe(4);
    expect(again.written).toEqual([]);
    expect(again.problems.join("\n")).toContain("web-tops.yaml");
    expect(snapshot(dir)).toEqual(before);
  });

  it("refuses the whole run, writing nothing, when one target already exists", () => {
    const { dir, out } = initInto("ts-library", { "eslint.config.js": "// mine\n" });
    expect(out.code).toBe(4);
    expect(snapshot(dir)).toEqual(new Map([["eslint.config.js", "// mine\n"]]));
  });

  it("--force overwrites the generated files", () => {
    const { dir } = initInto("ts-library");
    put(dir, "eslint.config.js", "// edited\n");
    const forced = runInit({ className: "ts-library", dir, force: true });
    expect(forced.code).toBe(0);
    expect(read(dir, "eslint.config.js")).toContain("strictTypeChecked");
  });

  it.each(["cli", "workspace-root", "config-only", "bogus", ""])(
    "exits 2 and writes nothing for the class %j",
    (className) => {
      const { dir, out } = initInto(className);
      expect(out.code).toBe(2);
      expect(snapshot(dir).size).toBe(0);
    },
  );

  it("exits 2 and writes nothing when no class is given", () => {
    const dir = tempDir();
    const out = runInit({ className: undefined, dir, force: false });
    expect(out.code).toBe(2);
    expect(snapshot(dir).size).toBe(0);
  });

  it("exits 3 when the directory cannot be written", () => {
    const out = runInit({
      className: "ts-library",
      dir: join(tempDir(), "missing", "deeper"),
      force: false,
    });
    expect(out.code).toBe(3);
  });
});

describe("webtops init, baseline", () => {
  it("never writes .web-tops/baseline.json, with or without --force", () => {
    for (const force of [false, true]) {
      const dir = tempDir();
      expect(runInit({ className: "web-app", dir, force }).code).toBe(0);
      expect([...snapshot(dir).keys()].some((p) => p.startsWith(".web-tops"))).toBe(false);
    }
  });

  it("leaves an existing baseline untouched under --force", () => {
    const { dir } = initInto("ts-library", { ".web-tops/baseline.json": '{"kept":true}\n' });
    expect(runInit({ className: "ts-library", dir, force: true }).code).toBe(0);
    expect(read(dir, ".web-tops/baseline.json")).toBe('{"kept":true}\n');
  });
});

describe("webtops init, AGENTS.md", () => {
  const outside =
    "# Mine\n\nKeep me.\n\n<!-- web-tops:begin -->\nold\n<!-- web-tops:end -->\n\nAlso me";

  it("replaces only the marked block of an existing file when forced, keeping the rest exactly", () => {
    const { dir } = initInto("ts-library", { "AGENTS.md": outside });
    expect(runInit({ className: "ts-library", dir, force: true }).code).toBe(0);
    const text = read(dir, "AGENTS.md");
    expect(text.startsWith("# Mine\n\nKeep me.\n\n<!-- web-tops:begin -->")).toBe(true);
    expect(text.endsWith("<!-- web-tops:end -->\n\nAlso me")).toBe(true);
    expect(text).toContain("**Class:** `ts-library`");
    expect(text).not.toContain("\nold\n");
  });

  it("refuses to replace a differing block without --force and does not touch the file", () => {
    const dir = tempDir();
    put(dir, "AGENTS.md", outside);
    const out = runInit({ className: "ts-library", dir, force: false });
    expect(out.code).toBe(4);
    expect(read(dir, "AGENTS.md")).toBe(outside);
    expect(snapshot(dir).size).toBe(1);
  });

  it("appends a marked block to an AGENTS.md without markers, with no --force", () => {
    const dir = tempDir();
    put(dir, "AGENTS.md", "# Existing\n");
    expect(runInit({ className: "ts-library", dir, force: false }).code).toBe(0);
    const text = read(dir, "AGENTS.md");
    expect(text.startsWith("# Existing\n")).toBe(true);
    expect(text.match(/<!-- web-tops:begin -->/g)?.length).toBe(1);
  });

  it("refuses an AGENTS.md whose markers are unbalanced, writing nothing", () => {
    const dir = tempDir();
    put(dir, "AGENTS.md", "<!-- web-tops:begin -->\nnever closed\n");
    expect(runInit({ className: "ts-library", dir, force: true }).code).toBe(4);
    expect(snapshot(dir).size).toBe(1);
  });
});

describe("the AGENTS template init renders", () => {
  it("keeps its markers and its seven placeholders", () => {
    const text = readFileSync(join(root, "config/AGENTS.md.tmpl"), "utf8");
    expect(text.match(/<!-- web-tops:begin -->/g)?.length).toBe(1);
    expect(text.match(/<!-- web-tops:end -->/g)?.length).toBe(1);
    for (const name of [
      "CLASS",
      "PACKAGE",
      "ENFORCE",
      "COVERAGE_FLOOR",
      "CRAP_CAP",
      "SURVIVORS_MAX",
      "JS_BUDGET",
    ]) {
      expect(text, name).toContain(`{${name}}`);
    }
  });
});
