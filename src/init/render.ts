import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stringify } from "yaml";
import { PROTOCOL } from "../config/protocol.ts";
import { NODE_CI, TOOL_PINS } from "../lock/pins.ts";
import type { EslintVariant, DropIn } from "./profile.ts";

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

const A11Y_IMPORT = 'import jsxA11yX from "eslint-plugin-jsx-a11y-x";';
const A11Y_CONFIG = '  { files: ["**/*.jsx", "**/*.tsx"], ...jsxA11yX.configs.strict },';
const HOOKS_IMPORT = 'import reactHooks from "eslint-plugin-react-hooks";';
const HOOKS_CONFIG = [
  "  {",
  "    // W-47 rules of hooks",
  '    files: ["**/*.jsx", "**/*.tsx"],',
  '    plugins: { "react-hooks": reactHooks },',
  "    rules: {",
  '      "react-hooks/rules-of-hooks": "error",',
  '      "react-hooks/exhaustive-deps": "error",',
  "    },",
  "  },",
].join("\n");

const ESLINT_SLOTS: Record<EslintVariant, { imports: string; configs: string }> = {
  base: { imports: "", configs: "" },
  react: {
    imports: `${A11Y_IMPORT}\n${HOOKS_IMPORT}`,
    configs: `  // W-22 semantic elements, alt text, labels\n${A11Y_CONFIG}\n${HOOKS_CONFIG}`,
  },
  astro: {
    imports: `import astro from "eslint-plugin-astro";\n${A11Y_IMPORT}`,
    configs:
      `  // W-22 semantic elements, alt text, labels (also inside .astro files)\n` +
      `  ...astro.configs["flat/recommended"],\n  ...astro.configs["flat/jsx-a11y-strict"],\n${A11Y_CONFIG}`,
  },
};

export function eslintConfig(profile: DropIn): string {
  const slots = ESLINT_SLOTS[profile.eslint];
  return fill(readTemplate("eslint.config.js.template"), {
    PLUGIN_IMPORTS: slots.imports,
    PLUGIN_CONFIGS: slots.configs,
  });
}

export function workflow(profile: DropIn): string {
  const step = profile.playwright
    ? "      - run: bunx playwright install --with-deps chromium"
    : "";
  return fill(readTemplate("workflow.yml.template"), {
    PLAYWRIGHT_STEP: step,
    NODE_VERSION: NODE_CI,
  });
}

const enabled = (profile: DropIn, layer: string): boolean => profile.disabled[layer] === undefined;

/** A line of the Floors list, kept only while the layer that measures it is enabled. */
function floorLine(profile: DropIn, layer: string, text: string): string {
  return enabled(profile, layer) ? text : "";
}

/** What the gate runs, in the order section 3 lists it, for the layers the written config enables. */
const VERIFIED: readonly (readonly [string, string])[] = [
  ["crap", "CRAP"],
  ["mutation", "mutation on the diff"],
  ["package_exports", "package export checks"],
  ["size_limit", "size limits"],
  ["html_validate", "HTML validation"],
  ["axe", "accessibility checks"],
  ["rendered", "rendered checks"],
  ["themes", "theme checks"],
  ["laws", "the laws"],
];

function joinList(items: readonly string[]): string {
  const last = items.at(-1) ?? "";
  return items.length < 2 ? last : `${items.slice(0, -1).join(", ")}, and ${last}`;
}

function verifies(profile: DropIn, astroCheck: AstroCheck): string {
  const hygiene = astroCheck.mapped
    ? ["type checks", "astro check", "lint"]
    : ["type checks", "lint"];
  const layers = VERIFIED.filter(([layer]) => enabled(profile, layer)).map(([, name]) => name);
  return joinList([...hygiene, "tests with coverage", ...layers]);
}

const HOOKS_LINE =
  "- **Follow the rules of hooks:** call hooks only at the top level of a component or custom hook, and list every dependency. **[W-47]**";

/** The rendered-interface laws (WEB_TOPS.md section 8.2), each named only while the layer that judges it is enabled. */
const RENDERED_LAWS: readonly (readonly [string, string, string])[] = [
  [
    "themes",
    "W-42",
    "**Contrast holds in every theme and color scheme:** 4.5:1 for text, 3:1 for large text and UI parts.",
  ],
  [
    "rendered",
    "W-43",
    "**Honor `prefers-reduced-motion`:** with reduce set, nothing keeps animating on its own unless essential.",
  ],
  ["rendered", "W-44", "**Pointer targets are at least 24 × 24 CSS px.**"],
  ["rendered", "W-45", "**Everything reached by keyboard shows a visible focus indicator.**"],
  ["rendered", "W-46", "**Pages reflow at 320 CSS px** with no horizontal scroll."],
];

/** The Rendered interface section, or nothing when the written config enables neither layer. */
function renderedSection(profile: DropIn): string {
  const lines = RENDERED_LAWS.filter(([layer]) => enabled(profile, layer)).map(
    ([, id, text]) => `- ${text} **[${id}]**`,
  );
  return lines.length === 0 ? "" : ["", "### Rendered interface", "", ...lines].join("\n");
}

const LAWS_NOTE =
  " Law IDs name the rule; while laws is disabled, these are checked in review, not by the gate.";

/** The AGENTS.md section: it names only the commands this kit has and the layers the config enables. */
export function agentsSection(profile: DropIn, subject: Subject, astroCheck: AstroCheck): string {
  return fill(readFileSync(AGENTS_TEMPLATE, "utf8"), {
    CLASS: profile.class,
    PACKAGE: subject.name,
    PROTOCOL: PROTOCOL,
    ENFORCE: "hard",
    COVERAGE_FLOOR: String(profile.coverage_floor),
    CRAP_LINE: floorLine(
      profile,
      "crap",
      `- CRAP cap ≤ \`${String(profile.crap_cap)}\`, the same for every author. \`??\` and \`?.\` count 0 toward complexity`,
    ),
    SURVIVORS_LINE: floorLine(
      profile,
      "mutation",
      `- Unexplained mutation survivors ≤ \`${String(profile.survivors_max)}\`, on lines changed against \`origin/main\``,
    ),
    BUDGET_LINE: floorLine(
      profile,
      "rendered",
      `- JS per page or route ≤ \`${profile.js_budget}\` (brotli, from the build output), where the class ships pages`,
    ),
    HOOKS_LINE: profile.eslint === "react" ? HOOKS_LINE : "",
    RENDERED_SECTION: renderedSection(profile),
    VERIFIES: verifies(profile, astroCheck),
    LAWS_NOTE: enabled(profile, "laws") ? "" : LAWS_NOTE,
  });
}

/** A layer or gate the profile switches off: `enabled: false` with its reason, else nothing to add. */
function switched(profile: DropIn, key: string): { enabled?: false; reason?: string } {
  const reason = profile.disabled[key];
  return reason === undefined ? {} : { enabled: false, reason };
}

const HEADER =
  "# Written by `webtops init` (WEB_TOPS.md sections 4 and 9). Under `hard`, only crap, mutation, build\n" +
  "# output and laws may be off for a class that maps them: they are `enabled: false` with the milestone\n" +
  "# that adds them. A layer the class does not map is off with the class as the reason.\n";

/** Whether `astro check` runs for this project, and the reason it is written off when it does not. */
export interface AstroCheck {
  readonly mapped: boolean;
  readonly reason: string;
}

export function webTopsYaml(profile: DropIn, subject: Subject, astroCheck: AstroCheck): string {
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
        ...(astroCheck.mapped
          ? {}
          : { astro_check: { enabled: false, reason: astroCheck.reason } }),
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
