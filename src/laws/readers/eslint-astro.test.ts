import { describe, expect, it } from "vitest";
import type { Levels } from "../../census/config.ts";
import { readLaw, type Evidence } from "./eslint-judge.ts";
import type { LawEntry } from "./types.ts";

/** The rules of an Astro project are judged over every file ESLint reads, `.astro` pages included. */

const ASTRO = "webtops/astro-client-load-ack";
const ENV = "webtops/public-env-only";

const law = (...names: string[]): LawEntry => ({
  id: "W-28",
  severity: "R",
  reader: "tl",
  classes: [],
  judged: true,
  rules: names.map((name) => ({ tool: "eslint", name })),
});

function evidence(table: Record<string, Record<string, number>>): Evidence {
  const levels: Levels = new Map(
    Object.entries(table).map(([file, rules]) => [file, new Map(Object.entries(rules))]),
  );
  return {
    levels,
    counts: new Map(),
    config: [{ file: "eslint.config.js", text: "export default [];\n" }],
    configFile: "eslint.config.js",
    held: false,
  };
}

describe("a rule that only .astro files carry", () => {
  it("passes when every .astro file has it at error, though no TypeScript file sets it", () => {
    const found = readLaw(
      evidence({ "src/a.ts": { other: 2 }, "src/page.astro": { [ASTRO]: 2 } }),
      law(ASTRO),
    );
    expect(found).toEqual({ law: "W-28", verdict: "pass", findings: [] });
  });

  it("is refused at its config line when an override sets it to off for a page", () => {
    const text = [
      "export default [",
      `  { files: ["**/*.astro"], rules: { "${ASTRO}": "off" } },`,
      "];",
    ].join("\n");
    const base = evidence({ "src/a.ts": { other: 2 }, "src/page.astro": { [ASTRO]: 0 } });
    const found = readLaw({ ...base, config: [{ file: "eslint.config.js", text }] }, law(ASTRO));
    expect(found.verdict).toBe("refuse");
    expect(found.findings).toMatchObject([{ rule: ASTRO, file: "eslint.config.js", line: 2 }]);
    expect(found.findings[0]?.message).toBe(
      `${ASTRO} is below error for 1 file(s), such as src/page.astro`,
    );
  });

  it("with .astro only, and no TypeScript file at all, is still judged", () => {
    const found = readLaw(evidence({ "src/page.astro": { [ASTRO]: 2 } }), law(ASTRO));
    expect(found.verdict).toBe("pass");
  });

  it("is not enabled when no file the project lints has it at all", () => {
    const found = readLaw(
      evidence({ "src/a.ts": { other: 2 }, "src/page.astro": { other: 2 } }),
      law(ASTRO),
    );
    expect(found.verdict).toBe("refuse");
    expect(found.findings[0]?.message).toBe(
      `${ASTRO} is not enabled for any file the project lints`,
    );
  });
});

describe("a rule scoped to a file type the project has none of", () => {
  it("passes on the probe path of that type, and the pass says so", () => {
    const table = {
      "src/page.astro": { other: 2 },
      "src/__webtops_probe__.tsx": { [ENV]: 2 },
    };
    const found = readLaw(evidence(table), law(ENV));
    expect(found).toEqual({
      law: "W-28",
      verdict: "pass",
      findings: [],
      note: `${ENV} judged on a probe path: the project has no .tsx file`,
    });
  });

  it("is not a probe pass when a real file of the type has it at error too", () => {
    const table = {
      "src/a.tsx": { [ENV]: 2 },
      "src/__webtops_probe__.ts": { [ENV]: 2 },
    };
    expect(readLaw(evidence(table), law(ENV)).note).toBeUndefined();
  });

  it("is refused when the probe path has it below error", () => {
    const table = { "src/page.astro": { other: 2 }, "src/__webtops_probe__.tsx": { [ENV]: 1 } };
    expect(readLaw(evidence(table), law(ENV)).verdict).toBe("refuse");
  });

  it("is refused as not enabled when not even the probe path has it", () => {
    const table = { "src/page.astro": { other: 2 }, "src/__webtops_probe__.tsx": { other: 2 } };
    expect(readLaw(evidence(table), law(ENV)).verdict).toBe("refuse");
  });

  it("says each probe pass, joined, beside what the baseline holds", () => {
    const table = { "src/p.astro": { x: 2 }, "src/__webtops_probe__.tsx": { [ENV]: 2, "a/b": 2 } };
    const found = readLaw(
      { ...evidence(table), counts: new Map([["a/b", 3]]), held: true },
      law(ENV, "a/b"),
    );
    expect(found.note).toBe(
      `a/b 3 held by the baseline; ${ENV} judged on a probe path: the project has no .tsx file; a/b judged on a probe path: the project has no .tsx file`,
    );
  });
});

describe("a rule the preset sets on a page's script blocks", () => {
  const SCRIPT = "src/page.astro/0.ts";

  it("is refused at its config line when an override sets it off for the script blocks", () => {
    const text = [
      "export default [",
      `  { files: ["**/*.astro/*.ts"], rules: { "${ENV}": "off" } },`,
      "];",
    ].join("\n");
    const table = {
      "src/__webtops_probe__.tsx": { [ENV]: 2 },
      [SCRIPT]: { [ENV]: 0 },
      "src/page.astro/0.js": { [ENV]: 2 },
    };
    const found = readLaw(
      { ...evidence(table), config: [{ file: "eslint.config.js", text }] },
      law(ENV),
    );
    expect(found.verdict).toBe("refuse");
    expect(found.findings).toMatchObject([{ rule: ENV, file: "eslint.config.js", line: 2 }]);
    expect(found.findings[0]?.message).toBe(
      `${ENV} is below error for 1 file(s), such as ${SCRIPT}`,
    );
  });

  it("names the probe path of the type, never a real file, when the page is a probe", () => {
    const table = { "src/__webtops_probe__.astro/0.ts": { [ENV]: 0 } };
    const found = readLaw(evidence(table), law(ENV));
    expect(found.findings[0]?.message).toBe(
      `${ENV} is below error for 1 file(s), such as the probe path for .astro script blocks`,
    );
    const tsx = readLaw(evidence({ "src/__webtops_probe__.tsx": { [ENV]: 1 } }), law(ENV));
    expect(tsx.findings[0]?.message).toBe(
      `${ENV} is below error for 1 file(s), such as the probe path for .tsx files`,
    );
  });

  it("passes with a note naming every kind of probe path it rests on", () => {
    const table = {
      "src/__webtops_probe__.tsx": { [ENV]: 2 },
      "src/__webtops_probe__.astro/0.ts": { [ENV]: 2 },
      "src/__webtops_probe__.astro/0.js": { [ENV]: 2 },
    };
    expect(readLaw(evidence(table), law(ENV)).note).toBe(
      `${ENV} judged on a probe path: the project has no .tsx file, no .astro script block`,
    );
  });

  it("is not a probe pass when a real script block has it at error", () => {
    const table = { "src/__webtops_probe__.tsx": { [ENV]: 2 }, [SCRIPT]: { [ENV]: 2 } };
    expect(readLaw(evidence(table), law(ENV)).note).toBeUndefined();
  });
});
