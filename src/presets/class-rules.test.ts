import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import plugin from "../../packages/eslint-plugin-webtops/src/index.ts";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";
import { eslintPreset } from "./eslint.js";
import type { EslintVariant } from "./eslint.js";
import {
  TSCONFIG,
  bin,
  configFor,
  removeScratches,
  run,
  scratchProject,
} from "./test-support-scratch.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const PREFIX = "webtops/";
const CLASSES = ["ts-library", "ui-components", "astro-site", "web-app", "node-service"];

function yamlOf(path: string): unknown {
  return parse(readFileSync(join(ROOT, path), "utf8"));
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function list(value: unknown, key: string): unknown[] {
  const found = field(value, key);
  return Array.isArray(found) ? found : [];
}

/** The variant a class's drop-in profile names. */
function variantOf(cls: string): EslintVariant {
  const named = field(yamlOf(`profiles/${cls}.yaml`), "eslint");
  if (named === "base" || named === "react" || named === "astro") return named;
  throw new Error(`profiles/${cls}.yaml names no variant`);
}

/** The plugin's rules, named as a config names them. */
const IMPLEMENTED = new Set(Object.keys(plugin.rules ?? {}).map((name) => `${PREFIX}${name}`));

/**
 * The `webtops/*` rules the laws a class maps give the ESLint reader, read from the law files. A law
 * can name a rule that a later step builds; the step that adds the rule to the plugin must also
 * enable it, or this test fails.
 */
function mappedRules(cls: string): string[] {
  const names = readdirSync(join(ROOT, "laws"))
    .filter((file) => file.endsWith(".yaml"))
    .map((file) => yamlOf(`laws/${file}`))
    .filter((law) => list(law, "classes").includes(cls))
    .flatMap((law) => list(law, "rules"))
    .filter((rule) => field(rule, "tool") === "eslint")
    .map((rule) => field(rule, "name"))
    .filter((name): name is string => typeof name === "string" && IMPLEMENTED.has(name));
  return names.sort();
}

async function enabledRules(cls: string): Promise<string[]> {
  const config = await eslintPreset({
    variant: variantOf(cls),
    tsconfigRootDir: "<project>",
    class: cls,
  });
  const names = config.flatMap((entry) =>
    Object.entries(entry.rules ?? {})
      .filter(([name, setting]) => name.startsWith(PREFIX) && setting === "error")
      .map(([name]) => name),
  );
  return [...new Set(names)].sort();
}

describe("R98: a class's preset enables exactly the plugin rules its laws map", () => {
  it.each(CLASSES)("%s: the enabled webtops/* rules are the mapped laws' rules", async (cls) => {
    const mapped = mappedRules(cls);
    expect(mapped.length).toBeGreaterThan(0);
    expect(await enabledRules(cls)).toEqual(mapped);
  });

  it("holds the split the laws make: the Tailwind rule only for astro-site and web-app", async () => {
    const withTailwind: string[] = [];
    for (const cls of CLASSES) {
      if ((await enabledRules(cls)).includes("webtops/complete-tailwind-classes")) {
        withTailwind.push(cls);
      }
    }
    expect(withTailwind).toEqual(["astro-site", "web-app"]);
  });
});

afterAll(removeScratches);

/** One file of each kind a class's rules can match: a module, a React module and an Astro page. */
const KINDS = {
  "src/a.ts": "export const a: number = 1;\n",
  "src/c.tsx": "export const c = (): null => null;\n",
  "src/page.astro": [
    "---",
    "const Widget = (): null => null;",
    "---",
    "<Widget client:load />",
    "",
  ].join("\n"),
};

/** ESLint's report for every file under src, as JSON. */
function lintAll(dir: string): unknown[] {
  const parsed: unknown = JSON.parse(run(bin("eslint"), ["--format", "json", "src"], dir).stdout);
  return Array.isArray(parsed) ? parsed : [];
}

function pathOf(dir: string, report: unknown): string {
  const path = field(report, "filePath");
  return typeof path === "string" ? relative(realpathSync(dir), path) : "";
}

const messagesOf = (report: unknown): unknown[] => list(report, "messages");

describe("R105: a class's preset can parse every file kind its rules match", () => {
  it.each(CLASSES)(
    "%s: its project lints a module, a React module and a page with no parse error",
    (cls) => {
      const dir = scratchProject({
        "package.json": JSON.stringify({ type: "module", dependencies: { astro: "7.4.12" } }),
        "web-tops.yaml": `class: ${cls}\n`,
        "eslint.config.js": configFor(variantOf(cls)),
        "tsconfig.json": TSCONFIG,
        ...KINDS,
      });
      const reports = lintAll(dir);
      const mapsPages = mappedRules(cls).some((rule) => rule.startsWith(`${PREFIX}astro-`));
      expect(reports.map((report) => pathOf(dir, report)).sort()).toEqual(
        mapsPages ? Object.keys(KINDS).sort() : ["src/a.ts", "src/c.tsx"],
      );
      for (const report of reports) {
        const fatal = messagesOf(report).filter((message) => field(message, "fatal") === true);
        expect(fatal, pathOf(dir, report)).toEqual([]);
      }
      const page = reports.find((report) => pathOf(dir, report) === "src/page.astro");
      const ruleIds = messagesOf(page).map((message) => field(message, "ruleId"));
      expect(ruleIds.includes(`${PREFIX}astro-client-load-ack`)).toBe(mapsPages);
    },
    REAL_TOOL_TIMEOUT,
  );
});
