import { describe, expect, it } from "vitest";
import { diffExit, diffJson, diffText } from "./format.ts";
import type { Authority } from "./label.ts";
import type { DiffReport } from "./types.ts";

const clean: DiffReport = {
  base: "origin/main",
  head: "HEAD",
  mergeBase: "0123456789abcdef0123",
  surfaces: [{ name: "compiler flags", compared: 17, items: [] }],
  notCompared: [{ what: "scripts", reason: "not read" }],
};

const weakened: DiffReport = {
  ...clean,
  surfaces: [
    {
      name: "ESLint rule levels",
      compared: 3,
      note: "a note",
      items: [
        { what: "no-var", change: "weakened", before: "error", after: "off", where: "src/a.ts" },
        { what: "eqeqeq", change: "strengthened", before: "off", after: "error" },
        { what: "typescript", change: "changed", before: "6.0.2", after: "6.0.3" },
        { what: "kept", change: "unchanged", before: "1.0.0", after: "1.0.0" },
      ],
    },
    { name: "compiler flags", compared: 17, items: [] },
  ],
};

const trusted: Authority = {
  authorized: true,
  reason: "the protocol-change label is present (a local run: who applied it is not checked)",
};
const untrusted: Authority = { authorized: false, reason: "the protocol-change label is absent" };

describe("the text of the diff", () => {
  it("lists every surface with what was compared, what moved and the result", () => {
    expect(diffText(clean, untrusted)).toBe(
      [
        "law-diff origin/main..HEAD (merge base 0123456789ab)",
        "compiler flags: 17 compared, 0 weakened, 0 strengthened, 0 changed",
        "not compared:",
        "  scripts: not read",
        "nothing weakened",
        "",
      ].join("\n"),
    );
    expect(diffText(weakened, untrusted)).toBe(
      [
        "law-diff origin/main..HEAD (merge base 0123456789ab)",
        "ESLint rule levels: 3 compared, 1 weakened, 1 strengthened, 1 changed",
        "  note: a note",
        "  weakened: no-var: error -> off (src/a.ts)",
        "  strengthened: eqeqeq: off -> error",
        "  changed: typescript: 6.0.2 -> 6.0.3",
        "  unchanged: kept: 1.0.0 -> 1.0.0",
        "compiler flags: 17 compared, 0 weakened, 0 strengthened, 0 changed",
        "not compared:",
        "  scripts: not read",
        "1 weakened: not excused, the protocol-change label is absent",
        "",
      ].join("\n"),
    );
    expect(diffText(weakened, trusted)).toContain(
      "1 weakened: excused, the protocol-change label is present",
    );
  });
});

describe("the JSON of the diff", () => {
  it("is the report with the number weakened and whether the label excuses it", () => {
    const parsed: unknown = JSON.parse(diffJson(weakened, trusted));
    expect(parsed).toMatchObject({ base: "origin/main", weakened: 1, excused: true });
    const plain: unknown = JSON.parse(diffJson(clean, trusted));
    expect(plain).toMatchObject({ weakened: 0, excused: false });
    expect(parsed).toMatchObject({
      notCompared: [{ what: "scripts", reason: "not read" }],
    });
    expect(diffJson(clean, untrusted).endsWith("}\n")).toBe(true);
  });
});

describe("the exit of the diff", () => {
  it("is 0 when nothing weakened or the label excuses it, and 1 when something weakened and nothing does", () => {
    expect(diffExit(clean, untrusted)).toBe(0);
    expect(diffExit(weakened, trusted)).toBe(0);
    expect(diffExit(weakened, untrusted)).toBe(1);
  });
});
