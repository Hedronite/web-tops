import { createHash } from "node:crypto";
import { readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { fakeHost, madeDirs, put, tempDir } from "../init/test-support.ts";
import { parseLock } from "../lock/format.ts";
import { NODE_RANGE, TOOL_PINS } from "../lock/pins.ts";
import { runLockCli } from "./lock.ts";

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

const GOOD_NODE = fakeHost({ node: "v24.22.3" });

async function cli(argv: readonly string[], cwd: string, env: Record<string, string> = GOOD_NODE) {
  let out = "";
  let err = "";
  const code = await runLockCli(argv, {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd,
    env,
  });
  return { code, out, err };
}

function install(dir: string, tool: string, version: string): void {
  put(dir, `node_modules/${tool}/package.json`, JSON.stringify({ name: tool, version }));
}

const DEFAULT_LOCK = `eslint: 9.39.5\nnode: "${NODE_RANGE}"\ntypescript: 6.0.3\nwebtops: ${pkg.version}\n`;

/** A project whose lock names typescript and eslint, with both installed (typescript at `typescript`, or not at all for null). */
function project(lock = DEFAULT_LOCK, typescript: string | null = "6.0.3"): string {
  const dir = tempDir();
  put(dir, "web-tops.lock", lock);
  install(dir, "eslint", "9.39.5");
  if (typescript !== null) install(dir, "typescript", typescript);
  return dir;
}

const STRYKER = [
  "@stryker-mutator/core",
  "@stryker-mutator/typescript-checker",
  "@stryker-mutator/vitest-runner",
] as const;

/** The lock file in `dir`, parsed; an empty map when it does not parse. */
function lockOf(dir: string): Record<string, string> {
  const parsed = parseLock(readFileSync(join(dir, "web-tops.lock"), "utf8"));
  return parsed.ok ? { ...parsed.lock } : {};
}

const digest = (dir: string): string =>
  createHash("sha256")
    .update(readFileSync(join(dir, "web-tops.lock")))
    .digest("hex");

describe("webtops lock --verify", () => {
  it("exits 0 when every installed version matches the lock and Node is in its range", async () => {
    const { code, out, err } = await cli(["--verify"], project());
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("3 tools");
    expect(out).toContain("24.22.3");
  });

  it("exits 2 on a planted version mismatch and names the tool, the locked and the installed version", async () => {
    const { code, err } = await cli(["--verify"], project(undefined, "6.0.2"));
    expect(code).toBe(2);
    expect(err).toContain("typescript");
    expect(err).toContain("6.0.3");
    expect(err).toContain("6.0.2");
  });

  it("reports every mismatch, not only the first", async () => {
    const dir = project(undefined, "6.0.2");
    install(dir, "eslint", "9.39.4");
    const { err } = await cli(["--verify"], dir);
    expect(err).toContain("typescript");
    expect(err).toContain("eslint");
  });

  it("exits 2 when a locked tool is not installed", async () => {
    const { code, err } = await cli(["--verify"], project(undefined, null));
    expect(code).toBe(2);
    expect(err).toContain("typescript");
    expect(err).toContain("not installed");
  });

  it("exits 2 when the webtops entry differs from the running version", async () => {
    const dir = project(`typescript: 6.0.3\nwebtops: 9.9.9\n`);
    const { code, err } = await cli(["--verify"], dir);
    expect(code).toBe(2);
    expect(err).toContain("webtops");
  });

  it("exits 2 and points at init when there is no web-tops.lock", async () => {
    const { code, err } = await cli(["--verify"], tempDir());
    expect(code).toBe(2);
    expect(err).toContain("webtops init");
  });

  it.each([
    ["range", "typescript: ^6.0.0\n"],
    ["empty", "# nothing\n"],
    ["not a map", "- a\n"],
  ])("exits 2 on a %s lock", async (_name, lock) => {
    expect((await cli(["--verify"], project(lock))).code).toBe(2);
  });

  it("never changes the lock", async () => {
    const dir = project(undefined, "6.0.2");
    const before = digest(dir);
    await cli(["--verify"], dir);
    expect(digest(dir)).toBe(before);
  });

  it("acts as --verify when no flag is given, and does not write", async () => {
    const dir = project(undefined, "6.0.2");
    const before = digest(dir);
    expect((await cli([], dir)).code).toBe(2);
    expect(digest(dir)).toBe(before);
    expect((await cli([], project())).code).toBe(0);
  });

  it.each([[["--verify", "--update"]], [["--verify", "--verify"]], [["--wat"]], [["extra"]]])(
    "exits 2 for the arguments %j",
    async (argv) => {
      const { code, err } = await cli(argv, project());
      expect(code).toBe(2);
      expect(err).toContain("usage: webtops lock");
    },
  );
});

describe("webtops lock --verify, the Node range", () => {
  it.each([
    ["22.23.3", 2],
    ["22.23.4", 0],
    ["23.9.9", 2],
    ["24.14.9", 2],
    ["24.15.0", 0],
    ["25.9.9", 2],
    ["26.0.0", 0],
  ])("with Node %s on the PATH exits %i", async (node, expected) => {
    expect((await cli(["--verify"], project(), fakeHost({ node: `v${node}` }))).code).toBe(
      expected,
    );
  });

  it("names node, the version running and the range the lock records", async () => {
    const { code, err } = await cli(["--verify"], project(), fakeHost({ node: "v22.23.3" }));
    expect(code).toBe(2);
    expect(err).toContain("node");
    expect(err).toContain("22.23.3");
    expect(err).toContain(NODE_RANGE);
  });

  it("exits 2 when there is no Node on the PATH", async () => {
    const { code, err } = await cli(["--verify"], project(), fakeHost({}));
    expect(code).toBe(2);
    expect(err).toContain("node");
  });

  it("uses the range the lock records, not the protocol's", async () => {
    const dir = project('node: ">=26"\ntypescript: 6.0.3\nwebtops: 0.0.0\n');
    expect((await cli(["--verify"], dir, fakeHost({ node: "v24.22.3" }))).code).toBe(2);
  });

  it("exits 2 with the fix when the lock records no node range, whatever Node is running", async () => {
    const dir = project(`eslint: 9.39.5\ntypescript: 6.0.3\nwebtops: ${pkg.version}\n`);
    for (const node of ["v24.22.3", "v23.1.0"]) {
      const { code, err } = await cli(["--verify"], dir, fakeHost({ node }));
      expect(code).toBe(2);
      expect(err).toContain("web-tops.lock has no node range; run webtops lock --update");
    }
  });

  it("reports a tool mismatch and a Node mismatch together", async () => {
    const dir = project(undefined, "6.0.2");
    const { err } = await cli(["--verify"], dir, fakeHost({ node: "v22.23.3" }));
    expect(err).toContain("typescript");
    expect(err).toContain("node");
  });
});

describe("webtops lock --update", () => {
  it("writes the installed versions, sorted, and is the only command that does", async () => {
    const dir = project(undefined, "6.0.4");
    const { code, out } = await cli(["--update"], dir);
    expect(code).toBe(0);
    expect(out).toContain("typescript");
    expect(parseLock(readFileSync(join(dir, "web-tops.lock"), "utf8"))).toEqual({
      ok: true,
      lock: { eslint: "9.39.5", node: NODE_RANGE, typescript: "6.0.4", webtops: pkg.version },
    });
    expect((await cli(["--verify"], dir)).code).toBe(0);
  });

  it("adds an installed pinned tool the lock does not name, and says it is new", async () => {
    const dir = project();
    install(dir, "vitest", "5.1.0");
    const { code, out } = await cli(["--update"], dir);
    expect(code).toBe(0);
    expect(out).toContain("vitest (new) -> 5.1.0");
    expect(lockOf(dir)).toEqual({
      eslint: "9.39.5",
      node: NODE_RANGE,
      typescript: "6.0.3",
      vitest: "5.1.0",
      webtops: pkg.version,
    });
  });

  it("adds the three Stryker pins a lock never named, and --verify then passes", async () => {
    const dir = project();
    for (const tool of STRYKER) install(dir, tool, "10.1.1");
    await cli(["--update"], dir);
    const lock = lockOf(dir);
    for (const tool of STRYKER) expect(lock[tool]).toBe("10.1.1");
    expect((await cli(["--verify"], dir)).code).toBe(0);
  });

  it("adds a pinned tool the package.json declares, and not one that is only hoisted", async () => {
    const dir = project();
    put(dir, "package.json", JSON.stringify({ devDependencies: { vitest: "5.1.0" } }));
    install(dir, "vitest", "5.1.0");
    install(dir, "zod", "4.6.7");
    await cli(["--update"], dir);
    const lock = lockOf(dir);
    expect(lock["vitest"]).toBe("5.1.0");
    expect(lock["zod"]).toBeUndefined();
  });

  it("does not add a library the package.json depends on, exact or not", async () => {
    const dir = project();
    put(dir, "package.json", JSON.stringify({ dependencies: { exact: "1.2.3", loose: "^1.0.0" } }));
    install(dir, "exact", "1.2.3");
    install(dir, "loose", "1.4.0");
    await cli(["--update"], dir);
    expect(Object.keys(lockOf(dir))).toEqual(["eslint", "node", "typescript", "webtops"]);
  });

  it("exits 3 and writes nothing when package.json is not valid JSON", async () => {
    const dir = project();
    put(dir, "package.json", "{ not json");
    const before = digest(dir);
    const { code, err } = await cli(["--update"], dir);
    expect(code).toBe(3);
    expect(err).toContain("package.json");
    expect(digest(dir)).toBe(before);
  });

  it("skips a pinned tool that is not installed: exit 0 and no entry for it", async () => {
    const dir = project();
    const { code, err } = await cli(["--update"], dir);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(Object.keys(lockOf(dir))).toEqual(["eslint", "node", "typescript", "webtops"]);
  });

  it("keeps a name the lock holds that neither pins.ts nor package.json names, refreshed", async () => {
    const dir = project(`${DEFAULT_LOCK}by-hand: 1.0.0\n`);
    install(dir, "by-hand", "1.0.1");
    await cli(["--update"], dir);
    expect(lockOf(dir)["by-hand"]).toBe("1.0.1");
  });

  it("replaces a version seeded as 0.0.0 with the installed one", async () => {
    const dir = project(`${DEFAULT_LOCK}vitest: 0.0.0\n`);
    install(dir, "vitest", "5.1.0");
    const { out } = await cli(["--update"], dir);
    expect(out).toContain("vitest 0.0.0 -> 5.1.0");
    expect(lockOf(dir)["vitest"]).toBe("5.1.0");
  });

  it("records the installed version of a pinned tool even where it differs from the pin", async () => {
    const dir = project();
    install(dir, "vitest", "5.9.9");
    await cli(["--update"], dir);
    expect(lockOf(dir)["vitest"]).toBe("5.9.9");
  });

  it("is a no-op the second time: same bytes, and it says so", async () => {
    const dir = project();
    install(dir, "vitest", "5.1.0");
    await cli(["--update"], dir);
    const once = digest(dir);
    const { out } = await cli(["--update"], dir);
    expect(digest(dir)).toBe(once);
    expect(out).toContain("already matches");
  });

  it("adds webtops at the running version when the lock does not name it", async () => {
    const dir = project("eslint: 9.39.5\ntypescript: 6.0.3\n");
    await cli(["--update"], dir);
    expect(lockOf(dir)["webtops"]).toBe(pkg.version);
  });

  it("keeps the Node range the lock records, and adds the protocol's when it records none", async () => {
    const kept = project('node: ">=26"\ntypescript: 6.0.3\nwebtops: 0.0.0\n');
    await cli(["--update"], kept);
    const keptLock = parseLock(readFileSync(join(kept, "web-tops.lock"), "utf8"));
    expect(keptLock.ok && keptLock.lock["node"]).toBe(">=26");
    const bare = project("typescript: 6.0.3\nwebtops: 0.0.0\n");
    await cli(["--update"], bare);
    const bareLock = parseLock(readFileSync(join(bare, "web-tops.lock"), "utf8"));
    expect(bareLock.ok && bareLock.lock["node"]).toBe(NODE_RANGE);
  });

  it("does not ask which Node is running", async () => {
    expect((await cli(["--update"], project(), fakeHost({ node: "v22.0.0" }))).code).toBe(0);
    expect((await cli(["--update"], project(), fakeHost({}))).code).toBe(0);
  });

  it("writes nothing and exits 3 when a locked tool is not installed", async () => {
    const dir = project(undefined, null);
    const before = digest(dir);
    const { code, err } = await cli(["--update"], dir);
    expect(code).toBe(3);
    expect(err).toContain("typescript");
    expect(digest(dir)).toBe(before);
  });

  it("exits 2 and writes nothing when there is no lock to update", async () => {
    const dir = tempDir();
    expect((await cli(["--update"], dir)).code).toBe(2);
    expect(() => readFileSync(join(dir, "web-tops.lock"))).toThrow();
  });

  it("sets webtops to the running version", async () => {
    const dir = project("eslint: 9.39.5\nwebtops: 9.9.9\n");
    await cli(["--update"], dir);
    const parsed = parseLock(readFileSync(join(dir, "web-tops.lock"), "utf8"));
    expect(parsed.ok && parsed.lock["webtops"]).toBe(pkg.version);
  });
});

describe("webtops lock --verify: a pinned, installed tool the lock does not name (W-41)", () => {
  it("fails, naming the tool, and says where it is pinned", async () => {
    const dir = project();
    install(dir, "vitest", "5.1.0");
    const { code, err } = await cli(["--verify"], dir);
    expect(code).toBe(2);
    expect(err).toContain(
      "vitest: installed 5.1.0, pinned in section 2, missing from web-tops.lock",
    );
    expect(err).toContain("1 difference");
  });

  it("counts it beside the other differences", async () => {
    const dir = project(undefined, "6.0.2");
    install(dir, "vitest", "5.1.0");
    expect((await cli(["--verify"], dir)).err).toContain("2 differences");
  });

  it("passes once --update has added it", async () => {
    const dir = project();
    install(dir, "vitest", "5.1.0");
    await cli(["--update"], dir);
    expect((await cli(["--verify"], dir)).code).toBe(0);
  });

  it("says nothing of a pinned tool the package.json does not declare, even when it is installed", async () => {
    const dir = project();
    put(dir, "package.json", JSON.stringify({ devDependencies: { eslint: "9.39.5" } }));
    install(dir, "zod", "4.6.7");
    expect((await cli(["--verify"], dir)).code).toBe(0);
  });

  it("says nothing of a pinned tool that is not installed, or an installed one pins.ts does not pin", async () => {
    const dir = project();
    install(dir, "ajv", "8.20.0");
    const { code, err } = await cli(["--verify"], dir);
    expect(code).toBe(0);
    expect(err).toBe("");
  });

  it("removes one entry from a complete lock and fails on exactly that tool", async () => {
    const dir = project();
    install(dir, "vitest", "5.1.0");
    await cli(["--update"], dir);
    put(
      dir,
      "web-tops.lock",
      readFileSync(join(dir, "web-tops.lock"), "utf8").replace(/^vitest: .*\n/m, ""),
    );
    const { code, err } = await cli(["--verify"], dir);
    expect(code).toBe(2);
    expect(err).toContain("vitest: installed 5.1.0");
  });
});

describe("webtops lock on this kit", () => {
  const KIT = join(import.meta.dirname, "..", "..");

  /** A project that holds the kit's own lock and package.json and reads the kit's own node_modules. */
  function kitCopy(): string {
    const dir = tempDir();
    put(dir, "web-tops.lock", readFileSync(join(KIT, "web-tops.lock"), "utf8"));
    put(dir, "package.json", readFileSync(join(KIT, "package.json"), "utf8"));
    symlinkSync(join(KIT, "node_modules"), join(dir, "node_modules"), "dir");
    return dir;
  }

  it("--update adds only tools pins.ts pins, never a library or a type package", async () => {
    const dir = kitCopy();
    const before = lockOf(dir);
    const { code } = await cli(["--update"], dir);
    expect(code).toBe(0);
    const added = Object.keys(lockOf(dir)).filter((tool) => before[tool] === undefined);
    for (const tool of added) expect(TOOL_PINS, tool).toHaveProperty(tool);
    for (const tool of added)
      expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }), tool).toContain(tool);
    for (const name of ["ajv", "yaml", "@types/bun"])
      expect(lockOf(dir)[name], name).toBeUndefined();
  });

  it("--update is a no-op on the kit's own lock, and --verify passes", async () => {
    const dir = kitCopy();
    const before = digest(dir);
    expect((await cli(["--update"], dir)).out).toContain("already matches");
    expect(digest(dir)).toBe(before);
    expect((await cli(["--verify"], dir)).code).toBe(0);
  });
});
