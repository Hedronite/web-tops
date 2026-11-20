import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Linter } from "eslint";
import { eslintPreset } from "../presets/eslint.js";
import type { EslintVariant } from "../presets/eslint.js";
import { afterAll, describe, expect, it } from "vitest";
import { PROTOCOL } from "../config/protocol.ts";
import { loadProfile } from "./profile.ts";
import { runInit } from "./run.ts";
import { madeDirs, put, tempDir } from "./test-support.ts";

// G2b: a golden per class. Everything `init` writes is compared text for text, and the preset the
// ESLint importer names is compared as data, so a changed rule changes a golden, and a rule written
// into an importer changes one too. A kit version or protocol bump leaves them alone: those two
// values are read out of the text first. To accept an intended change, regenerate with
//   WT_UPDATE_GOLDEN=1 bunx vitest run src/init/golden.test.ts
// and review the diff: a golden changes only through a protocol-change PR.

const root = resolve(import.meta.dirname, "../..");
const CLASSES = ["ts-library", "ui-components", "astro-site", "web-app", "node-service"] as const;
const UPDATE = process.env["WT_UPDATE_GOLDEN"] === "1";

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

const same = (text: string): string => text;

/** What `init` writes, each file with the one step that hides a value a release changes. */
const WRITTEN: readonly (readonly [string, (text: string) => string])[] = [
  ["eslint.config.js", same],
  ["stylelint.config.js", same],
  [".dependency-cruiser.cjs", same],
  ["tsconfig.strict.json", same],
  [".github/workflows/web-tops.yml", same],
  ["web-tops.yaml", (text) => text.replace(/^protocol: .*$/m, "protocol: <protocol>")],
  ["web-tops.lock", (text) => text.replace(/^webtops: .*$/m, "webtops: <kit>")],
  ["AGENTS.md", (text) => text.replaceAll(PROTOCOL, "<protocol>")],
];

/** The golden of a written file is `<file>.golden` with no leading dot, so no tool takes it for a config. */
function goldenPath(className: string, name: string): string {
  return join(
    root,
    "fixtures",
    "init",
    className,
    `${name.replace(/^\./, "").replaceAll("/", ".")}.golden`,
  );
}

/** The golden's text; when asked to regenerate, `actual` is written first. */
function golden(className: string, name: string, actual: string): string {
  const path = goldenPath(className, name);
  if (UPDATE) {
    mkdirSync(join(root, "fixtures", "init", className), { recursive: true });
    writeFileSync(path, actual);
  }
  return readFileSync(path, "utf8");
}

function variantOf(className: string): EslintVariant {
  const loaded = loadProfile(className);
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.profile.eslint;
}

/** What a rule change shows in: each entry's scope, plugins by name, rules and parser options. */
function shape(entry: Linter.Config): object {
  return {
    files: entry.files,
    ignores: entry.ignores,
    plugins: Object.keys(entry.plugins ?? {}),
    rules: entry.rules,
    linterOptions: entry.linterOptions,
    parserOptions: entry.languageOptions?.parserOptions,
  };
}

describe.each(CLASSES)("G2b: the golden for %s", (className) => {
  const dir = tempDir();
  put(dir, "package.json", JSON.stringify({ name: "demo", version: "1.2.3" }));
  const outcome = runInit({ className, dir, force: false });

  it("writes the files the goldens cover, and no others", () => {
    expect(outcome.written).toEqual(WRITTEN.map(([name]) => name).sort());
  });

  it.each(WRITTEN)("%s is the golden", (name, normalize) => {
    const written = normalize(readFileSync(join(dir, name), "utf8"));
    expect(written).toBe(golden(className, name, written));
  });

  it("holds no rules in an importer", () => {
    for (const name of ["eslint.config.js", "stylelint.config.js", ".dependency-cruiser.cjs"]) {
      expect(readFileSync(join(dir, name), "utf8"), name).not.toMatch(
        /"error"|rules\s*:|forbidden/,
      );
    }
  });

  it("the preset the eslint importer names is the golden, rule for rule", async () => {
    const variant = variantOf(className);
    expect(readFileSync(join(dir, "eslint.config.js"), "utf8")).toContain(`variant: "${variant}"`);
    const config = await eslintPreset({ variant, tsconfigRootDir: "<project>" });
    const data: unknown = JSON.parse(JSON.stringify(config.map(shape)));
    const expected: unknown = JSON.parse(
      golden(className, "eslint.preset.json", `${JSON.stringify(data, null, 2)}\n`),
    );
    expect(data).toEqual(expected);
  });
});
