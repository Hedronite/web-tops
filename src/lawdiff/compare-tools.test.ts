import { describe, expect, it } from "vitest";
import { compareSnapshots } from "./compare.ts";
import { knipOf } from "./knip.ts";
import { PRESET } from "../laws/readers/secrets.ts";
import { secretlintOf } from "./secretlint.ts";
import type { Part, Snapshot, Surface, ToolConfig } from "./types.ts";

const absent: Part<never> = { state: "absent" };
const AWS = "@secretlint/secretlint-rule-aws";

const snapshot = (secretlint?: Part<ToolConfig>, knip?: Part<ToolConfig>): Snapshot => ({
  tracked: [],
  trackedStyle: [],
  style: absent,
  cruise: absent,
  ...(secretlint === undefined ? {} : { secretlint }),
  ...(knip === undefined ? {} : { knip }),
  fileSets: absent,
  levels: absent,
  flags: absent,
  settings: absent,
  laws: absent,
  profile: absent,
  tools: absent,
});

const ok = (value: ToolConfig): Part<ToolConfig> => ({ state: "ok", value });

const secretlintSurface = (base: unknown, head: unknown): Surface => {
  const surfaces = compareSnapshots(
    snapshot(ok(secretlintOf(base))),
    snapshot(ok(secretlintOf(head))),
    new Map(),
  );
  return surfaces[9] ?? { name: "missing", compared: 0, items: [] };
};

const knipSurface = (base: Record<string, unknown>, head: Record<string, unknown>): Surface => {
  const surfaces = compareSnapshots(
    snapshot(undefined, ok(knipOf(base))),
    snapshot(undefined, ok(knipOf(head))),
    new Map(),
  );
  return surfaces[10] ?? { name: "missing", compared: 0, items: [] };
};

const moves = (surface: Surface): string[] =>
  surface.items.map(
    (item) => `${item.change}: ${item.what}${item.where === undefined ? "" : ` (${item.where})`}`,
  );

describe("the secretlint surface", () => {
  const strict = { rules: [{ id: PRESET, rules: [{ id: AWS, severity: "error" }] }] };

  it("is named for W-39, listed after the tsconfig surface, and passes a config that did not move", () => {
    const surface = secretlintSurface(strict, strict);
    expect(surface.name).toBe("secretlint rules, allow lists and ignores (W-39)");
    expect(surface.items).toEqual([]);
    expect(surface.compared).toBeGreaterThan(0);
  });

  it("weakens on an allow that matches everything, added to the AWS rule", () => {
    const head = {
      rules: [
        { id: PRESET, rules: [{ id: AWS, severity: "error", options: { allows: ["/.*/"] } }] },
      ],
    };
    expect(moves(secretlintSurface(strict, head))).toEqual([
      `weakened: allows ${PRESET} > ${AWS} (/.*/)`,
    ]);
  });

  it("weakens on a message id allowed, a rule disabled, a rule or preset dropped, and a severity lowered", () => {
    const allowed = {
      rules: [{ id: PRESET, rules: [{ id: AWS, allowMessageIds: ["AWSAccessKeyID"] }] }],
    };
    expect(moves(secretlintSurface(strict, allowed))).toEqual([
      `weakened: allowMessageIds ${PRESET} > ${AWS} (AWSAccessKeyID)`,
    ]);
    const disabled = { rules: [{ id: PRESET, rules: [{ id: AWS, disabled: true }] }] };
    expect(moves(secretlintSurface(strict, disabled))).toEqual([
      `weakened: rule ${PRESET} > ${AWS}`,
    ]);
    const dropped = { rules: [{ id: PRESET }] };
    expect(moves(secretlintSurface(strict, dropped))).toEqual([]);
    const gone = { rules: [] };
    expect(
      moves(secretlintSurface(strict, gone)).filter((line) => line.includes(`rule ${PRESET}`)),
    ).toEqual([`weakened: rule ${PRESET}`]);
    const lowered = { rules: [{ id: PRESET, rules: [{ id: AWS, severity: "warning" }] }] };
    expect(moves(secretlintSurface(strict, lowered))).toEqual([
      `weakened: severity ${PRESET} > ${AWS}`,
    ]);
  });

  it("strengthens on a rule added, and lists a change of options for review", () => {
    const head = {
      rules: [
        { id: PRESET, rules: [{ id: AWS, severity: "error", options: { x: 1 } }] },
        { id: "other" },
      ],
    };
    const lines = moves(secretlintSurface(strict, head));
    expect(lines).toContain("strengthened: rule other");
    expect(lines).toContain(`changed: options ${PRESET} > ${AWS}`);
  });

  it("a config that cannot be read is weaker, never a pass", () => {
    const broken: Part<ToolConfig> = { state: "error", message: ".secretlintrc.json: bad" };
    const surfaces = compareSnapshots(
      snapshot(ok(secretlintOf(strict)), absent),
      snapshot(broken, absent),
      new Map(),
    );
    expect(surfaces[9]?.items.map((item) => [item.what, item.change, item.after])).toEqual([
      ["the surface at head", "weakened", "cannot be read: .secretlintrc.json: bad"],
    ]);
  });
});

describe("the knip surface", () => {
  const strict = { entry: ["src/main.ts"], project: ["src/**"], ignore: ["gen/**"] };

  it("is named for W-48, listed last, and passes a config that did not move", () => {
    const surface = knipSurface(strict, strict);
    expect(surface.name).toBe("knip ignores, entries, projects and rule levels (W-48)");
    expect(surface.items).toEqual([]);
    expect(surface.compared).toBeGreaterThan(0);
  });

  it("weakens on an ignore, an ignored dependency, a widened entry, a narrowed project and an excluded issue type", () => {
    const head = {
      entry: ["src/main.ts", "src/**"],
      project: [],
      ignore: ["gen/**", "src/**"],
      ignoreDependencies: ["left-pad"],
      exclude: ["files"],
    };
    expect(moves(knipSurface(strict, head))).toEqual([
      "weakened: entry (src/**)",
      "weakened: exclude (files)",
      "weakened: ignore (src/**)",
      "weakened: ignoreDependencies (left-pad)",
      "weakened: project (src/**)",
    ]);
  });

  it("weakens on ignoreExportsUsedInFile turned on, a rule turned down or off, and a plugin turned off", () => {
    const head = {
      ...strict,
      ignoreExportsUsedInFile: { type: true },
      rules: { files: "warn", exports: "off" },
      vitest: false,
    };
    expect(moves(knipSurface({ ...strict, vitest: true }, head))).toEqual([
      "weakened: ignoreExportsUsedInFile type",
      "weakened: plugin vitest",
      "weakened: rules exports",
      "weakened: rules files",
    ]);
  });

  it("strengthens on an ignore removed and an entry narrowed", () => {
    expect(moves(knipSurface(strict, { project: ["src/**"], entry: [], ignore: [] }))).toEqual([
      "strengthened: entry (src/main.ts)",
      "strengthened: ignore (gen/**)",
    ]);
  });

  it("lists a config written as code that changed for review, weakened by nothing", () => {
    const code = (hash: string): Part<ToolConfig> => ok(knipOf({}, { name: "knip.ts", hash }));
    const surfaces = compareSnapshots(
      snapshot(undefined, code("sha1:a")),
      snapshot(undefined, code("sha1:b")),
      new Map(),
    );
    expect(surfaces[10]?.items.map((item) => [item.what, item.change])).toEqual([
      ["config file", "changed"],
    ]);
  });

  it("a surface that a ref has and the other has not is the whole of it appearing or going", () => {
    const some = ok(knipOf({ ignore: ["a"] }));
    const gained = compareSnapshots(
      snapshot(undefined, absent),
      snapshot(undefined, some),
      new Map(),
    )[10];
    expect(gained?.items.map((item) => item.change)).toEqual(["strengthened"]);
    const lost = compareSnapshots(
      snapshot(undefined, some),
      snapshot(undefined, absent),
      new Map(),
    )[10];
    expect(lost?.items.map((item) => item.change)).toEqual(["weakened"]);
  });

  it("a project with no knip config is knip's defaults: an ignore added to it is weaker, one taken out is stronger", () => {
    const none = ok(knipOf({}));
    const some = ok(knipOf({ ignore: ["a"] }));
    const added = compareSnapshots(
      snapshot(undefined, none),
      snapshot(undefined, some),
      new Map(),
    )[10];
    expect(moves(added ?? { name: "", compared: 0, items: [] })).toEqual(["weakened: ignore (a)"]);
    const gone = compareSnapshots(
      snapshot(undefined, some),
      snapshot(undefined, none),
      new Map(),
    )[10];
    expect(gone?.items.map((item) => item.change)).toEqual(["strengthened"]);
  });
});
