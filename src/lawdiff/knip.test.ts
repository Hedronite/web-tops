import { afterAll, describe, expect, it } from "vitest";
import { cleanTemp, put, tempDir } from "../laws/probe/testkit.ts";
import { configNames, defaultKnip, knipOf, knipPart } from "./knip.ts";
import type { Part, ToolConfig } from "./types.ts";

afterAll(cleanTemp);

const shown = (found: ToolConfig, key: string): string | undefined => found.values.get(key)?.shown;
const rank = (found: ToolConfig, key: string): number | undefined => found.values.get(key)?.rank;
const entries = (found: ToolConfig, name: string): string[] =>
  found.sets.filter((set) => set.name === name).flatMap((set) => [...set.entries]);
const loosens = (found: ToolConfig, name: string): string | undefined =>
  found.sets.find((set) => set.name === name)?.loosens;

const okOf = (part: Part<ToolConfig>): ToolConfig => {
  if (part.state !== "ok") throw new Error(`not read: ${JSON.stringify(part)}`);
  return part.value;
};
const errorOf = (part: Part<ToolConfig>): string => (part.state === "error" ? part.message : "");

const LISTS: [string, string][] = [
  ["entry", "added"],
  ["project", "removed"],
  ["ignore", "added"],
  ["ignoreFiles", "added"],
  ["ignoreBinaries", "added"],
  ["ignoreGlobalBinaries", "added"],
  ["ignoreDependencies", "added"],
  ["ignoreMembers", "added"],
  ["ignoreUnresolved", "added"],
  ["ignoreWorkspaces", "added"],
  ["include", "removed"],
  ["exclude", "added"],
];

describe("what a knip config holds", () => {
  it.each(LISTS)("%s is a list that loosens by %s", (key, way) => {
    const found = knipOf({ [key]: ["a", "b"] });
    expect(entries(found, key)).toEqual(["a", "b"]);
    expect(loosens(found, key)).toBe(way);
  });

  it("a list written as one string is one entry, and a key that is not there is no list", () => {
    expect(entries(knipOf({ entry: "src/main.ts" }), "entry")).toEqual(["src/main.ts"]);
    expect(knipOf({}).sets.filter((set) => set.name === "entry")).toEqual([]);
  });

  it("each workspace has its lists, values and plugins under its name", () => {
    const found = knipOf({
      workspaces: { "packages/a": { ignore: ["x"], includeEntryExports: true, vitest: false } },
    });
    expect(entries(found, "workspace packages/a: ignore")).toEqual(["x"]);
    expect(shown(found, "workspace packages/a: includeEntryExports")).toBe("on");
    expect(shown(found, "workspace packages/a: plugin vitest")).toBe("off");
    expect(entries(found, "ignore")).toEqual([]);
  });

  it("a workspace that is not an object is for review, by its name", () => {
    const found = knipOf({ workspaces: { a: 5 } });
    expect(found.values.get("workspace a")).toEqual({ shown: "5", rank: 0, review: true });
  });

  it("ignoreIssues is one entry for each file pattern and issue type, and a list that loosens by gaining one", () => {
    const found = knipOf({
      ignoreIssues: { "src/gen/**": ["exports", "types"], "**/*.d.ts": "files" },
    });
    expect(entries(found, "ignoreIssues")).toEqual([
      "src/gen/**: exports",
      "src/gen/**: types",
      "**/*.d.ts: files",
    ]);
    expect(loosens(found, "ignoreIssues")).toBe("added");
    expect(entries(knipOf({ ignoreIssues: 5 }), "ignoreIssues")).toEqual([]);
  });

  it.each([
    "includeEntryExports",
    "includeSubpathExports",
    "treatConfigHintsAsErrors",
    "treatTagHintsAsErrors",
  ])("%s reports more when it is on, and is off unless the config says true", (key) => {
    expect(knipOf({ [key]: true }).values.get(key)).toEqual({ shown: "on", rank: 1 });
    expect(knipOf({ [key]: false }).values.get(key)).toEqual({ shown: "off", rank: 0 });
    expect(knipOf({}).values.get(key)).toEqual({ shown: "off", rank: 0 });
    expect(knipOf({ [key]: "true" }).values.get(key)).toEqual({ shown: "off", rank: 0 });
  });

  it.each(["tags", "paths", "preprocessor", "preprocessorOptions"])(
    "%s is for review, as JSON, and null when it is not there",
    (key) => {
      expect(knipOf({ [key]: ["-lintignore"] }).values.get(key)).toEqual({
        shown: '["-lintignore"]',
        rank: 0,
        review: true,
      });
      expect(shown(knipOf({}), key)).toBe("null");
    },
  );

  const KINDS = ["class", "enum", "function", "interface", "member", "type", "variable"];

  it("ignoreExportsUsedInFile as true ignores every kind, and as an object only the kinds it names", () => {
    for (const kind of KINDS) {
      expect(
        knipOf({ ignoreExportsUsedInFile: true }).values.get(`ignoreExportsUsedInFile ${kind}`),
      ).toEqual({
        shown: "ignored",
        rank: 0,
      });
      expect(knipOf({}).values.get(`ignoreExportsUsedInFile ${kind}`)).toEqual({
        shown: "reported",
        rank: 1,
      });
      expect(
        shown(knipOf({ ignoreExportsUsedInFile: false }), `ignoreExportsUsedInFile ${kind}`),
      ).toBe("reported");
    }
    const some = knipOf({ ignoreExportsUsedInFile: { type: true, interface: false, enum: "yes" } });
    expect(shown(some, "ignoreExportsUsedInFile type")).toBe("ignored");
    expect(shown(some, "ignoreExportsUsedInFile interface")).toBe("reported");
    expect(shown(some, "ignoreExportsUsedInFile enum")).toBe("reported");
    expect(shown(some, "ignoreExportsUsedInFile class")).toBe("reported");
  });

  const TYPES = [
    "binaries",
    "catalog",
    "catalogReferences",
    "cycles",
    "dependencies",
    "devDependencies",
    "duplicates",
    "enumMembers",
    "exports",
    "files",
    "namespaceMembers",
    "nsExports",
    "nsTypes",
    "optionalPeerDependencies",
    "subpaths",
    "types",
    "unlisted",
    "unresolved",
  ];

  it("each issue type has a rule level, error when the config sets none, and a lower one is weaker", () => {
    const found = knipOf({});
    for (const type of TYPES) {
      expect(found.values.get(`rules ${type}`)).toEqual({ shown: "error", rank: 2 });
    }
    const set = knipOf({ rules: { files: "warn", exports: "off", custom: "warn", types: "loud" } });
    expect(set.values.get("rules files")).toEqual({ shown: "warn", rank: 1 });
    expect(set.values.get("rules exports")).toEqual({ shown: "off", rank: 0 });
    expect(set.values.get("rules custom")).toEqual({ shown: "warn", rank: 1 });
    expect(rank(set, "rules types")).toBe(-1);
  });

  it("rule levels are the root's: a workspace's rules key moves none", () => {
    const found = knipOf({ workspaces: { a: { rules: { files: "off", custom: "warn" } } } });
    expect(found.values.get("rules files")).toEqual({ shown: "error", rank: 2 });
    expect(found.values.has("rules custom")).toBe(false);
  });

  it("the cycles knip accepts are a list that loosens by gaining one, and the rest of the setting is for review", () => {
    const found = knipOf({ cycles: { allow: [["a.ts", "b.ts"]], dynamicImports: true } });
    expect(entries(found, "cycles allow")).toEqual(['["a.ts","b.ts"]']);
    expect(loosens(found, "cycles allow")).toBe("added");
    expect(shown(found, "cycles")).toBe('{"dynamicImports":true}');
    expect(entries(knipOf({ cycles: 5 }), "cycles allow")).toEqual([]);
    expect(shown(knipOf({}), "cycles")).toBe("{}");
  });

  it("a plugin set to false is off, one set to true is on, and either is a value of its own", () => {
    expect(knipOf({ vitest: false }).values.get("plugin vitest")).toEqual({
      shown: "off",
      rank: 0,
    });
    expect(knipOf({ vitest: true }).values.get("plugin vitest")).toEqual({ shown: "on", rank: 1 });
  });

  it("a plugin's lists are lists, and what else it says is for review", () => {
    const found = knipOf({
      vitest: { entry: ["x.test.ts"], config: ["vitest.config.ts"], project: ["a"] },
    });
    expect(entries(found, "vitest entry")).toEqual(["x.test.ts"]);
    expect(loosens(found, "vitest entry")).toBe("added");
    expect(entries(found, "vitest project")).toEqual(["a"]);
    expect(shown(found, "plugin vitest")).toBe('{"config":["vitest.config.ts"]}');
  });

  it("a plugin given as a list of patterns, or as anything else, is for review", () => {
    expect(knipOf({ eslint: ["a.js"] }).values.get("plugin eslint")).toEqual({
      shown: '["a.js"]',
      rank: 0,
      review: true,
    });
    expect(shown(knipOf({ eslint: "x" }), "plugin eslint")).toBe('"x"');
  });

  it("the schema key and every key knip names are not plugins", () => {
    const named = {
      $schema: "x",
      ...Object.fromEntries(LISTS.map(([key]) => [key, ["a"]])),
      includeEntryExports: true,
      includeSubpathExports: true,
      treatConfigHintsAsErrors: true,
      treatTagHintsAsErrors: true,
      tags: ["-a"],
      paths: {},
      preprocessor: "p",
      preprocessorOptions: {},
      ignoreExportsUsedInFile: true,
      ignoreIssues: { a: ["files"] },
      cycles: {},
      rules: {},
      workspaces: {},
    };
    const found = knipOf(named);
    expect([...found.values.keys()].some((key) => key.startsWith("plugin"))).toBe(false);
  });

  it("workspaces that are not an object name no workspace", () => {
    for (const workspaces of [5, ["a"], "a", null]) {
      const found = knipOf({ workspaces });
      expect([...found.values.keys()].some((key) => key.startsWith("workspace"))).toBe(false);
      expect(found.sets.some((set) => set.name.startsWith("workspace"))).toBe(false);
    }
  });

  it("a config written as code is one value, by its file and hash, for review", () => {
    const found = knipOf({}, { name: "knip.ts", hash: "sha1:abc" });
    expect(found.values.get("config file")).toEqual({
      shown: "knip.ts sha1:abc",
      rank: 0,
      review: true,
    });
    expect(knipOf({}).values.has("config file")).toBe(false);
  });
});

describe("the config knip reads in a checkout", () => {
  it("is the files knip looks for, in its order", () => {
    expect(configNames()).toEqual([
      "knip.json",
      "knip.jsonc",
      ".knip.json",
      ".knip.jsonc",
      "knip.ts",
      "knip.js",
      "knip.config.ts",
      "knip.config.js",
    ]);
  });

  it("is none when there is no config file and no knip key, and defaults are an empty config", () => {
    expect(knipPart(tempDir())).toEqual({ state: "absent" });
    const dir = tempDir();
    put(dir, { "package.json": '{ "name": "x", "knip": 5 }' });
    expect(knipPart(dir)).toEqual({ state: "absent" });
    const none = tempDir();
    put(none, { "package.json": '{ "knip": {} }' });
    expect(knipPart(none)).toEqual({ state: "absent" });
    expect(defaultKnip()).toEqual(knipOf({}));
    expect(defaultKnip().sets.flatMap((set) => set.entries)).toEqual([]);
  });

  it("is the knip key of package.json when there is no file", () => {
    const dir = tempDir();
    put(dir, { "package.json": '{ "knip": { "ignore": ["a"] } }' });
    expect(entries(okOf(knipPart(dir)), "ignore")).toEqual(["a"]);
  });

  it.each(["knip.json", "knip.jsonc", ".knip.json", ".knip.jsonc"])(
    "reads %s as JSON, comments allowed",
    (name) => {
      const dir = tempDir();
      put(dir, { [name]: '// c\n{ "ignoreDependencies": ["left-pad"] }' });
      expect(entries(okOf(knipPart(dir)), "ignoreDependencies")).toEqual(["left-pad"]);
    },
  );

  it.each(["knip.ts", "knip.js", "knip.config.ts", "knip.config.js"])(
    "hashes %s, which is code",
    (name) => {
      const dir = tempDir();
      put(dir, { [name]: "export default { ignore: ['a'] };\n" });
      const found = okOf(knipPart(dir));
      expect(shown(found, "config file")).toMatch(
        new RegExp(`^${name.replace(".", "\\.")} sha1:[0-9a-f]{12}$`, "u"),
      );
      expect(entries(found, "ignore")).toEqual([]);
    },
  );

  it("the same code has the same hash, and other code another", () => {
    const hashOf = (text: string): string | undefined => {
      const dir = tempDir();
      put(dir, { "knip.ts": text });
      return shown(okOf(knipPart(dir)), "config file");
    };
    expect(hashOf("a\n")).toBe(hashOf("a\n"));
    expect(hashOf("a\n")).not.toBe(hashOf("b\n"));
  });

  it("the first file in knip's order is the one read, and no other", () => {
    const dir = tempDir();
    put(dir, {
      "knip.jsonc": '{ "ignore": ["jsonc"] }',
      ".knip.json": '{ "ignore": ["dot"] }',
      "knip.ts": "x",
    });
    expect(entries(okOf(knipPart(dir)), "ignore")).toEqual(["jsonc"]);
    const code = tempDir();
    put(code, { "knip.config.js": "x", "knip.js": "y" });
    expect(shown(okOf(knipPart(code)), "config file")).toContain("knip.js ");
  });

  it("the file's keys replace the manifest's, key by key, and the manifest's others stay", () => {
    const dir = tempDir();
    put(dir, {
      "package.json": '{ "knip": { "ignore": ["manifest"], "entry": ["main.ts"] } }',
      "knip.json": '{ "ignore": ["file"] }',
    });
    const found = okOf(knipPart(dir));
    expect(entries(found, "ignore")).toEqual(["file"]);
    expect(entries(found, "entry")).toEqual(["main.ts"]);
  });

  it("a code file leaves the manifest's keys in, and says it cannot read the rest", () => {
    const dir = tempDir();
    put(dir, { "package.json": '{ "knip": { "ignore": ["manifest"] } }', "knip.ts": "x" });
    const found = okOf(knipPart(dir));
    expect(entries(found, "ignore")).toEqual(["manifest"]);
    expect(found.values.has("config file")).toBe(true);
  });

  it("says why a file that is not JSON, not an object, or cannot be opened cannot be read, and a bad package.json", () => {
    const bad = tempDir();
    put(bad, { "knip.json": "{ nope" });
    expect(errorOf(knipPart(bad)).startsWith("knip.json: ")).toBe(true);
    const list = tempDir();
    put(list, { "knip.json": "[]" });
    expect(errorOf(knipPart(list))).toContain("knip.json: ");
    expect(errorOf(knipPart(list))).toContain("must be an object");
    const folder = tempDir();
    put(folder, { "knip.json/x": "" });
    expect(errorOf(knipPart(folder)).startsWith("knip.json: ")).toBe(true);
    const manifest = tempDir();
    put(manifest, { "package.json": "{ nope", "knip.json": "{}" });
    expect(errorOf(knipPart(manifest)).startsWith("package.json: ")).toBe(true);
  });
});
