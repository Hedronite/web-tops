import { rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { serializeLock } from "../lock/format.ts";
import { BEGIN_MARKER, END_MARKER, mergeAgentsSection } from "./agents.ts";
import { readPackageMeta } from "./meta.ts";
import { PROFILES_DIR, loadProfile } from "./profile.ts";
import { agentsSection, fill } from "./render.ts";
import { runInit } from "./run.ts";
import { madeDirs, put, tempDir } from "./test-support.ts";

// Direct tests of init's small functions: the messages they give, the text they join, and the
// branches the end-to-end tests walk past.

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

const BLOCK = `${BEGIN_MARKER}\ngenerated\n${END_MARKER}\n`;
const LAUNCH = "ts-library, ui-components, astro-site, web-app, node-service";

describe("AGENTS.md merging", () => {
  it("puts exactly one blank line between existing text and the appended block", () => {
    expect(mergeAgentsSection("# Notes\n", BLOCK)).toEqual({
      kind: "append",
      text: `# Notes\n\n${BLOCK}`,
    });
    expect(mergeAgentsSection("# Notes", BLOCK)).toEqual({
      kind: "append",
      text: `# Notes\n\n${BLOCK}`,
    });
  });

  it("refuses two end markers, and says how many of each it found", () => {
    const result = mergeAgentsSection(`${BEGIN_MARKER}\n${END_MARKER}\n${END_MARKER}\n`, BLOCK);
    expect(result).toEqual({
      kind: "malformed",
      reason:
        "AGENTS.md has 1 begin and 2 end markers, or they are out of order " +
        "(markers inside fenced code blocks count too, so a file that quotes them cannot be inited)",
    });
  });

  it("refuses an end marker that comes before the begin marker", () => {
    expect(mergeAgentsSection(`${END_MARKER}\n${BEGIN_MARKER}\n`, BLOCK).kind).toBe("malformed");
  });
});

describe("loadProfile", () => {
  const real = loadProfile("ts-library");
  const profilesDir = (files: Readonly<Record<string, string>>): string => {
    const dir = tempDir();
    for (const [name, text] of Object.entries(files)) put(dir, name, text);
    return dir;
  };
  const text = (path: string): string => {
    const loaded = loadProfile("ts-library", path);
    return loaded.ok ? "loaded" : loaded.error;
  };

  it("loads the class's profile with its row of the class table", () => {
    expect(real.ok).toBe(true);
    expect(PROFILES_DIR.endsWith("profiles")).toBe(true);
  });

  it("says why when no class is given, or the class has no launch profile", () => {
    expect(loadProfile(undefined)).toEqual({ ok: false, error: "no class given" });
    expect(loadProfile("")).toEqual({ ok: false, error: "no class given" });
    expect(loadProfile("nope")).toEqual({
      ok: false,
      error: 'no launch profile for class "nope"',
    });
  });

  it("says when the profile file is missing or is not YAML", () => {
    expect(text(profilesDir({}))).toMatch(/^profiles\/ts-library\.yaml is unreadable: .*ENOENT/);
    expect(text(profilesDir({ "ts-library.yaml": "a: [\n" }))).toMatch(
      /^profiles\/ts-library\.yaml is unreadable: /,
    );
  });

  it("says when the profile does not have the drop-in shape", () => {
    expect(text(profilesDir({ "ts-library.yaml": "class: ts-library\n" }))).toMatch(
      /^profiles\/ts-library\.yaml is invalid: \[\{/,
    );
  });

  it("refuses a profile that declares another class", () => {
    const dir = tempDir();
    const own = loadProfile("web-app");
    if (!own.ok) throw new Error(own.error);
    writeFileSync(
      join(dir, "ts-library.yaml"),
      [
        "class: web-app",
        `coverage_floor: ${String(own.profile.coverage_floor)}`,
        `crap_cap: ${String(own.profile.crap_cap)}`,
        `survivors_max: ${String(own.profile.survivors_max)}`,
        "js_budget: n/a",
        "playwright: false",
        "eslint: base",
        "tools: []",
        "disabled: {}",
        "",
      ].join("\n"),
    );
    expect(text(dir)).toBe('profiles/ts-library.yaml declares class "web-app"');
  });
});

describe("readPackageMeta", () => {
  it("reads a name and a version, and falls back on a blank one", () => {
    const dir = tempDir();
    put(dir, "package.json", JSON.stringify({ name: "demo", version: "1.2.3" }));
    expect(readPackageMeta(dir)).toEqual({ name: "demo", version: "1.2.3" });
    put(dir, "package.json", JSON.stringify({ name: "  ", version: "\t" }));
    expect(readPackageMeta(dir)).toEqual({ name: basename(dir), version: "0.0.0" });
  });
});

describe("fill", () => {
  it("drops a line that is only an empty placeholder, and keeps a line that has more", () => {
    expect(fill("a\n{GONE}\nb", { GONE: "" })).toBe("a\nb");
    expect(fill("{GONE} tail", { GONE: "" })).toBe(" tail");
    expect(fill("{KEPT} and {B}", { KEPT: "x" })).toBe("x and {B}");
  });
});

describe("the AGENTS.md section", () => {
  it("names the rendered-interface laws when the layers that judge them are enabled", () => {
    const loaded = loadProfile("web-app");
    if (!loaded.ok) throw new Error(loaded.error);
    const text = agentsSection(
      { ...loaded.profile, disabled: {} },
      { name: "demo", version: "1.0.0" },
      { mapped: false, reason: "" },
    );
    for (const line of [
      "### Rendered interface",
      "- **Contrast holds in every theme and color scheme:** 4.5:1 for text, 3:1 for large text and UI parts. **[W-42]**",
      "- **Honor `prefers-reduced-motion`:** with reduce set, nothing keeps animating on its own unless essential. **[W-43]**",
      "- **Pointer targets are at least 24 × 24 CSS px.** **[W-44]**",
      "- **Everything reached by keyboard shows a visible focus indicator.** **[W-45]**",
      "- **Pages reflow at 320 CSS px** with no horizontal scroll. **[W-46]**",
    ]) {
      expect(text, line).toContain(line);
    }
  });
});

describe("runInit outcomes", () => {
  it("refuses an unknown class with the launch classes, and writes nothing", () => {
    expect(runInit({ className: "nope", dir: tempDir(), force: false })).toEqual({
      code: 2,
      written: [],
      problems: [`no launch profile for class "nope"; the launch classes are ${LAUNCH}`],
      install: [],
    });
  });

  it("refuses a directory that is not one", () => {
    const dir = tempDir();
    const file = join(dir, "a-file");
    writeFileSync(file, "");
    expect(runInit({ className: "ts-library", dir: file, force: false })).toEqual({
      code: 3,
      written: [],
      problems: [`${file} is not a directory`],
      install: [],
    });
  });

  it("lists what it wrote in order, and installs web-tops first", () => {
    const dir = tempDir();
    const out = runInit({ className: "ts-library", dir, force: false });
    expect(out.code).toBe(0);
    expect(out.problems).toEqual([]);
    expect(out.written).toEqual([...out.written].sort());
    expect(out.written[0]).toBe(".dependency-cruiser.cjs");
    expect(out.install[0]).toBe(`web-tops@${pkg.version}`);
  });
});

describe("serializeLock", () => {
  it("sorts the keys by code unit, keeps one line per tool, and ends with a newline", () => {
    const text = serializeLock({
      zeta: "1.0.0",
      alpha: "2.0.0",
      "@scope/pkg": "3.0.0",
      node: "^22.23.4 || ^24.15.0 || >=26",
      "alpha-two": "4.0.0",
    });
    const body = text.split("\n").filter((line) => !line.startsWith("#"));
    expect(body).toEqual([
      '"@scope/pkg": 3.0.0',
      "alpha: 2.0.0",
      "alpha-two: 4.0.0",
      "node: ^22.23.4 || ^24.15.0 || >=26",
      "zeta: 1.0.0",
      "",
    ]);
  });

  it("does not wrap a long value", () => {
    const long = Array.from({ length: 40 }, () => "word").join(" ");
    expect(serializeLock({ tool: long })).toContain(`tool: ${long}\n`);
  });
});
