import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { profileFor } from "../config/profiles.ts";
import { at, get, keys, matching } from "../config/test-support.ts";
import { checkConfigFile, parseYaml } from "../config/validate.ts";

const root = resolve(import.meta.dirname, "../..");

function yamlOf(name: string): unknown {
  const parsed = parseYaml(readFileSync(join(root, name), "utf8"));
  expect(parsed.ok, name).toBe(true);
  return parsed.ok ? parsed.value : undefined;
}

describe("G7a: the kit's own web-tops.yaml", () => {
  it("passes check as class ts-library under enforce hard", () => {
    const result = checkConfigFile(join(root, "web-tops.yaml"));
    expect(result.ok).toBe(true);
    expect(get(get(result, "value"), "class")).toBe("ts-library");
    expect(get(get(result, "value"), "enforce")).toBe("hard");
  });

  it.each([
    [["gates", "crap"], "M2"],
    [["gates", "mutation"], "M2"],
    [["laws"], "M3"],
    [["layers", "size_limit"], "M4"],
    [["layers", "html_validate"], "M4"],
    [["layers", "axe"], "M4"],
    [["layers", "rendered"], "M4"],
    [["layers", "themes"], "M4"],
  ])("%j is off, and its reason names %s", (path, milestone) => {
    const entry = at(yamlOf("web-tops.yaml"), path);
    expect(get(entry, "enabled")).toBe(false);
    expect(get(entry, "reason")).toMatch(new RegExp(`^${milestone}\\b`));
  });

  it("keeps every layer that M1 builds on", () => {
    const config = yamlOf("web-tops.yaml");
    for (const gate of ["hygiene", "tests", "coverage"]) {
      expect(get(at(config, ["gates", gate]), "enabled"), gate).not.toBe(false);
    }
    expect(get(at(config, ["layers", "package_exports"]), "enabled")).not.toBe(false);
    expect(at(config, ["layers", "package_exports", "tier"])).toBe(1);
  });

  it("holds the class floor and the TypeScript pin of package.json", () => {
    const config = yamlOf("web-tops.yaml");
    expect(at(config, ["gates", "coverage", "lines_floor"])).toBe(
      profileFor("ts-library")?.linesFloor,
    );
    expect(at(config, ["toolchain", "typescript"])).toBe(pkg.devDependencies.typescript);
    expect(get(config, "version")).toBe(pkg.version);
  });
});

describe("G7d: AGENTS.md says where the repo stands", () => {
  const state = (): string => {
    const text = readFileSync(join(root, "AGENTS.md"), "utf8");
    return text.slice(text.indexOf("## State"), text.indexOf("## Do this"));
  };

  it("records M1 and how to run the gate, and no longer says there is no code", () => {
    expect(state()).toContain("Milestone M1");
    expect(state()).toContain("bun src/cli/main.ts");
    expect(state()).not.toMatch(/no code|does not exist|no CLI/);
  });

  it("names the commands that have not landed, and only those", () => {
    for (const command of ["baseline", "survivors", "laws"]) expect(state()).toContain(command);
  });
});

describe("G7b: CI is the one gate job", () => {
  const workflow = (): unknown => yamlOf(".github/workflows/web-tops.yml");
  const steps = (): unknown[] => {
    const list = at(workflow(), ["jobs", "gate", "steps"]);
    return keys(list).map((index) => get(list, index));
  };

  it("replaces ci.yml", () => {
    expect(existsSync(join(root, ".github/workflows/ci.yml"))).toBe(false);
    expect(existsSync(join(root, ".github/workflows/web-tops.yml"))).toBe(true);
  });

  it("has one job, named gate, on ubuntu-latest", () => {
    expect(keys(get(workflow(), "jobs"))).toEqual(["gate"]);
    expect(at(workflow(), ["jobs", "gate", "runs-on"])).toBe("ubuntu-latest");
  });

  it("runs the frozen install and one command, the gate at tier 1, and nothing else", () => {
    const commands = steps()
      .map((step) => get(step, "run"))
      .filter((command) => command !== undefined);
    expect(commands).toEqual([
      "bun install --frozen-lockfile",
      "bun src/cli/main.ts gate --max-tier 1",
    ]);
  });

  it("pins every action by full commit SHA", () => {
    const used = steps()
      .map((step) => get(step, "uses"))
      .filter((value) => value !== undefined);
    expect(used).toHaveLength(2);
    for (const action of used) expect(action).toEqual(matching(/^[\w./-]+@[0-9a-f]{40}$/));
  });

  it("checks out with full history, no stored credentials, and minimal permissions", () => {
    const checkout = steps().find((step) =>
      String(get(step, "uses")).startsWith("actions/checkout@"),
    );
    expect(at(checkout, ["with", "fetch-depth"])).toBe(0);
    expect(at(checkout, ["with", "persist-credentials"])).toBe(false);
    expect(get(workflow(), "permissions")).toEqual({ contents: "read" });
  });

  it("runs on pull requests and on pushes to main", () => {
    expect(keys(get(workflow(), "on")).sort()).toEqual(["pull_request", "push"]);
    expect(at(workflow(), ["on", "push", "branches"])).toEqual(["main"]);
  });
});

describe("G7: web-tops.lock draft pins exact versions", () => {
  it("lists webtops at the package version and every tool at its package.json pin", () => {
    const lock = yamlOf("web-tops.lock");
    const pins: Record<string, unknown> = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(get(lock, "webtops")).toBe(pkg.version);
    for (const name of keys(lock).filter((key) => key !== "webtops")) {
      expect(get(lock, name), name).toBe(pins[name]);
    }
  });

  it("covers the section 2 tools the kit installs", () => {
    const lock = keys(yamlOf("web-tops.lock"));
    for (const name of [
      "typescript",
      "eslint",
      "typescript-eslint",
      "vitest",
      "@vitest/coverage-v8",
      "prettier",
      "dependency-cruiser",
      "publint",
      "@arethetypeswrong/cli",
    ]) {
      expect(lock, name).toContain(name);
    }
  });
});

describe("G7: .dependency-cruiser.cjs", () => {
  const made: string[] = [];
  const depcruise = join(root, "node_modules/.bin/depcruise");
  const config = join(root, ".dependency-cruiser.cjs");

  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function project(files: Readonly<Record<string, string>>, devDependencies = {}): string {
    const dir = mkdtempSync(join(tmpdir(), "wt-depcruise-"));
    made.push(dir);
    const base = { name: "probe", version: "0.0.0", type: "module" };
    writeFileSync(join(dir, "package.json"), JSON.stringify({ ...base, devDependencies }));
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "preserve",
          moduleResolution: "bundler",
          allowImportingTsExtensions: true,
          noEmit: true,
        },
        include: ["src"],
      }),
    );
    symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    return dir;
  }

  function cruise(cwd: string): { status: number | null; out: string } {
    const result = spawnSync(depcruise, ["src", "--config", config], { cwd, encoding: "utf8" });
    return { status: result.status, out: result.stdout + result.stderr };
  }

  it("finds no violation in the kit", () => {
    const { status, out } = cruise(root);
    expect(out).toContain("no dependency violations found");
    expect(status).toBe(0);
  }, 30_000);

  it("passes a clean probe project", () => {
    const dir = project({
      "src/a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
      "src/b.ts": "export const b = 1;\n",
    });
    expect(cruise(dir).status).toBe(0);
  }, 30_000);

  it.each([
    [
      "no-circular",
      {
        "src/a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
        "src/b.ts": 'import { a } from "./a.ts";\nexport const b = a;\n',
      },
    ],
    [
      "config-below-cli",
      {
        "src/config/x.ts": 'import { y } from "../cli/y.ts";\nexport const x = y;\n',
        "src/cli/y.ts": "export const y = 1;\n",
      },
    ],
    [
      "not-to-test",
      {
        "src/p.ts": 'import { t } from "./p.test.ts";\nexport const p = t;\n',
        "src/p.test.ts": "export const t = 1;\n",
      },
    ],
    [
      "not-to-unresolvable",
      { "src/p.ts": 'import { m } from "./missing.ts";\nexport const p = m;\n' },
    ],
    [
      "no-non-package-json",
      { "src/p.ts": 'import { parse } from "yaml";\nexport const p = parse;\n' },
    ],
  ])(
    "refuses %s",
    (rule, files) => {
      const { status, out } = cruise(project(files));
      expect(out).toContain(rule);
      expect(status).not.toBe(0);
    },
    30_000,
  );

  it("refuses production code that imports a devDependency", () => {
    const dir = project(
      { "src/p.ts": 'import { it } from "vitest";\nexport const p = it;\n' },
      { vitest: "5.1.0" },
    );
    const { status, out } = cruise(dir);
    expect(out).toContain("not-to-dev-dependency");
    expect(status).not.toBe(0);
  }, 30_000);
});
