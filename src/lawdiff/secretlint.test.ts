import { afterAll, describe, expect, it } from "vitest";
import { PRESET } from "../laws/readers/secrets.ts";
import { cleanTemp, put, tempDir } from "../laws/probe/testkit.ts";
import { defaultSecretlint, nestedDefault, secretlintOf, secretlintPart } from "./secretlint.ts";
import type { Part, Ranked, ToolConfig } from "./types.ts";

afterAll(cleanTemp);

const AWS = "@secretlint/secretlint-rule-aws";

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

describe("what a secretlint config holds", () => {
  it("each rule is on, with its severity, options and other keys, and no allowance", () => {
    const found = secretlintOf({ rules: [{ id: AWS }] });
    expect([...found.values.keys()].sort()).toEqual(
      [`other ${AWS}`, `options ${AWS}`, `rule ${AWS}`, `severity ${AWS}`, "other keys"].sort(),
    );
    expect(found.values.get(`rule ${AWS}`)).toEqual({ shown: "on", rank: 1 });
    expect(found.values.get(`severity ${AWS}`)).toEqual({ shown: "error", rank: 2 });
    expect(found.values.get(`options ${AWS}`)).toEqual({ shown: "{}", rank: 0, review: true });
    expect(found.values.get(`other ${AWS}`)).toEqual({ shown: "{}", rank: 0, review: true });
    expect(found.values.get("other keys")).toEqual({ shown: "{}", rank: 0, review: true });
    expect(found.sets).toEqual([
      { name: `allows ${AWS}`, loosens: "added", entries: [] },
      { name: `allowMessageIds ${AWS}`, loosens: "added", entries: [] },
    ]);
  });

  it("a rule with disabled true is off, and any other disabled is on", () => {
    expect(shown(secretlintOf({ rules: [{ id: AWS, disabled: true }] }), `rule ${AWS}`)).toBe(
      "disabled",
    );
    expect(rank(secretlintOf({ rules: [{ id: AWS, disabled: true }] }), `rule ${AWS}`)).toBe(0);
    expect(shown(secretlintOf({ rules: [{ id: AWS, disabled: false }] }), `rule ${AWS}`)).toBe(
      "on",
    );
  });

  it.each([
    ["info", 0],
    ["warning", 1],
    ["error", 2],
  ])("severity %s holds at rank %i, so a lower one is weaker", (severity, ranked) => {
    const found = secretlintOf({ rules: [{ id: AWS, severity }] });
    expect(found.values.get(`severity ${AWS}`)).toEqual({ shown: severity, rank: ranked });
  });

  it("the allow list is the strings of options.allows, and a list that grows is the way to loosen", () => {
    const found = secretlintOf({
      rules: [{ id: AWS, options: { allows: ["/.*/", "EXAMPLE"], other: 1 } }],
    });
    expect(entries(found, `allows ${AWS}`)).toEqual(["/.*/", "EXAMPLE"]);
    expect(loosens(found, `allows ${AWS}`)).toBe("added");
    expect(shown(found, `options ${AWS}`)).toBe('{"other":1}');
  });

  it("the message ids a rule allows are a list that loosens by gaining one", () => {
    const found = secretlintOf({ rules: [{ id: AWS, allowMessageIds: ["AWSAccessKeyID"] }] });
    expect(entries(found, `allowMessageIds ${AWS}`)).toEqual(["AWSAccessKeyID"]);
    expect(loosens(found, `allowMessageIds ${AWS}`)).toBe("added");
  });

  it("the rules inside a preset are named under it, with their own allow lists", () => {
    const found = secretlintOf({
      rules: [
        { id: PRESET, rules: [{ id: AWS, options: { allows: ["x"] }, severity: "warning" }] },
      ],
    });
    expect(shown(found, `rule ${PRESET}`)).toBe("on");
    expect(shown(found, `rule ${PRESET} > ${AWS}`)).toBe("on");
    expect(shown(found, `severity ${PRESET} > ${AWS}`)).toBe("warning");
    expect(entries(found, `allows ${PRESET} > ${AWS}`)).toEqual(["x"]);
  });

  it("a rule named twice is two rules, the second under its place in the list", () => {
    const found = secretlintOf({ rules: [{ id: AWS }, { id: AWS, disabled: true }] });
    expect(shown(found, `rule ${AWS}`)).toBe("on");
    expect(shown(found, `rule ${AWS}#2`)).toBe("disabled");
  });

  it("a rule's keys beyond the ones secretlint names, and the config's, are for review", () => {
    const found = secretlintOf({ rules: [{ id: AWS, extra: 1 }], note: "x" });
    expect(shown(found, `other ${AWS}`)).toBe('{"extra":1}');
    expect(shown(found, "other keys")).toBe('{"note":"x"}');
  });

  it("an entry with no id is unreadable, said at its place and under its preset", () => {
    const found = secretlintOf({ rules: [{ id: PRESET, rules: [{}, "x"] }, 5] });
    expect(shown(found, "unreadable 1")).toBe("5");
    expect(shown(found, `unreadable ${PRESET} > 0`)).toBe("{}");
    expect(shown(found, `unreadable ${PRESET} > 1`)).toBe('"x"');
    expect(found.values.get("unreadable 1")?.review).toBe(true);
  });

  it("a config that is not an object with a list of rules is for review, and holds no rule", () => {
    for (const bad of [null, [], "x", {}, { rules: "x" }]) {
      const found = secretlintOf(bad);
      expect([...found.values.keys()]).toEqual(["config"]);
      expect(found.values.get("config")).toEqual({
        shown: JSON.stringify(bad),
        rank: 0,
        review: true,
      });
      expect(found.sets).toEqual([]);
    }
  });
});

describe("the config and ignore files of a checkout", () => {
  it("says why when the tracked files could not be listed", () => {
    expect(errorOf(secretlintPart(tempDir(), "git ls-files exited 128"))).toBe(
      "git ls-files exited 128",
    );
  });

  it("is none when the project keeps no .secretlintrc.json and no .secretlintignore", () => {
    expect(secretlintPart(tempDir(), [])).toEqual({ state: "absent" });
  });

  it("is the kit's preset, alone, for a project that keeps none, and with its ignore file when it keeps one", () => {
    const found = defaultSecretlint();
    expect(shown(found, `rule ${PRESET}`)).toBe("on");
    expect([...found.values.keys()].some((key) => key.includes(AWS))).toBe(false);
    expect(found.sets.flatMap((set) => set.entries)).toEqual([]);
    const dir = tempDir();
    put(dir, { ".secretlintignore": "x\n" });
    const kept = okOf(secretlintPart(dir, [".secretlintignore"]));
    expect(shown(kept, `rule ${PRESET}`)).toBe("on");
    expect(entries(kept, "secretlintignore")).toEqual([".secretlintignore: x"]);
  });

  it("is the project's .secretlintrc.json when it has one, comments allowed, and not the preset besides", () => {
    const dir = tempDir();
    put(dir, {
      ".secretlintrc.json": `// ours\n{ "rules": [{ "id": "${AWS}", "options": { "allows": ["/.*/"] } }] }`,
    });
    const found = okOf(secretlintPart(dir, []));
    expect(shown(found, `rule ${AWS}`)).toBe("on");
    expect(found.values.has(`rule ${PRESET}`)).toBe(false);
    expect(entries(found, `allows ${AWS}`)).toEqual(["/.*/"]);
  });

  it("no other file named for secretlint is read", () => {
    const dir = tempDir();
    put(dir, {
      ".secretlintrc.yaml": "rules:\n  - id: x\n",
      "package.json": '{ "secretlint": { "rules": [{ "id": "x" }] } }',
    });
    expect(secretlintPart(dir, [".secretlintrc.yaml", "package.json"])).toEqual({
      state: "absent",
    });
  });

  it("says why a config that is not JSON cannot be read, with the file named", () => {
    const dir = tempDir();
    put(dir, { ".secretlintrc.json": "{ nope" });
    const message = errorOf(secretlintPart(dir, []));
    expect(message.startsWith(".secretlintrc.json: ")).toBe(true);
    expect(message.length).toBeGreaterThan(".secretlintrc.json: ".length);
  });

  it("says why a config that cannot be opened cannot be read", () => {
    const dir = tempDir();
    put(dir, { ".secretlintrc.json/x": "" });
    expect(errorOf(secretlintPart(dir, [])).startsWith(".secretlintrc.json: ")).toBe(true);
  });

  it("reads each tracked .secretlintignore at any depth: a pattern that ignores more is a list that loosens by gaining one", () => {
    const dir = tempDir();
    put(dir, {
      ".secretlintignore": "# comment\n\n  fixtures/**  \n!fixtures/keep.txt\n",
      "a/b/.secretlintignore": "*.pem\n",
      "a/.secretlintignore.bak": "never read\n",
      ".secretlintignore2": "never read\n",
    });
    const found = okOf(
      secretlintPart(dir, [
        ".secretlintignore",
        "a/b/.secretlintignore",
        "a/.secretlintignore.bak",
        ".secretlintignore2",
      ]),
    );
    expect(entries(found, "secretlintignore")).toEqual([
      ".secretlintignore: fixtures/**",
      "a/b/.secretlintignore: *.pem",
    ]);
    expect(loosens(found, "secretlintignore")).toBe("added");
    expect(entries(found, "secretlintignore !")).toEqual([".secretlintignore: !fixtures/keep.txt"]);
    expect(loosens(found, "secretlintignore !")).toBe("removed");
  });

  it("an ignore file that is not tracked is not read, and one that is tracked and cannot be read is said", () => {
    const dir = tempDir();
    put(dir, { ".secretlintignore": "x\n" });
    expect(secretlintPart(dir, [])).toEqual({ state: "absent" });
    expect(
      errorOf(secretlintPart(dir, ["gone/.secretlintignore"])).startsWith(
        "gone/.secretlintignore: ",
      ),
    ).toBe(true);
  });

  it("a config that names no ignore file and no config is read as a project that keeps none: the kit's preset", () => {
    const kit: Ranked = { shown: "on", rank: 1 };
    expect(defaultSecretlint().values.get(`rule ${PRESET}`)).toEqual(kit);
  });
});

describe("what a rule nested in a preset is when the config does not name it", () => {
  it.each([
    ["rule", { shown: "on", rank: 1 }],
    ["severity", { shown: "error", rank: 2 }],
    ["options", { shown: "{}", rank: 0, review: true }],
    ["other", { shown: "{}", rank: 0, review: true }],
  ])("a nested %s is the preset's own", (kind, given) => {
    expect(nestedDefault(`${kind} ${PRESET} > ${AWS}`)).toEqual(given);
  });

  it("a name of a rule or preset in the list itself, and any other kind of name, has none", () => {
    expect(nestedDefault(`rule ${PRESET}`)).toBeUndefined();
    expect(nestedDefault(`severity ${AWS}`)).toBeUndefined();
    expect(nestedDefault(`unreadable ${PRESET} > 0`)).toBeUndefined();
    expect(nestedDefault("other keys")).toBeUndefined();
    expect(nestedDefault("config")).toBeUndefined();
  });
});
