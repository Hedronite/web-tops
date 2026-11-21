import { describe, expect, it } from "vitest";
import { lawDiff, type Deps } from "./run.ts";
import type { Part, Snapshot } from "./types.ts";

const absent: Part<never> = { state: "absent" };
const empty: Snapshot = {
  tracked: ["src/new.ts"],
  tools: absent,
  levels: absent,
  flags: absent,
  settings: absent,
  laws: absent,
  profile: absent,
};

interface Trail {
  readonly events: string[];
}

function deps(trail: Trail, extra: Partial<Deps> = {}): Deps {
  return {
    mergeBase: (base, head) => {
      trail.events.push(`merge-base ${base} ${head}`);
      return Promise.resolve("abc123def4567890");
    },
    checkout: (ref) => {
      trail.events.push(`checkout ${ref}`);
      return Promise.resolve({
        dir: `/tree/${ref}`,
        cleanup: () => {
          trail.events.push(`cleanup ${ref}`);
          return Promise.resolve();
        },
      });
    },
    renames: (base, head) => {
      trail.events.push(`renames ${base} ${head}`);
      return Promise.resolve(new Map());
    },
    snapshot: (dir, extra) => {
      trail.events.push(`snapshot ${dir} ${extra.join(",")}`);
      return Promise.resolve(empty);
    },
    ...extra,
  };
}

describe("the diff of a head against its merge base", () => {
  it("checks out the merge base, then the head, reads each, takes each down, and lists every surface", async () => {
    const trail: Trail = { events: [] };
    const done = await lawDiff(deps(trail), "origin/main", "feature");
    expect(trail.events).toEqual([
      "merge-base origin/main feature",
      "renames abc123def4567890 feature",
      "checkout feature",
      "snapshot /tree/feature ",
      "cleanup feature",
      "checkout abc123def4567890",
      "snapshot /tree/abc123def4567890 src/new.ts",
      "cleanup abc123def4567890",
    ]);
    expect(done.ok && done.report).toMatchObject({
      base: "origin/main",
      head: "feature",
      mergeBase: "abc123def4567890",
    });
    expect(done.ok && done.report.surfaces.map((surface) => surface.name)).toEqual([
      "ESLint rule levels and options",
      "compiler flags",
      "gate settings, floors, caps and budgets",
      "law catalog",
      "profile",
      "tool versions",
    ]);
  });

  it("says why when the refs have no merge base, and checks out nothing", async () => {
    const trail: Trail = { events: [] };
    const done = await lawDiff(
      deps(trail, { mergeBase: () => Promise.resolve({ error: "no merge base of a and b" }) }),
      "a",
      "b",
    );
    expect(done).toEqual({ ok: false, message: "no merge base of a and b" });
    expect(trail.events).toEqual([]);
  });

  it("says why when the renames cannot be listed, and checks out nothing", async () => {
    const trail: Trail = { events: [] };
    const done = await lawDiff(
      deps(trail, { renames: () => Promise.resolve({ error: "cannot list" }) }),
      "a",
      "b",
    );
    expect(done).toEqual({ ok: false, message: "cannot list" });
    expect(trail.events).toEqual(["merge-base a b"]);
  });

  it("takes a checkout down even when reading it throws", async () => {
    const trail: Trail = { events: [] };
    const failing = deps(trail, { snapshot: () => Promise.reject(new Error("tool crashed")) });
    await expect(lawDiff(failing, "a", "b")).rejects.toThrow("tool crashed");
    expect(trail.events).toEqual([
      "merge-base a b",
      "renames abc123def4567890 b",
      "checkout b",
      "cleanup b",
    ]);
  });
});
