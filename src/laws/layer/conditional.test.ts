import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cfg } from "../../gate/testkit.ts";
import type { Exec, LayerContext } from "../../gate/types.ts";
import { cleanTemp, put, tempDir } from "../../laws/probe/testkit.ts";
import type { LawEntry } from "../../laws/readers/types.ts";
import { yamlCatalog } from "./catalog.ts";
import { lawsOfProject } from "./entries.ts";
import { lawsLayer } from "./index.ts";

/** A law a class maps only for a project that depends on Astro (section 5.2: W-27). */

afterAll(cleanTemp);

const law = (id: string, extra: Partial<LawEntry> = {}): LawEntry => ({
  id,
  severity: "R",
  reader: "tl",
  classes: ["ui-components", "astro-site", "web-app"],
  judged: true,
  rules: [],
  ...extra,
});

const CONDITIONAL = law("W-27", { conditional: ["ui-components", "web-app"] });
const PLAIN = law("W-20");

const ids = (className: string, dependsOnAstro: boolean): string[] =>
  lawsOfProject([PLAIN, CONDITIONAL], className, dependsOnAstro).map((found) => found.id);

describe("the laws a class maps in a project", () => {
  it.each(["web-app", "ui-components"])(
    "leaves a conditional law out for a %s without Astro, and maps it with Astro",
    (className) => {
      expect(ids(className, false)).toEqual(["W-20"]);
      expect(ids(className, true)).toEqual(["W-20", "W-27"]);
    },
  );

  it("keeps it for a class that is not a conditional one, whatever the project depends on", () => {
    expect(ids("astro-site", false)).toEqual(["W-20", "W-27"]);
  });

  it("maps nothing to a class the law does not list, Astro or not", () => {
    expect(ids("node-service", true)).toEqual([]);
  });

  it("takes the conditional classes from the catalog: W-27's, and none for a law without", () => {
    const catalog = yamlCatalog();
    const find = (id: string): LawEntry | undefined => catalog.find((entry) => entry.id === id);
    expect(find("W-27")?.conditional).toEqual(["ui-components", "web-app"]);
    expect(find("W-20")).not.toHaveProperty("conditional");
  });
});

/** A process runner for a project that tracks nothing: git lists no file and ESLint answers for none. */
const exec: Exec = (command) =>
  Promise.resolve({
    code: 0,
    stdout: command === "git" ? "" : JSON.stringify({ ignored: {}, levels: {} }),
    stderr: "",
  });

function context(manifest: object): LayerContext {
  const cwd = tempDir();
  put(cwd, {
    "package.json": JSON.stringify(manifest),
    "out/eslint.json": "[]\n",
    "out/tsc.json": "[]\n",
  });
  return {
    cwd,
    config: cfg({ class: "web-app" }),
    base: "origin/main",
    enforce: "hard",
    env: {},
    exec,
    outDir: join(cwd, ".web-tops", "out"),
    artifacts: new Map([
      ["eslint-json", join(cwd, "out/eslint.json")],
      ["tsc-diagnostics", join(cwd, "out/tsc.json")],
    ]),
  };
}

async function reported(manifest: object): Promise<(readonly [string, boolean | undefined])[]> {
  const layer = lawsLayer(() => [PLAIN, CONDITIONAL], new Map());
  const result = await layer.run(context(manifest));
  return result.findings
    .filter((finding) => finding.rule.startsWith("law/"))
    .map((finding) => [finding.rule, finding.required] as const);
}

describe("the laws layer asks the project whether it depends on Astro", () => {
  it("gives a web-app without Astro no finding for the conditional law", async () => {
    expect(await reported({ name: "app", dependencies: { vite: "1" } })).toEqual([
      ["law/W-20", true],
    ]);
  });

  it.each(["dependencies", "devDependencies", "peerDependencies"])(
    "requires it once astro is in %s",
    async (field) => {
      expect(await reported({ name: "app", [field]: { astro: "7" } })).toEqual([
        ["law/W-20", true],
        ["law/W-27", true],
      ]);
    },
  );
});
