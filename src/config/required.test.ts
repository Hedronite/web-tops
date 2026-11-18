import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROFILES, profileFor, type Profile } from "./profiles.ts";
import {
  JUDGED_LAWS,
  LAW_COUNT,
  isRequiredLayer,
  mappedLaws,
  requiredLayers,
  requiredLaws,
} from "./required.ts";
import { LAYER_IDS } from "./report.ts";

const spec = readFileSync(join(import.meta.dirname, "../../WEB_TOPS.md"), "utf8");
const noAstro = { dependsOnAstro: false };
const astro = { dependsOnAstro: true };

function profile(name: string): Profile {
  const found = profileFor(name);
  if (found === undefined) throw new Error(`no profile for ${name}`);
  return found;
}

/** The cells of one row of section 5.2's table, in class order. */
function row(label: string): string[] {
  const section = spec.slice(spec.indexOf("### 5.2"), spec.indexOf("### 5.2") + 4000);
  const line = section.split("\n").find((candidate) => candidate.startsWith(`| ${label}`));
  if (line === undefined) throw new Error(`section 5.2 has no row "${label}"`);
  return line
    .split("|")
    .slice(2, -1)
    .map((cell) => cell.trim());
}

/** Law ids a cell names, ranges expanded; the part after `;` is the Astro-only part. */
function lawsIn(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(/W-(\d+)(?:–W-(\d+))?/g)) {
    const from = Number(match[1]);
    const to = Number(match[2] ?? match[1]);
    for (let n = from; n <= to; n += 1) ids.push(`W-${String(n).padStart(2, "0")}`);
  }
  return ids;
}

describe("G3a: section 5.2 states the laws each class maps, and the code holds the same", () => {
  const extras = row("Extra laws");

  it.each(PROFILES.map((p, index) => [p.class, index] as const))(
    "%s: extra and Astro-only laws are the cell's laws",
    (name, index) => {
      const [always = "", whenAstro = ""] = (extras[index] ?? "").split(";");
      const stated = (text: string): string[] => lawsIn(text.replace(/W-06 strict/, ""));
      const conditional = stated(whenAstro);
      expect(profile(name).extraLaws, "extra").toEqual(
        stated(always).filter((id) => !conditional.includes(id)),
      );
      expect(profile(name).conditionalLaws, "when Astro").toEqual(conditional);
    },
  );

  it("moves W-37 to the browser classes and gives W-42 to W-46 to astro-site and web-app", () => {
    const among = (id: string): string[] =>
      PROFILES.filter((p) => p.extraLaws.includes(id)).map((p) => p.class);
    expect(among("W-37")).toEqual(["ui-components", "astro-site", "web-app"]);
    for (const id of ["W-42", "W-43", "W-44", "W-45", "W-46"]) {
      expect(among(id), id).toEqual(["astro-site", "web-app"]);
    }
    expect(profile("node-service").extraLaws).not.toContain("W-37");
  });

  it("keeps W-06 for every class: node-service's `strict` is a reading of it, not a gate", () => {
    for (const p of PROFILES) expect(mappedLaws(p, noAstro), p.class).toContain("W-06");
  });
});

describe("G3a: required laws are the judged laws a class maps", () => {
  it("judges the 26 laws section 8.2 marks with a tick, and no others", () => {
    const ticked = spec
      .split("\n")
      .filter((line) => /^\| W-\d+ /.test(line) && /\| ✓ \|\s*$/.test(line))
      .map((line) => line.split("|")[1]?.trim());
    expect(JUDGED_LAWS).toHaveLength(26);
    expect([...JUDGED_LAWS]).toEqual(ticked);
  });

  it.each([
    ["ts-library", 19, 19],
    ["ui-components", 20, 21],
    ["astro-site", 25, 25],
    ["web-app", 24, 25],
    ["node-service", 18, 18],
  ])("%s requires %i laws, %i when the project depends on Astro", (name, plain, withAstro) => {
    expect(requiredLaws(profile(name), noAstro)).toHaveLength(plain);
    expect(requiredLaws(profile(name), astro)).toHaveLength(withAstro);
  });

  it("requires a law only if it is judged, and maps every one it requires", () => {
    for (const p of PROFILES) {
      for (const id of requiredLaws(p, astro)) {
        expect(JUDGED_LAWS, id).toContain(id);
        expect(mappedLaws(p, astro), id).toContain(id);
      }
    }
  });

  it("maps laws the class names beyond the judged ones, so M4 and M5 add to the set", () => {
    expect(mappedLaws(profile("web-app"), noAstro)).toEqual(
      expect.arrayContaining(["W-37", "W-42", "W-46"]),
    );
    expect(requiredLaws(profile("web-app"), noAstro)).not.toContain("W-42");
    expect(mappedLaws(profile("ts-library"), noAstro)).not.toContain("W-42");
  });

  it("lists every law once, sorted, and the Astro-only law only with Astro", () => {
    for (const p of PROFILES) {
      const ids = mappedLaws(p, astro);
      expect(ids).toEqual([...new Set(ids)].sort());
    }
    expect(requiredLaws(profile("web-app"), noAstro)).not.toContain("W-27");
    expect(requiredLaws(profile("web-app"), astro)).toContain("W-27");
    expect(requiredLaws(profile("astro-site"), noAstro)).toContain("W-27");
  });

  it("gives the class-gated laws to their classes only", () => {
    expect(requiredLaws(profile("ts-library"), astro)).toContain("W-18");
    expect(requiredLaws(profile("web-app"), astro)).not.toContain("W-18");
    expect(requiredLaws(profile("node-service"), astro)).not.toContain("W-22");
    expect(requiredLaws(profile("ui-components"), noAstro)).toContain("W-22");
  });
});

describe("G3a: required layers", () => {
  it.each(PROFILES.map((p) => p.class))(
    "%s requires the gates, CRAP, mutation and laws",
    (name) => {
      for (const id of ["hygiene", "tests", "coverage", "crap", "mutation", "laws"] as const) {
        expect(isRequiredLayer(profile(name), id), id).toBe(true);
      }
    },
  );

  it("requires build output only where the class maps a build-output layer", () => {
    const needs = (name: string): boolean => isRequiredLayer(profile(name), "build-output");
    expect(["ts-library", "ui-components", "astro-site", "web-app"].map(needs)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(needs("node-service")).toBe(false);
  });

  it("lists them in report order and only built-in layers", () => {
    for (const p of PROFILES) {
      const ids = requiredLayers(p);
      expect(ids).toEqual(LAYER_IDS.filter((id) => ids.includes(id)));
    }
    expect(requiredLayers(profile("node-service"))).toEqual([
      "hygiene",
      "tests",
      "coverage",
      "crap",
      "mutation",
      "laws",
    ]);
  });

  it("is stated in section 5.2, one row per class", () => {
    const cells = row("Required layers");
    expect(cells).toHaveLength(PROFILES.length);
    PROFILES.forEach((p, index) => {
      const stated = requiredLayers(p).join(", ");
      expect(cells[index], p.class).toBe(stated);
    });
  });
});

describe("G3d: section 5.2 states how the caps work (X2)", () => {
  const section = spec.slice(spec.indexOf("### 5.2"), spec.indexOf("### 5.2") + 6000);

  it.each([
    ["one cap per class", /one CRAP cap per class/i],
    ["measured in M2.5 and kept", /measured in M2\.5[^.]*and kept/i],
    ["binds new and changed functions", /new and changed functions/i],
    ["the ratchet holds legacy functions", /ratchet[^.]*legacy/i],
    ["no per-author cap", /no per-author cap/i],
  ])("says: %s", (_what, pattern) => {
    expect(section).toMatch(pattern);
  });
});

describe("R55: W-47 and W-48 join the catalog, unjudged", () => {
  it("counts as many laws as section 8.2 lists, 48", () => {
    const rows = spec.split("\n").filter((line) => /^\| W-\d+ /.test(line));
    expect(LAW_COUNT).toBe(48);
    expect(rows).toHaveLength(LAW_COUNT);
  });

  it("maps W-47 (React hooks) to the classes with components, and W-48 to every class", () => {
    const among = (id: string): string[] =>
      PROFILES.filter((p) => mappedLaws(p, noAstro).includes(id)).map((p) => p.class);
    expect(among("W-47")).toEqual(["ui-components", "astro-site", "web-app"]);
    expect(among("W-48")).toEqual(PROFILES.map((p) => p.class));
  });

  it("states W-47 in the Extra laws cells of those three classes, and no class gates W-48", () => {
    const cells = row("Extra laws");
    PROFILES.forEach((p, index) => {
      expect(lawsIn(cells[index] ?? "").includes("W-47"), p.class).toBe(
        p.extraLaws.includes("W-47"),
      );
      expect(p.extraLaws, p.class).not.toContain("W-48");
    });
  });

  it("leaves the judged set and the required counts as they were", () => {
    expect(JUDGED_LAWS).toHaveLength(26);
    expect(JUDGED_LAWS).not.toContain("W-47");
    expect(JUDGED_LAWS).not.toContain("W-48");
    expect(PROFILES.map((p) => requiredLaws(p, noAstro).length)).toEqual([19, 20, 25, 24, 18]);
  });
});
