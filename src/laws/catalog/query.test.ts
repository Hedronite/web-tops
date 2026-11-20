import { describe, expect, it } from "vitest";
import type { Law } from "./types.ts";
import { findLaw, isConditional, select } from "./query.ts";
import { join, resolve } from "node:path";
import { loadCatalog } from "./load.ts";
import { LAW_CLASSES } from "./types.ts";

const ROOT = resolve(import.meta.dirname, "../../..");

/** The kit's own catalog, loaded: a test that needs the real laws fails here if the catalog is invalid. */
function realLaws(): readonly Law[] {
  const loaded = loadCatalog(join(ROOT, "laws"));
  if (!loaded.ok) throw new Error(loaded.problems.map((found) => found.message).join("; "));
  return loaded.laws;
}

const laws = realLaws();
const ids = (shown: readonly { id: string }[]): string[] => shown.map((law) => law.id);

describe("select", () => {
  it("is every law with no filter", () => {
    expect(select(laws, { cls: undefined, required: false })).toHaveLength(49);
  });

  it("is the laws a class maps, required or not", () => {
    const mapped = select(laws, { cls: "node-service", required: false });
    expect(mapped.every((law) => law.classes.includes("node-service"))).toBe(true);
    expect(mapped.length).toBeGreaterThan(
      select(laws, { cls: "node-service", required: true }).length,
    );
    expect(ids(mapped)).not.toContain("W-18");
  });

  it("is the judged laws, with no class: those some class requires", () => {
    const judged = select(laws, { cls: undefined, required: true });
    expect(judged.every((law) => law.judged !== "no")).toBe(true);
    expect(ids(judged)).toContain("W-48");
    expect(ids(judged)).not.toContain("W-03");
  });

  it("is the same set for every class a law maps: a class sees only its own laws", () => {
    for (const cls of LAW_CLASSES) {
      for (const law of select(laws, { cls, required: true })) expect(law.classes).toContain(cls);
    }
  });
});

describe("isConditional and findLaw", () => {
  it("says a class maps a law only with Astro when the law lists it as conditional", () => {
    const w27 = findLaw(laws, "W-27");
    expect(w27 && isConditional(w27, "web-app")).toBe(true);
    expect(w27 && isConditional(w27, "astro-site")).toBe(false);
    expect(w27 && isConditional(w27, undefined)).toBe(false);
  });

  it("says no class is conditional for a law that lists none", () => {
    const w01 = findLaw(laws, "W-01");
    expect(w01 && isConditional(w01, "web-app")).toBe(false);
  });

  it("finds a law by its id, exactly", () => {
    expect(findLaw(laws, "W-05")?.id).toBe("W-05");
    expect(findLaw(laws, "w-05")).toBeUndefined();
    expect(findLaw(laws, "W-99")).toBeUndefined();
  });
});
