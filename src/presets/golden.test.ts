import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadProfile } from "../init/profile.ts";
import { runInit } from "../init/run.ts";
import { madeDirs, tempDir } from "../init/test-support.ts";
import { ROOT, plain, presetOf } from "./test-support.ts";

// G2b: a golden per class. The importers `init` writes are compared text for text, and the preset
// each importer names is compared as data, so a changed rule changes a golden and a rule written into
// an importer changes it too. To accept an intended change, regenerate with
//   WT_UPDATE_GOLDEN=1 bunx vitest run src/presets/golden.test.ts && bunx prettier --write fixtures/init
// and review the diff: a golden changes only through a protocol-change PR.

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

const CLASSES = ["ts-library", "ui-components", "astro-site", "web-app", "node-service"] as const;
const IMPORTERS = [
  "eslint.config.js",
  "stylelint.config.js",
  ".dependency-cruiser.cjs",
  "tsconfig.strict.json",
] as const;
const UPDATE = process.env["WT_UPDATE_GOLDEN"] === "1";

/** The golden of a written file is named `<file>.golden` (a dot-less name), so no tool takes it for a config. */
const goldenPath = (className: string, file: string): string =>
  join(ROOT, "fixtures", "init", className, `${file.replace(/^\./, "")}.golden`);

/** Checks `actual` against the golden file, or writes the golden when asked to regenerate. */
function matchesGolden(className: string, file: string, actual: string): string {
  const path = goldenPath(className, file);
  if (UPDATE) {
    mkdirSync(join(ROOT, "fixtures", "init", className), { recursive: true });
    writeFileSync(path, actual);
  }
  return readFileSync(path, "utf8");
}

function variantOf(className: string): "base" | "react" | "astro" {
  const loaded = loadProfile(className);
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.profile.eslint;
}

describe.each(CLASSES)("G2b: the golden for %s", (className) => {
  const dir = tempDir();
  runInit({ className, dir, force: false });

  it.each(IMPORTERS)("the importer %s is the golden, and holds no rules", (file) => {
    const written = readFileSync(join(dir, file), "utf8");
    expect(written).toBe(matchesGolden(className, file, written));
    expect(written).not.toMatch(/"error"|rules\s*:|forbidden/);
  });

  it("the preset the eslint importer names is the golden, rule for rule", async () => {
    const variant = variantOf(className);
    expect(readFileSync(join(dir, "eslint.config.js"), "utf8")).toContain(`variant: "${variant}"`);
    const data = plain(await presetOf(variant));
    const golden = matchesGolden(
      className,
      "eslint.preset.json",
      `${JSON.stringify(data, null, 2)}\n`,
    );
    const expected: unknown = JSON.parse(golden);
    expect(data).toEqual(expected);
  });
});
