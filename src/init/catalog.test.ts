import { readFileSync } from "node:fs";
import { join } from "node:path";
import js from "@eslint/js";
import { describe, expect, it } from "vitest";
import { TOOL_PINS } from "../lock/pins.ts";
import { LAUNCH_CLASSES, loadProfile } from "./profile.ts";
import { PACKAGES, eslintPreset } from "../presets/eslint.js";
import { agentsSection } from "./render.ts";

// The oracle for P3 G8, written from SPEC-p3 G8: the text of sections 7, 8 and 13, and the template,
// say what the briefs say, and the claims about the pinned tools are checked on the pinned tools.

const root = join(import.meta.dirname, "../..");
const spec = readFileSync(join(root, "WEB_TOPS.md"), "utf8");
const template = readFileSync(join(root, "config/AGENTS.md.tmpl"), "utf8");

/** The text from `start` up to the next `end` heading. */
function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`no section from ${start} to ${end}`);
  return text.slice(from, to);
}

/** The section's text with line breaks folded to spaces, so a phrase can wrap in the Markdown. */
const flat = (text: string): string => text.replace(/\s+/g, " ");
const section7 = flat(between(spec, "## 7. ", "## 8. "));
const section81 = flat(between(spec, "### 8.1 ", "### 8.2 "));
const section82 = between(spec, "### 8.2 ", "### 8.3 ");
const section13 = flat(between(spec, "## 13. ", "## 14. "));

function row(id: string): string {
  const line = section82.split("\n").find((candidate) => candidate.startsWith(`| ${id} |`));
  if (line === undefined) throw new Error(`section 8.2 has no row ${id}`);
  return line;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function rowOf(entry: unknown): [string, boolean][] {
  return isRecord(entry) && typeof entry["fixture"] === "string"
    ? [[entry["fixture"], entry["fires"] === true]]
    : [];
}

/** What probes/w22/RESULT.json records for control-has-associated-label on each input fixture. */
function observed(): Record<string, boolean> {
  const result: unknown = JSON.parse(readFileSync(join(root, "probes/w22/RESULT.json"), "utf8"));
  const rows =
    isRecord(result) && isRecord(result["observations"]) ? result["observations"]["rows"] : [];
  return Object.fromEntries((Array.isArray(rows) ? rows : []).flatMap(rowOf));
}

/** Every law id the AGENTS section names for the class, with every layer enabled. */
function lawsNamedFor(className: string): string[] {
  const loaded = loadProfile(className);
  if (!loaded.ok) throw new Error(loaded.error);
  const profile = { ...loaded.profile, disabled: {} };
  const text = agentsSection(
    profile,
    { name: "x", version: "1.0.0" },
    { mapped: true, reason: "" },
  );
  return [...text.matchAll(/W-\d+/g)].map((match) => match[0]);
}

describe("G8a: section 7 names the presets, page JavaScript and axe's settings", () => {
  it("names the html-validate presets for W-20, and the a11y preset on built pages", () => {
    expect(section7).toContain("`html-validate:standard`");
    expect(section7).toContain("`html-validate:document`");
    expect(section7).toContain("`html-validate:a11y`");
    expect(section7).toContain("`recommended` preset adds house-style rules");
  });

  it("defines page JavaScript: inline, external, preloads, the static closure, brotli 11 and window 22", () => {
    const text = between(section7, "**Page JavaScript**", "**axe.**");
    for (const part of [
      "inline `<script>`",
      "external `<script src>`",
      '<link rel="modulepreload">',
      "static import closure",
      "quality 11",
      "window of 22 bits",
    ]) {
      expect(text, part).toContain(part);
    }
  });

  it("counts a lazy chunk toward the routes that request it while they load, and says what is not JavaScript", () => {
    const text = between(section7, "**Page JavaScript**", "**axe.**");
    expect(text).toContain("A dynamic `import()` is not in the closure");
    expect(text).toContain("every script of its own origin that it requests while it loads");
    expect(text).toContain("counts in full toward each route that requests it");
    expect(text).toContain("quiet for 500 ms");
    expect(text).toContain("requested only on an interaction");
    expect(text).toContain("`application/ld+json`");
  });

  it("pins axe's four tags, enables target-size by id, and maps incomplete to not-evaluated", () => {
    const text = section7.slice(section7.indexOf("**axe.**"));
    for (const tag of ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      expect(text).toContain(`\`${tag}\``);
    expect(text).toContain("`target-size`");
    expect(text).toContain("enables it by id");
    expect(text).toMatch(/`incomplete`[^]*`not-evaluated`/);
    expect(section7).toContain("An `incomplete` result is `not-evaluated`");
  });
});

describe("G8b: section 8 corrections and new laws", () => {
  it("states 49 laws, with one row for each id from W-01 to W-49", () => {
    expect(section82).toContain("draft: 49 laws, W-01…W-49");
    const ids = section82
      .split("\n")
      .map((line) => /^\| (W-\d+) \|/.exec(line)?.[1])
      .filter((id) => id !== undefined);
    // A family's laws sit together, so W-49 follows W-31 in the Astro table: the set is W-01 to W-49.
    expect([...ids].sort()).toEqual(
      Array.from({ length: 49 }, (_, i) => `W-${String(i + 1).padStart(2, "0")}`),
    );
    expect(section82).toContain("**v0.1 target:** 26 of 49 laws judged");
  });

  it("W-06 no longer says FormData and storage return any", () => {
    const text = row("W-06");
    expect(text).not.toContain("tl: these return `any`");
    expect(text).toContain("`FormData.get`");
    expect(text).toContain("not `any`");
    expect(text).toContain("`MessageEvent.data`");
  });

  it("W-13 names preserve-caught-error, which @eslint/js recommends at error on the pin", () => {
    expect(row("W-13")).toContain("`preserve-caught-error`");
    expect(js.configs.recommended.rules["preserve-caught-error"]).toBe("error");
  });

  it("W-22 gives the fork's reader and scopes the label claim to what the fixtures showed", () => {
    const text = row("W-22");
    expect(text).toContain("`eslint-plugin-jsx-a11y-x`");
    expect(text).toContain("`probes/w22/`");
    expect(text).not.toMatch(/form controls have labels/);
    expect(section82).toContain("**What W-22's lint rules prove about labels.**");
  });

  it("W-22's label note agrees with the observations committed in probes/w22/RESULT.json", () => {
    expect(observed()).toEqual({
      "input-aria-label.tsx": false,
      "input-bare.tsx": true,
      "input-label-for.tsx": true,
      "input-label-wrapping.tsx": true,
      "input-submit-value.tsx": true,
    });
  });

  it("W-35 points at the section 6.7 census", () => {
    expect(row("W-35")).toContain("The suppression census in §6.7");
  });

  it("appends W-47 (rules of hooks) and W-48 (unused exports, files and dependencies)", () => {
    expect(row("W-47")).toContain("`rules-of-hooks`");
    expect(row("W-47")).toContain("`eslint-plugin-react-hooks`");
    expect(row("W-48")).toContain("`knip`");
    expect(row("W-48")).toContain("tbd");
  });

  it("8.1: a required law whose rule is off or below error is refuse, with the config line", () => {
    expect(section81).toContain("With the rule or flag off or below `error`, the law is `refuse`");
    expect(section81).toContain("the finding carries the config line");
  });
});

describe("G8c: section 13 and the template cite section 3.4 and keep no copy of its rules", () => {
  it("section 13 has no numbered rule list, and points at 3.4", () => {
    expect(section13).not.toMatch(/^\d+\. /m);
    expect(section13).toContain("The rules every change is held to are §3.4");
  });

  it("the template's Policies section is a citation of 3.4, not a list", () => {
    const policies = between(template, "## Policies", "## Standards");
    expect(policies).not.toMatch(/^\d+\. /m);
    expect(policies).toContain("Web-TOPS §3.4");
    expect(policies).toContain("#34-stated-rules");
  });

  it("every law id the template names, for any class and any layer set, is in section 8.2", () => {
    const named = new Set(LAUNCH_CLASSES.flatMap(lawsNamedFor));
    for (const id of named) expect(section82, id).toContain(`| ${id} |`);
    expect(named.has("W-48")).toBe(true);
  });
});

describe("G8c: the drop-in ESLint config rests on the pinned tools", () => {
  it.each(LAUNCH_CLASSES)(
    "%s: every package the preset imports for its variant is in its tool list",
    (className) => {
      const loaded = loadProfile(className);
      if (!loaded.ok) throw new Error(loaded.error);
      const names = PACKAGES[loaded.profile.eslint];
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) expect(loaded.profile.tools, name).toContain(name);
    },
  );

  it.each(LAUNCH_CLASSES)(
    "%s: lints hooks only as a react class, and never imports the retired jsx-a11y",
    async (className) => {
      const loaded = loadProfile(className);
      if (!loaded.ok) throw new Error(loaded.error);
      const variant = loaded.profile.eslint;
      const react = className === "web-app" || className === "ui-components";
      expect(PACKAGES[variant].includes("eslint-plugin-react-hooks")).toBe(react);
      expect(PACKAGES[variant]).not.toContain("eslint-plugin-jsx-a11y");
      const config = await eslintPreset({ variant, tsconfigRootDir: "<project>" });
      expect(config).toContainEqual(
        expect.objectContaining({ rules: js.configs.recommended.rules }),
      );
    },
  );

  it("pins the hooks plugin and no longer pins jsx-a11y", () => {
    expect(TOOL_PINS).toHaveProperty(["eslint-plugin-react-hooks"]);
    expect(TOOL_PINS).not.toHaveProperty(["eslint-plugin-jsx-a11y"]);
  });
});
