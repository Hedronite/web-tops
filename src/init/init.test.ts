import { readFileSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import ts from "typescript";
import { parse } from "yaml";
import { afterAll, describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { PROTOCOL } from "../config/protocol.ts";
import { checkConfigFile } from "../config/validate.ts";
import { NODE_CI, NODE_RANGE, TOOL_PINS } from "../lock/pins.ts";
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
  "web-app": [...BASE_TOOLS, ...REACT_TOOLS, "@playwright/test"],
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

const WORKFLOW = ".github/workflows/web-tops.yml";
/** The actions/setup-node release the workflow pins, read from its tag on 2026-11-17. */
const SETUP_NODE = "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1";

const keysOf = (node: unknown): string[] => Object.keys(node ?? {});
const actionRefs = (text: string): string[] =>
  [...text.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1] ?? "");
const runLines = (text: string): string[] =>
  text.split("\n").filter((line) => /^\s*-?\s*run:/.test(line));

/** The layers whose lines and Verification names the AGENTS section keeps only while the config enables them. */
const LINE_FOR: Record<string, string> = {
  crap: "- CRAP cap ≤",
  mutation: "- Unexplained mutation survivors ≤",
  rendered: "- JS per page or route ≤",
};
const NAME_FOR: Record<string, string> = {
  crap: "CRAP",
  mutation: "mutation",
  package_exports: "package export checks",
  size_limit: "size limits",
  html_validate: "HTML validation",
  axe: "accessibility checks",
  rendered: "rendered checks",
  themes: "theme checks",
  laws: "the laws",
};
const verifies = (text: string): string => /It runs (.+?)\. Running/s.exec(text)?.[1] ?? "";

describe.each(CLASSES)("webtops init --class %s", (className) => {
  const { dir, out } = initInto(className, {
    "package.json": JSON.stringify({ name: "@example/subject", version: "1.2.3" }),
  });
  const config: unknown = parse(read(dir, "web-tops.yaml"));

  it("succeeds and writes the section 4 drop-in set, no baseline, no stryker file", () => {
    expect(out.code).toBe(0);
    expect([...snapshot(dir).keys()].filter((p) => p !== "package.json")).toEqual(FILES);
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
    expect(text).toContain(`**Protocol:** Web-TOPS ${PROTOCOL}`);
    for (const [, version] of text.matchAll(/Web-TOPS (\d+\.\d+\.\d+)/g)) {
      expect(version, "every protocol version in the section").toBe(PROTOCOL);
    }
    expect(text).toContain(`Line coverage ≥ \`${String(floors.coverage)}%\``);
  });

  it("names only commands this kit has, and no ratchet line under enforce hard", () => {
    const text = read(dir, "AGENTS.md");
    expect(text).not.toContain("laws run");
    expect(text).not.toContain("Under `ratchet`");
    for (const command of ["check", "gate", "report --format text"]) {
      expect(text).toContain(`bunx webtops ${command}`);
    }
  });

  it("keeps a floor line only while the config enables the layer behind it", () => {
    const text = read(dir, "AGENTS.md");
    for (const [layer, phrase] of Object.entries(LINE_FOR)) {
      expect(text.includes(phrase), layer).toBe(DISABLED[className][layer] === undefined);
    }
  });

  it("lists in the Verification line the layers the written config enables, and no other", () => {
    const sentence = verifies(read(dir, "AGENTS.md"));
    for (const [layer, name] of Object.entries(NAME_FOR)) {
      expect(sentence.includes(name), layer).toBe(DISABLED[className][layer] === undefined);
    }
    expect(sentence).toContain("tests with coverage");
    expect(sentence.includes("astro check")).toBe(className === "astro-site");
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
    expect(Object.keys(lock.lock).sort()).toEqual([...TOOLS[className], "node"].sort());
    expect(lock.lock["node"]).toBe(NODE_RANGE);
    for (const [tool, version] of Object.entries(lock.lock).filter(([tool]) => tool !== "node")) {
      expect(version, tool).toBe(tool === "webtops" ? pkg.version : Reflect.get(TOOL_PINS, tool));
    }
  });

  it("leaves node out of the install line, because bun does not install it", () => {
    expect(out.install.some((entry) => entry.startsWith("node@"))).toBe(false);
  });

  it("writes the section 11 workflow: the gate job alone, minimal permissions, no schedule or release", () => {
    const text = read(dir, WORKFLOW);
    const workflow: unknown = parse(text);
    expect(at(workflow, "permissions")).toEqual({ contents: "read" });
    expect(keysOf(at(workflow, "jobs"))).toEqual(["gate"]);
    expect(keysOf(at(workflow, "on"))).toEqual(["push", "pull_request"]);
    expect(text).not.toMatch(/nightly|release-verify|law-diff|max-tier [23]/);
    expect(text.match(/fetch-depth: 0/g)?.length).toBe(1);
    expect(text).toContain("bunx webtops gate --max-tier 1");
  });

  it("pins every action by SHA, and sets up Node before Bun installs", () => {
    const text = read(dir, WORKFLOW);
    expect(actionRefs(text).map((ref) => ref.split("@")[0])).toEqual([
      "actions/checkout",
      "actions/setup-node",
      "oven-sh/setup-bun",
    ]);
    expect(actionRefs(text)).toContain(SETUP_NODE);
    for (const ref of actionRefs(text)) expect(ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    expect(text.indexOf("setup-node")).toBeLessThan(text.indexOf("setup-bun"));
    expect(text.indexOf("setup-bun")).toBeLessThan(text.indexOf("bun install --frozen-lockfile"));
  });

  it("gives setup-node the one exact Node from pins.ts, never the range", () => {
    const text = read(dir, WORKFLOW);
    expect(text).toContain(`node-version: "${NODE_CI}"`);
    expect(text).not.toContain("||");
    const steps: unknown = at(parse(text), "jobs", "gate", "steps");
    const nodeStep: unknown = Array.isArray(steps)
      ? steps.find((step) => at(step, "with", "node-version") !== undefined)
      : undefined;
    expect(at(nodeStep, "with", "node-version")).toBe(NODE_CI);
  });

  it("runs the gate through webtops alone, with Playwright browsers only where the class needs them", () => {
    const text = read(dir, WORKFLOW);
    expect(text).toContain("bun install --frozen-lockfile");
    for (const line of runLines(text)) {
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

describe("webtops init, astro check follows the project", () => {
  const withAstro = (where: "dependencies" | "devDependencies" | "peerDependencies") =>
    JSON.stringify({ name: "p", version: "1.0.0", [where]: { astro: "7.4.12" } });
  const astroCheck = (dir: string): unknown =>
    at(parse(read(dir, "web-tops.yaml")), "gates", "hygiene", "astro_check");
  const locked = (dir: string): string[] => {
    const lock = parseLock(read(dir, "web-tops.lock"));
    return lock.ok ? Object.keys(lock.lock) : [];
  };

  it.each(["astro-site"] as const)(
    "%s always runs it, with or without astro in package.json",
    (className) => {
      for (const files of [{}, { "package.json": withAstro("dependencies") }]) {
        const { dir } = initInto(className, files);
        expect(at(astroCheck(dir), "enabled")).not.toBe(false);
        expect(locked(dir)).toEqual(expect.arrayContaining(["astro", "@astrojs/check"]));
      }
    },
  );

  it.each(["ui-components", "web-app"] as const)(
    "%s runs it only when astro is a dependency, a dev dependency or a peer",
    (className) => {
      for (const where of ["dependencies", "devDependencies", "peerDependencies"] as const) {
        const { dir } = initInto(className, { "package.json": withAstro(where) });
        expect(at(astroCheck(dir), "enabled"), where).not.toBe(false);
        expect(locked(dir), where).toEqual(expect.arrayContaining(["astro", "@astrojs/check"]));
      }
    },
  );

  it.each(["ui-components", "web-app"] as const)(
    "%s without astro writes it off, with a reason, and locks no astro",
    (className) => {
      for (const files of [
        {},
        { "package.json": JSON.stringify({ name: "p", dependencies: { react: "19.0.0" } }) },
        { "package.json": "{ nope" },
      ]) {
        const { dir } = initInto(className, files);
        expect(at(astroCheck(dir), "enabled")).toBe(false);
        expect(at(astroCheck(dir), "reason")).toMatch(/^not mapped for class: \S/);
        expect(locked(dir)).not.toContain("astro");
        expect(locked(dir)).not.toContain("@astrojs/check");
      }
    },
  );

  it.each(["ts-library", "node-service"] as const)(
    "%s never runs it, even with astro in package.json",
    (className) => {
      const { dir } = initInto(className, { "package.json": withAstro("dependencies") });
      expect(at(astroCheck(dir), "enabled")).toBe(false);
      expect(at(astroCheck(dir), "reason")).toMatch(/^not mapped for class: \S/);
      expect(locked(dir)).not.toContain("astro");
    },
  );

  it("an astro project passes check, with the step on or off", () => {
    for (const className of ["ui-components", "web-app"] as const) {
      for (const files of [{}, { "package.json": withAstro("dependencies") }]) {
        const { dir } = initInto(className, files);
        expect(checkConfigFile(join(dir, "web-tops.yaml")).ok).toBe(true);
      }
    }
  });
});

describe("webtops init, AGENTS.md blocks that already exist", () => {
  const BEGIN = "<!-- web-tops:begin -->";
  const END = "<!-- web-tops:end -->";

  it.each([
    ["an empty pair", `intro\n${BEGIN}${END}\nnotes`],
    ["an empty pair on two lines", `intro\r\n${BEGIN}\r\n${END}\r\nnotes`],
    ["a whitespace-only pair", `${BEGIN}\n \t \n${END}`],
  ])("fills %s without --force and keeps the text around it", (_name, existing) => {
    const dir = tempDir();
    put(dir, "AGENTS.md", existing);
    const out = runInit({ className: "ts-library", dir, force: false });
    expect(out.code, out.problems.join()).toBe(0);
    const text = read(dir, "AGENTS.md");
    expect(text.startsWith(existing.slice(0, existing.indexOf(BEGIN) + BEGIN.length))).toBe(true);
    expect(text.endsWith(existing.slice(existing.indexOf(END)))).toBe(true);
    expect(text).toContain("**Class:** `ts-library`");
  });

  it("succeeds when the block is already exactly what init writes, and leaves AGENTS.md alone", () => {
    const { dir } = initInto("ts-library", { "package.json": '{"name":"p","version":"1.0.0"}' });
    const before = read(dir, "AGENTS.md");
    for (const file of [
      "web-tops.yaml",
      "web-tops.lock",
      "tsconfig.strict.json",
      "eslint.config.js",
      "stylelint.config.js",
      ".dependency-cruiser.cjs",
      ".github/workflows/web-tops.yml",
    ]) {
      rmSync(join(dir, file));
    }
    const again = runInit({ className: "ts-library", dir, force: false });
    expect(again.code, again.problems.join()).toBe(0);
    expect(again.written).not.toContain("AGENTS.md");
    expect(read(dir, "AGENTS.md")).toBe(before);
    expect(snapshot(dir).has("web-tops.yaml")).toBe(true);
  });

  it("needs --force for a block that differs, and names the file", () => {
    const dir = tempDir();
    put(dir, "AGENTS.md", `${BEGIN}\nsomething else\n${END}\n`);
    const out = runInit({ className: "ts-library", dir, force: false });
    expect(out.code).toBe(4);
    expect(out.problems.join("\n")).toContain("AGENTS.md");
    expect(runInit({ className: "ts-library", dir, force: true }).code).toBe(0);
  });

  it("refuses markers quoted in a fenced code block and says fenced code counts", () => {
    const dir = tempDir();
    put(
      dir,
      "AGENTS.md",
      `Usage:\n\n\`\`\`md\n${BEGIN}\n${END}\n\`\`\`\n\n${BEGIN}\nold\n${END}\n`,
    );
    const out = runInit({ className: "ts-library", dir, force: true });
    expect(out.code).toBe(4);
    expect(out.problems.join("\n")).toContain("fenced");
    expect(snapshot(dir).size).toBe(1);
  });
});

describe("the AGENTS template init renders", () => {
  it("keeps its markers and its placeholders, the protocol among them", () => {
    const text = readFileSync(join(root, "config/AGENTS.md.tmpl"), "utf8");
    expect(text.match(/<!-- web-tops:begin -->/g)?.length).toBe(1);
    expect(text.match(/<!-- web-tops:end -->/g)?.length).toBe(1);
    for (const name of [
      "CLASS",
      "PROTOCOL",
      "PACKAGE",
      "ENFORCE",
      "COVERAGE_FLOOR",
      "CRAP_LINE",
      "SURVIVORS_LINE",
      "BUDGET_LINE",
      "VERIFIES",
    ]) {
      expect(text, name).toContain(`{${name}}`);
    }
  });
});
