import { spawnSync } from "node:child_process";
import { symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseConfig } from "../config/validate.ts";
import type { WebTopsConfig } from "../config/types.ts";
import { budgetEntriesOf, compareBudgetSettings } from "./budgets.ts";
import { settingsOf } from "./settings.ts";
import { cleanTemp, put, tempDir } from "../laws/probe/testkit.ts";

afterAll(cleanTemp);

const HEAD = 'protocol: "0.3.0"\nversion: "1"\npackage: fixture\n';

function parse(extra: string, className: string): WebTopsConfig {
  const read = parseConfig(`${HEAD}class: ${className}\n${extra}`);
  if (!read.ok) throw new Error(JSON.stringify(read.problems));
  return read.value;
}

const pair = (baseExtra: string, headExtra: string, baseClass: string, headClass: string) =>
  compareBudgetSettings(settingsOf(parse(baseExtra, baseClass)), settingsOf(parse(headExtra, headClass)));

describe("effective byte budget law-diff comparisons", () => {
  it("node-service keeps explicit page_js without a class_js_ceiling row", () => {
    const cfg = parse("budgets:\n  page_js_bytes: 1000\n", "node-service");
    expect(budgetEntriesOf(cfg).has("budgets.class_js_ceiling")).toBe(false);
    expect(budgetEntriesOf(cfg).get("budgets.page_js_bytes")?.shown).toBe("1000");
  });
  it("B2: dropping a tighter budgets.pages override is weakened via the fallback ceiling", () => {
    const items = pair(
      'budgets:\n  page_js_bytes: 51200\n  pages:\n    "/x/": 1000\n',
      'budgets:\n  page_js_bytes: 51200\n',
      "astro-site",
      "astro-site",
    );
    expect(items).toContainEqual({
      what: 'budgets.pages./x/',
      change: "weakened",
      before: "1000",
      after: "51200",
    });
  });

  it("B2: dropping a tighter budgets.routes override is weakened via the fallback ceiling", () => {
    const items = pair(
      'budgets:\n  route_js_bytes: 51200\n  routes:\n    "/docs": 1000\n',
      'budgets:\n  route_js_bytes: 51200\n',
      "web-app",
      "web-app",
    );
    expect(items).toContainEqual({
      what: "budgets.routes./docs",
      change: "weakened",
      before: "1000",
      after: "51200",
    });
  });

  it("B2: dropping a tighter size_limit entry override is weakened via the fallback ceiling", () => {
    const items = pair(
      'layers:\n  size_limit:\n    default_bytes: 51200\n    entries:\n      "./x": 1000\n',
      'layers:\n  size_limit:\n    default_bytes: 51200\n',
      "ts-library",
      "ts-library",
    );
    expect(items).toContainEqual({
      what: "budgets.entries../x",
      change: "weakened",
      before: "1000",
      after: "51200",
    });
  });

  it("does not weaken when a loose budgets.pages override is removed", () => {
    const items = pair(
      'budgets:\n  pages:\n    "/": 900000\n',
      "",
      "web-app",
      "web-app",
    );
    const page = items.find((item) => item.what === "budgets.pages./");
    expect(page === undefined || page.change !== "weakened").toBe(true);
  });

  it("B4: ui-components to web-app raises the class JS ceiling in one compared key", () => {
    const items = pair("", "", "ui-components", "web-app");
    expect(items).toContainEqual({
      what: "budgets.class_js_ceiling",
      change: "weakened",
      before: "51200",
      after: "174080",
    });
  });

  it("B4: ts-library to web-app raises the class JS ceiling in one compared key", () => {
    const items = pair("", "", "ts-library", "web-app");
    expect(items).toContainEqual({
      what: "budgets.class_js_ceiling",
      change: "weakened",
      before: "51200",
      after: "174080",
    });
  });
});

const REPO = resolve(import.meta.dirname, "../..");
const MAIN = join(REPO, "src/cli/main.ts");
const SLOW = 120_000;

function git(cwd: string, ...args: string[]): void {
  const done = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
    encoding: "utf8",
  });
  if (done.status !== 0) throw new Error(`git ${args.join(" ")}: ${done.stderr}`);
}

function lawDiff(
  cwd: string,
  ...args: string[]
): { status: number | null; out: string; err: string } {
  const done = spawnSync("bun", [MAIN, "law-diff", "main", "feature", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, WEBTOPS_PROTOCOL_CHANGE_LABEL: "" },
  });
  return { status: done.status, out: done.stdout, err: done.stderr };
}

function budgetScratchRepo(baseYaml: string, headYaml: string): string {
  const dir = tempDir();
  symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
  put(dir, { "web-tops.yaml": baseYaml, ".gitignore": "node_modules\n" });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "switch", "-q", "-c", "feature");
  put(dir, { "web-tops.yaml": headYaml });
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "head");
  return dir;
}

describe("webtops law-diff on scratch repos (byte budgets)", () => {
  const astroB2Base = `protocol: "0.3.0"
version: "1"
package: fixture
class: astro-site
budgets:
  page_js_bytes: 51200
  pages:
    "/x/": 1000
`;
  const astroB2Head = `protocol: "0.3.0"
version: "1"
package: fixture
class: astro-site
budgets:
  page_js_bytes: 51200
`;

  it(
    "refuses B2 astro pages override removal on a real law-diff run",
    () => {
      const dir = budgetScratchRepo(astroB2Base, astroB2Head);
      const refused = lawDiff(dir);
      expect(refused.status).toBe(1);
      expect(refused.out).toContain("weakened: budgets.pages./x/: 1000 -> 51200");
      cleanTemp();
    },
    SLOW,
  );

  const webAppRoutesB2Base = `protocol: "0.3.0"
version: "1"
package: fixture
class: web-app
budgets:
  route_js_bytes: 51200
  routes:
    "/docs": 1000
`;
  const webAppRoutesB2Head = `protocol: "0.3.0"
version: "1"
package: fixture
class: web-app
budgets:
  route_js_bytes: 51200
`;

  it(
    "refuses B2 web-app routes override removal on a real law-diff run",
    () => {
      const dir = budgetScratchRepo(webAppRoutesB2Base, webAppRoutesB2Head);
      const refused = lawDiff(dir);
      expect(refused.status).toBe(1);
      expect(refused.out).toContain("weakened: budgets.routes./docs: 1000 -> 51200");
      cleanTemp();
    },
    SLOW,
  );

  const entryB2Base = `protocol: "0.3.0"
version: "1"
package: fixture
class: ts-library
layers:
  size_limit:
    default_bytes: 51200
    entries:
      "./x": 1000
`;
  const entryB2Head = `protocol: "0.3.0"
version: "1"
package: fixture
class: ts-library
layers:
  size_limit:
    default_bytes: 51200
`;

  it(
    "refuses B2 size_limit entry override removal on a real law-diff run",
    () => {
      const dir = budgetScratchRepo(entryB2Base, entryB2Head);
      const refused = lawDiff(dir);
      expect(refused.status).toBe(1);
      expect(refused.out).toContain("weakened: budgets.entries../x: 1000 -> 51200");
      cleanTemp();
    },
    SLOW,
  );

  const b4Base = `protocol: "0.3.0"
version: "1"
package: fixture
class: ui-components
`;
  const b4Head = `protocol: "0.3.0"
version: "1"
package: fixture
class: web-app
`;

  it(
    "refuses B4 ui-components to web-app class ceiling rise on a real law-diff run",
    () => {
      const dir = budgetScratchRepo(b4Base, b4Head);
      const refused = lawDiff(dir);
      expect(refused.status).toBe(1);
      expect(refused.out).toContain("weakened: budgets.class_js_ceiling: 51200 -> 174080");
      cleanTemp();
    },
    SLOW,
  );
});