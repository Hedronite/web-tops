import { readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";
import preset from "./stylelint.js";
import { bin, run, scratchProject } from "./test-support-scratch.ts";

const CONFIG = 'export { default } from "web-tops/stylelint";\n';

/** A page as Astro writes one: frontmatter, markup and, when `style` is given, a `<style>` block. */
const page = (style = ""): string =>
  '---\nconst title: string = "Home";\n---\n\n<h1 class="title">{title}</h1>\n' +
  (style === "" ? "" : `\n<style>\n${style}\n</style>\n`);

/** What Tailwind CSS 4 adds to a stylesheet. */
const TAILWIND = [
  '@import "tailwindcss";',
  "@theme {\n  --color-brand: #0b5cad;\n}",
  "@utility nav-link {\n  display: inline-block;\n}",
  '@custom-variant current (&[aria-current="page"]);',
  "a {\n  @apply underline;\n}",
  "",
].join("\n\n");

const BAD = "h1 {\n  color: #ggg;\n}";

interface Reported {
  readonly status: number | null;
  /** `file:line rule` for each warning, with the file relative to the project. */
  readonly warnings: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const listOf = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

/** Runs Stylelint over a project as the gate's step does for an astro-site. */
function lint(files: Readonly<Record<string, string>>): Reported {
  const dir = scratchProject({ "stylelint.config.js": CONFIG, ...files });
  const args = ["--formatter", "json", "--output-file", "out.json", "--allow-empty-input"];
  const { status, output } = run(bin("stylelint"), [...args, "**/*.css", "**/*.astro"], dir);
  expect(output, output).not.toContain("Error:");
  const results = listOf(JSON.parse(readFileSync(join(dir, "out.json"), "utf8")));
  const warnings = results.flatMap((result) =>
    listOf(result["warnings"]).map(
      (warning) =>
        `${relative(realpathSync(dir), String(result["source"]))}:${String(warning["line"])} ${String(warning["rule"])}`,
    ),
  );
  return { status, warnings: warnings.sort() };
}

describe("web-tops/stylelint on an Astro project", { timeout: REAL_TOOL_TIMEOUT }, () => {
  it("reads .astro through postcss-html and leaves what builds and runs write alone", () => {
    expect(preset.overrides).toEqual([{ files: ["**/*.astro"], customSyntax: "postcss-html" }]);
    expect(preset.ignoreFiles).toEqual([
      "**/node_modules/**",
      "**/coverage/**",
      "**/dist/**",
      "**/.astro/**",
      "**/.web-tops/**",
      "!**/.web-tops/out/laws-probe/**",
    ]);
  });

  it("passes a page with no style, a page with a clean style block and Tailwind 4 CSS", () => {
    const result = lint({
      "src/pages/plain.astro": page(),
      "src/pages/styled.astro": page(".title {\n  color: #0b5cad;\n}"),
      "src/styles/global.css": TAILWIND,
    });
    expect(result).toEqual({ status: 0, warnings: [] });
  });

  it("fails a bad style block, at its line in the .astro file", () => {
    const result = lint({ "src/pages/bad.astro": page(BAD) });
    expect(result).toEqual({
      status: 2,
      warnings: ["src/pages/bad.astro:9 color-no-invalid-hex"],
    });
  });

  it("still judges the twins `laws probe` copies under .web-tops", () => {
    const twin = ".web-tops/out/laws-probe/W-26/bad/a.css";
    const dir = scratchProject({ "stylelint.config.js": CONFIG, [twin]: BAD });
    const result = run(bin("stylelint"), [".web-tops/out/laws-probe/**/*.css"], dir);
    expect(result.status).toBe(2);
    expect(result.output).toContain("color-no-invalid-hex");
  });

  it("judges the source and nothing an install, a build or a gate run wrote", () => {
    const written = [
      "dist/site.css",
      "coverage/base.css",
      ".astro/types.css",
      ".web-tops/out/page.css",
      "node_modules/pkg/index.css",
      "packages/a/dist/site.css",
      "dist/page.astro",
    ];
    const result = lint({
      ...Object.fromEntries(written.map((path) => [path, BAD])),
      "src/styles/bad.css": BAD,
    });
    expect(result).toEqual({
      status: 2,
      warnings: ["src/styles/bad.css:2 color-no-invalid-hex"],
    });
  });
});
