import fc from "fast-check";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterAll, describe, expect, it } from "vitest";
import { CLASSES } from "./profiles.ts";
import { PROTOCOL } from "./protocol.ts";
import { endsRun, REQUIRED_UNTIL_PROFILES, VERDICTS, validateReport } from "./report.ts";
import { runSemanticChecks } from "./semantic.ts";
import { at, edit, get, objectLike, objectPaths } from "./test-support.ts";
import { buildReport } from "./test-support-report.ts";
import type { Enforce, Gates, Layers, Switch, Tier, WebTopsConfig } from "./types.ts";
import { parseConfig, validateConfig } from "./validate.ts";

// G1d: properties on parse and validate. Arbitraries produce documents inside the schema.

const reason = fc.string({ minLength: 1, maxLength: 12 }).filter((text) => text.trim() !== "");
const word = fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/);
const file = word.map((name) => `${name}.json`);
const tier = fc.constantFrom<Tier>(0, 1, 2, 3);
const optional: { requiredKeys: never[] } = { requiredKeys: [] };

const toggle: fc.Arbitrary<Switch> = fc.oneof(
  fc.constant<Switch>({}),
  fc.constant<Switch>({ enabled: true }),
  reason.map((text): Switch => ({ enabled: false, reason: text })),
);

function section<T extends object>(fields: fc.Arbitrary<T>): fc.Arbitrary<Switch & T> {
  return fc.tuple(toggle, fields).map(([on, rest]) => ({ ...on, ...rest }));
}

const none = fc.constant({});

const gates: fc.Arbitrary<Gates> = fc.record(
  {
    hygiene: section(
      fc.record(
        {
          install: section(none),
          tsc: section(none),
          astro_check: section(none),
          eslint: section(fc.record({ config: file }, optional)),
          stylelint: section(none),
          format: section(fc.record({ tool: fc.constantFrom("prettier", "biome") }, optional)),
          dependency_cruiser: section(none),
          audit: section(
            fc.record(
              { fail_on: fc.constantFrom("low", "moderate", "high", "critical") },
              optional,
            ),
          ),
        },
        optional,
      ),
    ),
    tests: section(
      fc.record({ runner: fc.constantFrom("vitest"), shuffle: fc.boolean() }, optional),
    ),
    coverage: section(
      fc.record(
        {
          lines_floor: fc.integer({ min: 0, max: 100 }),
          exclude: fc.array(fc.record({ glob: word, reason }), { maxLength: 3 }),
        },
        optional,
      ),
    ),
    crap: section(
      fc.record(
        {
          cap: fc.integer({ min: 1, max: 20 }),
          scope: fc.constantFrom("diff", "all"),
          complexity: fc.record({ nullish_discount: fc.boolean() }, optional),
        },
        optional,
      ),
    ),
    mutation: section(
      fc.record(
        {
          engine: fc.constantFrom("stryker"),
          scope: fc.constantFrom("diff", "all"),
          base: word,
          unexplained_survivors_max: fc.nat({ max: 5 }),
          ledger: file,
        },
        optional,
      ),
    ),
  },
  optional,
);

const layer = fc
  .tuple(toggle, fc.record({ tier }, optional))
  .map(([on, rest]) => ({ ...on, ...rest }));

const layers: fc.Arbitrary<Layers> = fc.record(
  {
    size_limit: layer,
    package_exports: layer,
    html_validate: layer,
    axe: layer,
    rendered: layer,
    themes: layer,
    custom: fc.array(fc.record({ id: word, tier, command: word }), { maxLength: 3 }),
  },
  optional,
);

const config: fc.Arbitrary<WebTopsConfig> = fc.record(
  {
    protocol: fc.constant(PROTOCOL),
    version: word,
    package: word,
    class: fc.constantFrom(...CLASSES),
    enforce: fc.constantFrom<Enforce>("hard", "ratchet", "advisory"),
    baseline: file,
    report: fc.record({ path: file }),
    exemption: fc.record({ until: fc.constant("2099-12-31"), reason }),
    toolchain: fc.record(
      { typescript: fc.constant("6.0.3"), runtime: fc.constantFrom("bun", "node") },
      optional,
    ),
    gates,
    layers,
    laws: section(
      fc.record({ select: fc.constantFrom("default", "all"), ack_ledger: file }, optional),
    ),
  },
  { requiredKeys: ["protocol", "version", "package", "class", "enforce", "baseline", "report"] },
);

function copy(value: unknown): unknown {
  const text: unknown = JSON.stringify(value);
  return typeof text === "string" ? JSON.parse(text) : undefined;
}

describe("validateConfig and parseConfig", () => {
  it("accept every generated config, and keep it as it was", () => {
    fc.assert(
      fc.property(config, (cfg) => {
        const result = validateConfig(copy(cfg));
        expect(result).toEqual({ ok: true, value: cfg });
      }),
    );
  });

  it("round-trip through YAML text", () => {
    fc.assert(
      fc.property(config, (cfg) => {
        expect(parseConfig(stringify(cfg))).toEqual({ ok: true, value: cfg });
      }),
    );
  });

  it("refuse an unknown key at any object in the document, naming it", () => {
    fc.assert(
      fc.property(config, fc.nat(), (cfg, pick) => {
        const parents = objectPaths(cfg);
        const parent = parents[pick % parents.length] ?? [];
        const result = validateConfig(edit(cfg, [...parent, "zz_unknown"], 1));
        expect(result.ok).toBe(false);
        expect(get(result, "problems")).toContainEqual(
          objectLike({ pointer: `/${[...parent, "zz_unknown"].join("/")}` }),
        );
      }),
    );
  });

  const switchable: readonly (readonly string[])[] = [
    ["gates", "hygiene"],
    ["gates", "hygiene", "eslint"],
    ["gates", "hygiene", "stylelint"],
    ["gates", "hygiene", "format"],
    ["gates", "tests"],
    ["gates", "coverage"],
    ["gates", "crap"],
    ["gates", "mutation"],
    ["layers", "size_limit"],
    ["layers", "axe"],
    ["laws"],
  ];

  it("refuse `enabled: false` without a reason, at every switch", () => {
    const missing = fc.constantFrom<unknown>(undefined, "", "   ", "\t\n");
    fc.assert(
      fc.property(config, fc.constantFrom(...switchable), missing, (cfg, path, text) => {
        let doc: unknown = cfg;
        for (let depth = 1; depth <= path.length; depth += 1) {
          const prefix = path.slice(0, depth);
          if (at(doc, prefix) === undefined) doc = edit(doc, prefix, {});
        }
        const off = text === undefined ? { enabled: false } : { enabled: false, reason: text };
        const result = validateConfig(edit(doc, path, off));
        expect(result.ok).toBe(false);
        expect(get(result, "problems")).toContainEqual(
          objectLike({ pointer: `/${[...path, "reason"].join("/")}` }),
        );
      }),
    );
  });

  it("never throw on JSON, and every problem has a pointer", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const result = validateConfig(copy(value));
        if (result.ok) return;
        expect(result.problems.length).toBeGreaterThan(0);
        for (const problem of result.problems) expect(problem.pointer).toMatch(/^(\/.*)?$/);
      }),
    );
  });

  it("never throw on text, and refuse text that is not a mapping", () => {
    const line = fc.constantFrom(
      "a: 1",
      "- x",
      "key: [",
      "  b: {",
      "&a x",
      "*a",
      "? ",
      "---",
      "...",
      "\t",
      'protocol: "0.3.0"',
      "!!str",
      "}",
    );
    const yamlish = fc.array(line, { maxLength: 12 }).map((lines) => lines.join("\n"));
    fc.assert(
      fc.property(fc.oneof(fc.string(), yamlish), (text) => {
        const result = parseConfig(text);
        if (result.ok) return;
        expect(result.problems.length).toBeGreaterThan(0);
      }),
    );
  });
});

describe("runSemanticChecks", () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-properties-"));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("never throws, and points at the config", () => {
    fc.assert(
      fc.property(config, (cfg) => {
        for (const problem of runSemanticChecks(cfg, { cwd: dir, today: "2026-11-16" })) {
          expect(problem.pointer).toMatch(/^\//);
          expect(problem.message).not.toBe("");
        }
      }),
      { numRuns: 30 },
    );
  });

  it("a bare hard config of a launch class has no semantic problem", () => {
    fc.assert(
      fc.property(fc.constantFrom(...CLASSES.slice(0, 5)), (name) => {
        const cfg: WebTopsConfig = {
          protocol: PROTOCOL,
          version: "1",
          package: "p",
          class: name,
          enforce: "hard",
          baseline: "b.json",
          report: { path: "r.json" },
        };
        expect(runSemanticChecks(cfg, { cwd: dir })).toEqual([]);
      }),
    );
  });
});

describe("validateReport", () => {
  const verdicts = fc.array(fc.constantFrom(...VERDICTS), { minLength: 7, maxLength: 7 });
  const generated = fc
    .tuple(verdicts, fc.constantFrom<Enforce>("hard", "ratchet", "advisory"))
    .map(([list, enforce]) =>
      buildReport(
        {
          hygiene: list[0],
          tests: list[1],
          coverage: list[2],
          crap: list[3],
          mutation: list[4],
          "build-output": list[5],
          laws: list[6],
        },
        { enforce },
      ),
    );

  it("accepts every consistent report", () => {
    fc.assert(
      fc.property(generated, (report) => {
        expect(validateReport(report)).toEqual({ ok: true, value: report });
      }),
    );
  });

  it("refuses a report that loses a verdict, whichever layer", () => {
    fc.assert(
      fc.property(generated, fc.nat({ max: 6 }), (report, index) => {
        const result = validateReport(edit(report, ["layers", String(index), "verdict"]));
        expect(result.ok).toBe(false);
        expect(get(result, "problems")).toContainEqual(
          objectLike({ pointer: `/layers/${String(index)}/verdict` }),
        );
      }),
    );
  });

  it("refuses a count that is off by one", () => {
    fc.assert(
      fc.property(
        generated,
        fc.constantFrom("failed", "not_evaluated"),
        fc.constantFrom(-1, 1),
        (report, key, delta) => {
          const current = get(report.counts, key);
          if (typeof current !== "number" || current + delta < 0) return;
          const result = validateReport(edit(report, ["counts", key], current + delta));
          expect(result.ok).toBe(false);
        },
      ),
    );
  });

  it("a vacuous layer does not end the run: a report that passes with one is accepted (fixed case)", () => {
    const report = buildReport({ mutation: "vacuous" });
    expect(report.passed).toBe(true);
    expect(validateReport(report).ok).toBe(true);
    expect(validateReport(edit(report, ["passed"], false)).ok).toBe(false);
  });

  it("never lets a layer whose verdict ends the run pass an enforced run", () => {
    fc.assert(
      fc.property(generated, (report) => {
        const claimsPass = validateReport(edit(report, ["passed"], true)).ok;
        const clean = !report.layers.some((entry) =>
          endsRun(entry.verdict, REQUIRED_UNTIL_PROFILES),
        );
        if (report.enforced && !clean) expect(claimsPass).toBe(false);
      }),
    );
  });
});
