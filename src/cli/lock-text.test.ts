import { rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { fakeHost, madeDirs, put, tempDir } from "../init/test-support.ts";
import { NODE_RANGE } from "../lock/pins.ts";
import { runLockCli } from "./lock.ts";

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

async function verify(cwd: string) {
  let out = "";
  let err = "";
  const code = await runLockCli(["--verify"], {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd,
    env: fakeHost({ node: "v24.22.3" }),
  });
  return { code, out, err };
}

function project(eslint: string, typescript: string): string {
  const dir = tempDir();
  put(dir, "web-tops.lock", `eslint: 9.39.5\nnode: "${NODE_RANGE}"\ntypescript: 6.0.3\n`);
  put(dir, "node_modules/eslint/package.json", JSON.stringify({ version: eslint }));
  put(dir, "node_modules/typescript/package.json", JSON.stringify({ version: typescript }));
  return dir;
}

describe("webtops lock --verify: what it prints", () => {
  it("says one difference in the singular", async () => {
    const { code, out, err } = await verify(project("9.39.5", "6.0.2"));
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toBe(
      "webtops lock: 1 difference from web-tops.lock (W-41)\n  typescript: locked 6.0.3, installed 6.0.2\n",
    );
  });

  it("says two differences in the plural", async () => {
    const { code, err } = await verify(project("9.39.4", "6.0.2"));
    expect(code).toBe(2);
    expect(err).toBe(
      [
        "webtops lock: 2 differences from web-tops.lock (W-41)",
        "  eslint: locked 9.39.5, installed 9.39.4",
        "  typescript: locked 6.0.3, installed 6.0.2",
        "",
      ].join("\n"),
    );
  });
});
