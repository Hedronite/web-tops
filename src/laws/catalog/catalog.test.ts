import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PROFILES } from "../../config/profiles.ts";
import { select } from "./query.ts";
import { syncTables } from "./table.ts";
import { loadCatalog } from "./load.ts";
import { LAW_CLASSES } from "./types.ts";
import type { Law } from "./types.ts";

const ROOT = resolve(import.meta.dirname, "../../..");

const loaded = loadCatalog(join(ROOT, "laws"));
if (!loaded.ok) throw new Error(loaded.problems.map((found) => found.message).join("; "));
const laws: readonly Law[] = loaded.laws;

const LAW_COUNT = 49;

/** The tick column of section 8.2 (v0.1): the laws judged today. */
const TICKED = [
  "W-01",
  "W-02",
  "W-04",
  "W-05",
  "W-06",
  "W-10",
  "W-11",
  "W-13",
  "W-14",
  "W-15",
  "W-16",
  "W-17",
  "W-18",
  "W-19",
  "W-20",
  "W-21",
  "W-22",
  "W-23",
  "W-26",
  "W-27",
  "W-29",
  "W-34",
  "W-35",
  "W-38",
  "W-40",
  "W-41",
];

const ALL = Array.from(
  { length: LAW_COUNT },
  (_, index) => `W-${String(index + 1).padStart(2, "0")}`,
);

/** The laws some class gates: a class maps these only if its own profile names them (section 5.2). */
const gatedLaws = (): ReadonlySet<string> =>
  new Set(PROFILES.flatMap((profile) => [...profile.extraLaws, ...profile.conditionalLaws]));

/** What section 5.2 says a class maps: the laws no class gates, and the class's own (W-27 only with Astro). */
const mappedBy = (profile: (typeof PROFILES)[number], withAstro: boolean): string[] => {
  const gated = gatedLaws();
  return ALL.filter(
    (id) =>
      !gated.has(id) ||
      profile.extraLaws.includes(id) ||
      (withAstro && profile.conditionalLaws.includes(id)),
  );
};

/** Each launch class with its profile, the class typed as a law class. */
const launch = PROFILES.flatMap((profile) =>
  LAW_CLASSES.filter((cls) => cls === profile.class).map((cls) => [cls, profile] as const),
);
const ids = (shown: readonly { id: string }[]): string[] => shown.map((law) => law.id);
const numbered = (list: string): string[] => list.split(/[ ,]+/u).filter((word) => word !== "");

describe("the kit's catalog: laws/W-NN.yaml (G1a)", () => {
  it("holds a valid file for each of the 49 laws, W-01 to W-49, in order", () => {
    expect(ids(laws)).toEqual(
      Array.from({ length: LAW_COUNT }, (_, index) => `W-${String(index + 1).padStart(2, "0")}`),
    );
    expect(laws).toHaveLength(LAW_COUNT);
  });

  it("puts every law in a family the text of section 8.2 has a table for", () => {
    const text = readFileSync(join(ROOT, "WEB_TOPS.md"), "utf8");
    for (const family of new Set(laws.map((law) => law.family)))
      expect(text, family).toContain(`**${family}**`);
  });

  it("has a launch-class profile for every class the laws name, and no law for a class without one", () => {
    expect([...LAW_CLASSES]).toEqual(PROFILES.map((profile) => profile.class));
  });

  it("gives every law a rationale and a fix that differ from its title and from each other", () => {
    for (const law of laws) {
      expect(new Set([law.title, law.rationale, law.fix]).size, law.id).toBe(3);
    }
  });
});

describe("the catalog agrees with the profiles and with section 5.2 (G1b)", () => {
  it.each(launch)(
    "%s: the laws that map it are the profile's mapped laws, with and without Astro",
    (cls, profile) => {
      const withAstro = ids(select(laws, { cls, required: false }));
      const without = ids(
        laws.filter(
          (law) => law.classes.includes(cls) && law.conditional_classes?.includes(cls) !== true,
        ),
      );
      expect(withAstro).toEqual(mappedBy(profile, true));
      expect(without).toEqual(mappedBy(profile, false));
    },
  );

  it("ticks, as judged in v0.1, exactly the 26 laws that section 8.2 ticks", () => {
    expect(ids(laws.filter((law) => law.judged === "v0.1"))).toEqual(TICKED);
    expect(TICKED).toHaveLength(26);
  });

  it("gives M3 a reader for exactly the laws the pack names", () => {
    expect(ids(laws.filter((law) => law.judged === "m3"))).toEqual([
      "W-28",
      "W-30",
      "W-31",
      "W-36",
      "W-37",
      "W-39",
      "W-48",
      "W-49",
    ]);
  });

  it.each(launch)("%s: the v0.1 laws it requires are the ticked laws it maps", (cls, profile) => {
    const ticked = laws.filter(
      (law) =>
        law.judged === "v0.1" &&
        law.classes.includes(cls) &&
        law.conditional_classes?.includes(cls) !== true,
    );
    expect(ids(ticked)).toEqual(mappedBy(profile, false).filter((id) => TICKED.includes(id)));
  });

  it("requires of a ts-library the 19 ticked laws of SPEC-m3, and W-36, W-39 and W-48 that M3 adds", () => {
    const floor = numbered(
      "W-01, W-02, W-04, W-05, W-06, W-10, W-11, W-13, W-14, W-15, W-16, W-17, W-18, W-19, W-34, W-35, W-38, W-40, W-41",
    );
    expect(ids(select(laws, { cls: "ts-library", required: true }))).toEqual(
      [...floor, "W-36", "W-39", "W-48"].sort(),
    );
  });

  it("requires of a node-service the same, without W-18", () => {
    const tsLibrary = ids(select(laws, { cls: "ts-library", required: true }));
    expect(ids(select(laws, { cls: "node-service", required: true }))).toEqual(
      tsLibrary.filter((id) => id !== "W-18"),
    );
  });

  it("requires of the browser classes the plugin laws once M3 gives them a reader", () => {
    const astro = ids(select(laws, { cls: "astro-site", required: true }));
    for (const id of ["W-23", "W-28", "W-30", "W-31", "W-36", "W-37"]) expect(astro).toContain(id);
    expect(ids(select(laws, { cls: "web-app", required: true }))).not.toContain("W-30");
  });
});

describe("section 8.2 is generated from the catalog (G1c)", () => {
  const text = readFileSync(join(ROOT, "WEB_TOPS.md"), "utf8");

  it("reads, in WEB_TOPS.md, what the catalog generates: a drifted title, tick or reader fails here", () => {
    expect(syncTables(text, laws)).toEqual({ ok: true, markdown: text });
  });

  it("goes red when one title of the catalog changes", () => {
    const edited = laws.map((law) =>
      law.id === "W-10" ? { ...law, title: `${law.title}.` } : law,
    );
    const synced = syncTables(text, edited);
    expect(synced.ok && synced.markdown).not.toBe(text);
  });

  it("goes red when a law is ticked that the text does not tick, and when a reader changes", () => {
    const ticked = laws.map((law) =>
      law.id === "W-03" ? { ...law, judged: "v0.1" as const } : law,
    );
    expect(syncTables(text, ticked)).not.toEqual({ ok: true, markdown: text });
    const read = laws.map((law) =>
      law.id === "W-03" ? { ...law, reader: { ...law.reader, text: "at" } } : law,
    );
    expect(syncTables(text, read)).not.toEqual({ ok: true, markdown: text });
  });
});

describe("the catalog ships with the package", () => {
  const pkg: unknown = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const field = (name: string): unknown =>
    typeof pkg === "object" && pkg !== null ? Reflect.get(pkg, name) : undefined;

  it("lists laws/ among the files, so webtops laws reads it from an install", () => {
    expect(field("files")).toContain("laws");
  });

  it("exports the law schema, as it does the others", () => {
    const exported = field("exports");
    expect(
      typeof exported === "object" &&
        exported !== null &&
        Reflect.get(exported, "./schema/law.schema.json"),
    ).toBe("./schema/law.schema.json");
  });
});

describe("the rules a law names, for the law probe", () => {
  const rulesOf = (id: string, tool: string): string[] =>
    laws
      .find((law) => law.id === id)
      ?.rules.filter((rule) => rule.tool === tool)
      .map((rule) => rule.name) ?? [];

  it("lists, for W-26, each rule of the stylelint preset, and W-24 the one the preset keeps for it", () => {
    const preset = readFileSync(join(ROOT, "src/presets/stylelint.js"), "utf8");
    const named = [...preset.matchAll(/^ {4}"([a-z-]+)": /gmu)].map((found) => String(found[1]));
    expect(named).toHaveLength(9);
    expect([...rulesOf("W-26", "stylelint"), ...rulesOf("W-24", "stylelint")].sort()).toEqual(
      [...named].sort(),
    );
    expect(rulesOf("W-26", "stylelint")).toHaveLength(8);
  });

  it("names for W-22 the click and anchor rules beside alt, label and static-element rules, and Astro's own beside them", () => {
    const own = rulesOf("W-22", "eslint").filter((name) => !name.startsWith("astro/jsx-a11y/"));
    expect(own).toEqual([
      "jsx-a11y-x/alt-text",
      "jsx-a11y-x/label-has-associated-control",
      "jsx-a11y-x/no-static-element-interactions",
      "jsx-a11y-x/click-events-have-key-events",
      "jsx-a11y-x/anchor-is-valid",
    ]);
  });

  it("keeps the tool of a proof to eslint, tsc or stylelint where a lint config or the compiler judges it", () => {
    const tools = new Set(
      laws
        .filter((law) => law.judged === "v0.1")
        .flatMap((law) => law.rules.map((rule) => rule.tool)),
    );
    expect([...tools].sort()).toEqual([
      "astro-check",
      "attw",
      "axe",
      "bun",
      "dependency-cruiser",
      "eslint",
      "html-validate",
      "lock",
      "publint",
      "stylelint",
      "tsc",
    ]);
  });
});
