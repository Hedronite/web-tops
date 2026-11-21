import { copyFileSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Exec, ExecResult } from "../gate/types.ts";
import { cleanTemp, put, tempDir } from "../laws/probe/testkit.ts";
import { levelsPart, profileOf, snapshotOf, toolsPart } from "./snapshot.ts";
import type { Snapshot } from "./types.ts";

afterAll(cleanTemp);

const REPO = resolve(import.meta.dirname, "../..");
const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: "" });

function runner(cwd: string, exec: Exec): Parameters<typeof levelsPart>[0] {
  return { cwd, env: {}, exec, outDir: join(cwd, ".web-tops", "out") };
}

const shown = (part: Snapshot["flags"], key: string): string | undefined =>
  part.state === "ok" ? part.value.get(key)?.shown : undefined;

function profileSummary(part: Snapshot["profile"]): [string, string[], boolean] | undefined {
  if (part.state !== "ok") return undefined;
  return [part.value.className, [...part.value.required], part.value.layers.has("size_limit")];
}

const answering =
  (git: ExecResult, node: ExecResult): Exec =>
  (command) =>
    Promise.resolve(command === "git" ? git : node);

describe("the ESLint levels of a checkout", () => {
  it("are none when the project has no ESLint config", async () => {
    const dir = tempDir();
    expect(await levelsPart(runner(dir, answering(ok(""), ok(""))), [])).toEqual({
      tracked: [],
      levels: { state: "absent" },
    });
  });

  it("are what the project's ESLint says for each tracked source file", async () => {
    const dir = tempDir();
    put(dir, { "eslint.config.js": "export default [];\n" });
    const answer = JSON.stringify({ rules: { "src/a.ts": { r: { level: 2, options: "[]" } } } });
    const seen: string[][] = [];
    const exec: Exec = (command, args) => {
      seen.push([command, ...args.slice(0, 1)]);
      return Promise.resolve(command === "git" ? ok("src/a.ts\0README.md\0") : ok(answer));
    };
    const read = await levelsPart(runner(dir, exec), []);
    expect(read.levels).toEqual({
      state: "ok",
      value: new Map([["src/a.ts", new Map([["r", { level: 2, options: "[]" }]])]]),
    });
    expect(read.tracked).toEqual(["src/a.ts"]);
    expect(seen[0]).toEqual(["git", "ls-files"]);
  });

  it("are also asked about the files of the other ref, source files only, once each", async () => {
    const dir = tempDir();
    put(dir, { "eslint.config.js": "export default [];\n" });
    const asked: unknown[] = [];
    const exec: Exec = (command, _args, options) => {
      if (command === "git") return Promise.resolve(ok("src/a.ts\0"));
      asked.push(JSON.parse(readFileSync(String(options?.env?.["WEBTOPS_LAWDIFF_FILES"]), "utf8")));
      return Promise.resolve(ok(JSON.stringify({ rules: {} })));
    };
    const read = await levelsPart(runner(dir, exec), ["src/new.ts", "src/a.ts", "README.md"]);
    expect(asked).toEqual([["src/a.ts", "src/new.ts"]]);
    expect(read.tracked).toEqual(["src/a.ts"]);
  });

  it("are an error, with the reason, when git cannot list the files or ESLint cannot be asked", async () => {
    const dir = tempDir();
    put(dir, { "eslint.config.js": "export default [];\n" });
    const noGit = answering({ code: 128, stdout: "", stderr: "" }, ok(""));
    expect(await levelsPart(runner(dir, noGit), [])).toEqual({
      tracked: [],
      levels: { state: "error", message: "git ls-files exited 128" },
    });
    const noEslint = answering(ok("src/a.ts\0"), {
      code: 1,
      stdout: "",
      stderr: "config did not load",
    });
    const failed = (await levelsPart(runner(dir, noEslint), [])).levels;
    expect(failed.state).toBe("error");
    expect(failed.state === "error" && failed.message.includes("config did not load")).toBe(true);
  });
});

describe("the other surfaces of a checkout", () => {
  it("are none in a folder that has none of them", async () => {
    const snap = await snapshotOf(runner(tempDir(), answering(ok(""), ok(""))), []);
    expect(snap).toEqual({
      tracked: [],
      tools: { state: "absent" },
      levels: { state: "absent" },
      flags: { state: "absent" },
      settings: { state: "absent" },
      laws: { state: "absent" },
      profile: { state: "absent" },
    });
  });

  it("are read from the files: compiler flags, settings, laws and the class's profile", async () => {
    const dir = tempDir();
    symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
    mkdirSync(join(dir, "laws"));
    copyFileSync(join(REPO, "laws/W-01.yaml"), join(dir, "laws/W-01.yaml"));
    put(dir, {
      "tsconfig.json": '{ "compilerOptions": { "strict": true }, "include": ["src"] }\n',
      "src/a.ts": "export const a = 1;\n",
      "web-tops.yaml": 'protocol: "0.3.0"\nversion: "1"\npackage: fixture\nclass: ts-library\n',
    });
    const snap = await snapshotOf(runner(dir, answering(ok(""), ok(""))), []);
    expect(shown(snap.flags, "tsconfig.json: strict")).toBe("true");
    expect(
      snap.settings.state === "ok" && snap.settings.value.values.get("gates.crap.cap")?.shown,
    ).toBe("4");
    expect(snap.laws.state === "ok" && [...snap.laws.value.keys()]).toEqual(["W-01"]);
    expect(profileSummary(snap.profile)).toEqual(["ts-library", ["W-01"], true]);
  });

  it("are an error that names the problem when a file cannot be read, never a quiet pass", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, "laws"));
    put(dir, {
      "laws/W-01.yaml": "id: W-01\n",
      "tsconfig.json": "{ not json",
      "web-tops.yaml": "class: [\n",
    });
    const snap = await snapshotOf(runner(dir, answering(ok(""), ok(""))), []);
    expect(snap.flags.state).toBe("error");
    expect(snap.settings.state).toBe("error");
    expect(snap.profile.state).toBe("error");
    expect(snap.laws.state === "error" && snap.laws.message.includes("W-01.yaml")).toBe(true);
  });
});

/** A lock parser that stands in for the kit's, so these tests cover no code of the lock: `name: version` lines, or `bad`. */
const fakeParse: NonNullable<Parameters<typeof toolsPart>[1]> = (text) => {
  if (text.startsWith("bad")) return { ok: false, error: "not a lock" };
  const pairs = text
    .split("\n")
    .filter((line) => line !== "")
    .map((line): [string, string] => {
      const [name = "", version = ""] = line.split(": ");
      return [name, version];
    });
  return { ok: true, lock: Object.fromEntries(pairs) };
};

describe("the tools of a checkout", () => {
  it("are none without a manifest or a lock", () => {
    expect(toolsPart(tempDir())).toEqual({ state: "absent" });
  });

  it("are read from package.json and web-tops.lock, each by file", () => {
    const dir = tempDir();
    put(dir, {
      "package.json": '{ "devDependencies": { "eslint": "^10.0.0" } }\n',
      "web-tops.lock": "eslint: 10.15.0\nnode: ^22.23.4 || ^24.15.0 || >=26\n",
    });
    const tools = toolsPart(dir, fakeParse);
    expect(tools.state === "ok" && [...tools.value]).toEqual([
      ["lock: eslint", "10.15.0"],
      ["lock: node", "^22.23.4 || ^24.15.0 || >=26"],
      ["package.json: eslint", "^10.0.0"],
    ]);
    const onlyManifest = tempDir();
    put(onlyManifest, { "package.json": '{ "dependencies": { "a": "1.0.0" } }\n' });
    const alone = toolsPart(onlyManifest);
    expect(alone.state === "ok" && [...alone.value]).toEqual([["other: a", "1.0.0"]]);
    const onlyLock = tempDir();
    put(onlyLock, { "web-tops.lock": "eslint: 10.15.0\n" });
    const locked = toolsPart(onlyLock, fakeParse);
    expect(locked.state === "ok" && [...locked.value]).toEqual([["lock: eslint", "10.15.0"]]);
  });

  it("are an error, naming the file, when package.json or the lock cannot be read", () => {
    const bad = tempDir();
    put(bad, { "package.json": "{ nope" });
    const manifest = toolsPart(bad);
    expect(manifest.state === "error" && manifest.message.startsWith("package.json: ")).toBe(true);
    const lock = tempDir();
    put(lock, { "web-tops.lock": "bad\n" });
    const locked = toolsPart(lock, fakeParse);
    expect(locked).toEqual({ state: "error", message: "web-tops.lock: not a lock" });
    const both = tempDir();
    put(both, { "package.json": "{ nope", "web-tops.lock": "bad\n" });
    const first = toolsPart(both, fakeParse);
    expect(first.state === "error" && first.message.startsWith("package.json: ")).toBe(true);
  });
});

describe("what a class requires", () => {
  it("is the laws the checkout's catalog maps to it that are judged, and the layers and steps of its profile", () => {
    const laws = {
      state: "ok" as const,
      value: new Map([
        ["W-01", { severity: "R" as const, judged: "v0.1", classes: ["ts-library"], rules: [] }],
        ["W-02", { severity: "R" as const, judged: "no", classes: ["ts-library"], rules: [] }],
        ["W-03", { severity: "R" as const, judged: "m3", classes: ["web-app"], rules: [] }],
      ]),
    };
    const profile = profileOf("ts-library", laws);
    expect(profile.required).toEqual(new Set(["W-01"]));
    expect(profile.layers.has("package_exports")).toBe(true);
    expect(profile.layers.has("tsc")).toBe(true);
  });

  it("is the kit's own catalog when the checkout has none, and nothing for a class that has no profile", () => {
    const own = profileOf("astro-site", { state: "absent" });
    expect(own.required.has("W-49")).toBe(true);
    const unknown = profileOf("cli", { state: "absent" });
    expect(unknown).toEqual({ className: "cli", required: new Set(), layers: new Set() });
  });
});
