import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { fakeHost, madeDirs, put, tempDir } from "../init/test-support.ts";
import { parseLock } from "../lock/format.ts";
import { NODE_RANGE } from "../lock/pins.ts";
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

  it("falls back to the protocol's range when the lock records none", async () => {
    const dir = project(`typescript: 6.0.3\nwebtops: ${pkg.version}\n`);
    expect((await cli(["--verify"], dir, fakeHost({ node: "v24.22.3" }))).code).toBe(0);
    expect((await cli(["--verify"], dir, fakeHost({ node: "v23.1.0" }))).code).toBe(2);
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

  it("keeps the set of tools the lock already names", async () => {
    const dir = project();
    install(dir, "vitest", "5.1.0");
    await cli(["--update"], dir);
    const parsed = parseLock(readFileSync(join(dir, "web-tops.lock"), "utf8"));
    expect(parsed.ok && Object.keys(parsed.lock)).toEqual([
      "eslint",
      "node",
      "typescript",
      "webtops",
    ]);
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
