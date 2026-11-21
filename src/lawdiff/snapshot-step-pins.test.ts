import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Exec, ExecResult } from "../gate/types.ts";
import { cleanTemp, put, tempDir } from "../laws/probe/testkit.ts";
import { snapshotOf, stylePart } from "./snapshot.ts";
import type { Snapshot } from "./types.ts";

afterAll(cleanTemp);

const none = { source: [], style: [] };

const envOf = (options: { env?: Record<string, string | undefined> } | undefined) =>
  options?.env ?? {};

/** A git that lists `listing`, and tools that print nothing a reader can use, noting the files each was asked about. */
function lists(listing: ExecResult, asked: unknown[]): Exec {
  return (command, _args, options) => {
    if (command === "git") return Promise.resolve(listing);
    const path = envOf(options)["WEBTOPS_LAWDIFF_FILES"];
    if (path !== undefined) asked.push(JSON.parse(readFileSync(path, "utf8")));
    return Promise.resolve({ code: 1, stdout: "", stderr: "" });
  };
}

function project(files: Record<string, string>): string {
  const dir = tempDir();
  put(dir, files);
  return dir;
}

const runner = (cwd: string, exec: Exec) => ({ cwd, env: {}, exec, outDir: join(cwd, "out") });

const errorOf = (part: Snapshot["levels"]): string => (part.state === "error" ? part.message : "");

describe("the tracked files of a checkout", () => {
  it("are read from git's NUL-separated list, and each tool is asked about its own kind", async () => {
    const dir = project({
      "eslint.config.js": "export default [];\n",
      "stylelint.config.mjs": "export default {};\n",
    });
    const asked: unknown[] = [];
    const listing = { code: 0, stdout: "src/a.ts\0src/b.js\0lib/c.css\0README.md\0", stderr: "" };
    await snapshotOf(runner(dir, lists(listing, asked)), none);
    expect(asked).toEqual([["src/a.ts", "src/b.js"], ["lib/c.css"]]);
  });

  it("are an error, naming git's exit, for ESLint and for Stylelint, when git cannot list them", async () => {
    const dir = project({
      "eslint.config.js": "export default [];\n",
      "stylelint.config.mjs": "export default {};\n",
    });
    const listing = { code: 128, stdout: "src/a.ts\0", stderr: "" };
    const snap = await snapshotOf(runner(dir, lists(listing, [])), none);
    expect(errorOf(snap.levels)).toBe("git ls-files exited 128");
    expect(errorOf(snap.style)).toBe("git ls-files exited 128");
  });
});

describe("the CSS files Stylelint is asked about", () => {
  it("are the checkout's own and those of the other ref, each once, in that order, CSS only", async () => {
    const dir = project({ "stylelint.config.mjs": "export default {};\n" });
    const asked: unknown[] = [];
    const exec = lists({ code: 0, stdout: "", stderr: "" }, asked);
    const read = await stylePart(
      runner(dir, exec),
      ["a.css", "b.ts", "c.css"],
      ["x.css", "a.css", "y.js"],
    );
    expect(read.tracked).toEqual(["a.css", "c.css"]);
    expect(asked).toEqual([["a.css", "c.css", "x.css"]]);
  });
});

describe("a Stylelint config named by package.json", () => {
  const stateOf = async (manifest: string): Promise<string> => {
    const dir = project({ "package.json": manifest });
    const exec = lists({ code: 0, stdout: "", stderr: "" }, []);
    return (await stylePart(runner(dir, exec), ["a.css"], [])).part.state;
  };

  it("is there when the key is, whatever it holds", async () => {
    expect(await stateOf('{ "stylelint": {} }')).toBe("error");
    expect(await stateOf('{ "stylelint": null }')).toBe("error");
  });

  it("is not there when package.json has no such key, or is not an object at all", async () => {
    for (const manifest of ["{}", "null", "5", '"stylelint"', "[]", "true"]) {
      expect(await stateOf(manifest), manifest).toBe("absent");
    }
  });
});
