import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stringify } from "yaml";
import { PROTOCOL } from "../config/protocol";
import { TOOL_PINS } from "../lock/pins";
import type { EslintVariant, Profile } from "./profile";

export const TEMPLATES_DIR = resolve(import.meta.dirname, "../../config/templates");
export const AGENTS_TEMPLATE = resolve(import.meta.dirname, "../../config/AGENTS.md.tmpl");

export interface Subject {
  readonly name: string;
  readonly version: string;
}

/**
 * Fills `{NAME}` placeholders in one pass. A placeholder alone on its line that fills to the empty
 * string removes the line, so an unused slot leaves no blank behind.
 */
export function fill(text: string, values: Readonly<Record<string, string>>): string {
  return text
    .split("\n")
    .flatMap((line) => {
      const alone = /^\{([A-Z][A-Z_]+)\}$/.exec(line);
      const value = alone?.[1] === undefined ? undefined : values[alone[1]];
      if (value === "") return [];
      return [line.replace(/\{([A-Z][A-Z_]+)\}/g, (match, name: string) => values[name] ?? match)];
    })
    .join("\n");
}

export function readTemplate(name: string): string {
  return readFileSync(resolve(TEMPLATES_DIR, name), "utf8");
}

const A11Y_IMPORT = 'import jsxA11y from "eslint-plugin-jsx-a11y";';
const A11Y_CONFIG = '  { files: ["**/*.jsx", "**/*.tsx"], ...jsxA11y.flatConfigs.strict },';

const ESLINT_SLOTS: Record<EslintVariant, { imports: string; configs: string }> = {
  base: { imports: "", configs: "" },
  react: { imports: A11Y_IMPORT, configs: `  // W-22 semantic elements, alt text, labels\n${A11Y_CONFIG}` },
  astro: {
    imports: `import astro from "eslint-plugin-astro";\n${A11Y_IMPORT}`,
    configs:
      `  // W-22 semantic elements, alt text, labels (also inside .astro files)\n` +
      `  ...astro.configs["flat/recommended"],\n  ...astro.configs["flat/jsx-a11y-strict"],\n${A11Y_CONFIG}`,
  },
};

export function eslintConfig(profile: Profile): string {
  const slots = ESLINT_SLOTS[profile.eslint];
  return fill(readTemplate("eslint.config.js.template"), {
    PLUGIN_IMPORTS: slots.imports,
    PLUGIN_CONFIGS: slots.configs,
  });
}

export function workflow(profile: Profile): string {
  const step = profile.playwright ? "      - run: bunx playwright install --with-deps chromium" : "";
  return fill(readTemplate("workflow.yml.template"), { PLAYWRIGHT_STEP: step });
}

export function agentsSection(profile: Profile, subject: Subject): string {
  return fill(readFileSync(AGENTS_TEMPLATE, "utf8"), {
    CLASS: profile.class,
    PACKAGE: subject.name,
    PROTOCOL: PROTOCOL,
    ENFORCE: "hard",
    COVERAGE_FLOOR: String(profile.coverage_floor),
    CRAP_CAP: String(profile.crap_cap),
    SURVIVORS_MAX: String(profile.survivors_max),
    JS_BUDGET: profile.js_budget,
  });
}

/** A layer or gate the profile switches off: `enabled: false` with its reason, else nothing to add. */
function switched(profile: Profile, key: string): { enabled?: false; reason?: string } {
  const reason = profile.disabled[key];
  return reason === undefined ? {} : { enabled: false, reason };
}

const HEADER =
  "# Written by `webtops init` (WEB_TOPS.md sections 4 and 9). Under `hard`, only crap, mutation, build\n" +
  "# output and laws may be off for a class that maps them: they are `enabled: false` with the milestone\n" +
  "# that adds them. A layer the class does not map is off with the class as the reason.\n";

export function webTopsYaml(profile: Profile, subject: Subject): string {
  const doc = {
    protocol: PROTOCOL,
    version: subject.version,
    package: subject.name,
    class: profile.class,
    enforce: "hard",
    baseline: ".web-tops/baseline.json",
    toolchain: { typescript: TOOL_PINS.typescript, runtime: "bun" },
    gates: {
      hygiene: {
        eslint: { config: "eslint.config.js" },
        format: { tool: "prettier" },
        stylelint: switched(profile, "stylelint"),
        audit: { fail_on: "high" },
      },
      tests: { runner: "vitest", shuffle: true },
      coverage: { lines_floor: profile.coverage_floor },
      crap: {
        cap: profile.crap_cap,
        scope: "diff",
        complexity: { nullish_discount: true },
        ...switched(profile, "crap"),
      },
      mutation: {
        engine: "stryker",
        scope: "diff",
        base: "origin/main",
        unexplained_survivors_max: profile.survivors_max,
        ledger: ".web-tops/survivors.yaml",
        ...switched(profile, "mutation"),
      },
    },
    layers: {
      size_limit: { tier: 1, ...switched(profile, "size_limit") },
      package_exports: { tier: 1, ...switched(profile, "package_exports") },
      html_validate: switched(profile, "html_validate"),
      axe: switched(profile, "axe"),
      rendered: switched(profile, "rendered"),
      themes: switched(profile, "themes"),
      custom: [],
    },
    laws: { select: "default", ack_ledger: ".web-tops/acks.yaml", ...switched(profile, "laws") },
    report: { path: ".web-tops/report.json" },
  };
  return HEADER + stringify(doc, { lineWidth: 0 });
}
