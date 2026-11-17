import { describe, expect, it } from "vitest";
import configSchema from "../../schema/web-tops.schema.json" with { type: "json" };
import reportSchema from "../../schema/gate-report.schema.json" with { type: "json" };
import { CLASSES, LAYER_KEYS, STEP_KEYS } from "./profiles.ts";
import { PROTOCOL_PATTERN } from "./protocol.ts";
import { LAYER_IDS } from "./report.ts";
import {
  at,
  containing,
  fixture,
  get,
  keyPaths,
  keys,
  matching,
  objectLike,
} from "./test-support.ts";
import { loadConfig, parseConfig, parseYaml, validateConfig } from "./validate.ts";

function loaded(name: string): ReturnType<typeof loadConfig> {
  return loadConfig(fixture(name));
}

// Every key of WEB_TOPS.md section 9, as dotted paths.
const SECTION_9_KEYS = [
  "protocol",
  "version",
  "package",
  "class",
  "enforce",
  "baseline",
  "exemption.until",
  "exemption.reason",
  "toolchain.typescript",
  "toolchain.runtime",
  "gates.hygiene.install",
  "gates.hygiene.tsc",
  "gates.hygiene.astro_check",
  "gates.hygiene.eslint.config",
  "gates.hygiene.stylelint.enabled",
  "gates.hygiene.stylelint.reason",
  "gates.hygiene.format.tool",
  "gates.hygiene.dependency_cruiser",
  "gates.hygiene.audit.fail_on",
  "gates.tests.runner",
  "gates.tests.shuffle",
  "gates.coverage.lines_floor",
  "gates.coverage.exclude",
  "gates.crap.cap",
  "gates.crap.scope",
  "gates.crap.complexity.nullish_discount",
  "gates.mutation.engine",
  "gates.mutation.scope",
  "gates.mutation.base",
  "gates.mutation.unexplained_survivors_max",
  "gates.mutation.ledger",
  "layers.size_limit.tier",
  "layers.package_exports.tier",
  "layers.html_validate.enabled",
  "layers.axe.enabled",
  "layers.rendered.enabled",
  "layers.themes.enabled",
  "layers.custom",
  "laws.select",
  "laws.ack_ledger",
  "report.path",
];

describe("G1a: web-tops.schema.json covers every section 9 key", () => {
  it("a valid example sets every key, and it validates", () => {
    const result = loaded("valid/full.yaml");
    expect(result.ok).toBe(true);
    // `exemption` belongs to advisory, so it is set in its own fixture.
    const keys = new Set([
      ...keyPaths(get(result, "value")),
      ...keyPaths(get(loaded("valid/advisory.yaml"), "value")),
    ]);
    for (const key of SECTION_9_KEYS) expect(keys, key).toContain(key);
  });

  it("fills the schema defaults: enforce ratchet, the baseline path, the report path", () => {
    const result = loaded("valid/minimal.yaml");
    expect(result.ok).toBe(true);
    expect(get(get(result, "value"), "enforce")).toBe("ratchet");
    expect(get(get(result, "value"), "baseline")).toBe(".web-tops/baseline.json");
    expect(at(get(result, "value"), ["report", "path"])).toBe(".web-tops/report.json");
  });

  it("keeps what the file sets over a default", () => {
    const result = parseConfig(
      'protocol: "0.3.0"\nversion: "1"\npackage: p\nclass: web-app\nenforce: hard\nbaseline: b.json\nreport: { path: r.json }\n',
    );
    expect(get(get(result, "value"), "baseline")).toBe("b.json");
    expect(at(get(result, "value"), ["report", "path"])).toBe("r.json");
  });

  it("matches the protocol by the minor, not one patch, in both schemas", () => {
    const shape = { type: "string", pattern: PROTOCOL_PATTERN };
    expect(get(get(configSchema, "properties"), "protocol")).toEqual(shape);
    expect(get(get(reportSchema, "properties"), "protocol")).toEqual(shape);
  });

  it("agrees with the class table and the layer keys", () => {
    const props = get(configSchema, "properties");
    expect(get(get(props, "class"), "enum")).toEqual([...CLASSES]);
    expect(get(get(reportSchema, "properties"), "class")).toEqual({ enum: [...CLASSES] });
    const layers = keys(get(get(props, "layers"), "properties"));
    expect(layers.filter((key) => key !== "custom").sort()).toEqual([...LAYER_KEYS].sort());
    expect(layers).toContain("custom");
    const steps = keys(get(get(get(get(props, "gates"), "properties"), "hygiene"), "properties"));
    expect(steps.sort()).toEqual([...STEP_KEYS].sort());
  });

  it("an unknown key fails, at the root and in a nested object", () => {
    const root = parseConfig(
      'protocol: "0.3.0"\nversion: "1"\npackage: p\nclass: web-app\nzz: 1\n',
    );
    expect(root).toEqual({ ok: false, problems: [objectLike({ pointer: "/zz" })] });
    const nested = parseConfig(
      'protocol: "0.3.0"\nversion: "1"\npackage: p\nclass: web-app\nlayers: { axe: { zz: 1 } }\n',
    );
    expect(nested).toEqual({ ok: false, problems: [objectLike({ pointer: "/layers/axe/zz" })] });
  });
});

describe("parseYaml", () => {
  it("gives the plain value of a document that fails check, and a problem for one that will not parse", () => {
    const text = 'class: cli\ntoolchain: { typescript: "^6" }\nreport: { path: r.json }\nzz: 1\n';
    expect(parseConfig(text).ok).toBe(false);
    expect(parseYaml(text)).toEqual({
      ok: true,
      value: { class: "cli", toolchain: { typescript: "^6" }, report: { path: "r.json" }, zz: 1 },
    });
    expect(parseYaml("")).toEqual({ ok: true, value: null });
    expect(parseYaml("a: [unclosed\n")).toEqual({
      ok: false,
      problems: [{ pointer: "", message: matching(/line \d+/) }],
    });
    expect(parseYaml("a: 1\na: 2\n").ok).toBe(false);
  });
});

describe("parse and validate edge cases", () => {
  it.each([null, "text", 42, [], true])(
    "validateConfig(%j) is a problem at the document",
    (value) => {
      const result = validateConfig(value);
      expect(result.ok).toBe(false);
      expect(get(result, "problems")).toContainEqual(objectLike({ pointer: "" }));
    },
  );

  it("a YAML syntax error is a problem at the document, naming the line", () => {
    const result = parseConfig("a: [unclosed\nb: 2\n");
    expect(result.ok).toBe(false);
    expect(get(result, "problems")).toEqual([
      objectLike({ pointer: "", message: matching(/line \d+/) }),
    ]);
  });

  it("a duplicate key is refused", () => {
    expect(loaded("invalid/duplicate-key.yaml").ok).toBe(false);
  });

  it("an alias bomb is a problem, not a throw", () => {
    const bomb = `a: &a [x]\nb: &b [${Array.from({ length: 150 }, () => "*a").join(",")}]\nc: [*b, *b, *b]\n`;
    expect(parseConfig(bomb).ok).toBe(false);
  });

  it("an unreadable file is a problem naming the path", () => {
    const result = loadConfig(fixture("no-such-file.yaml"));
    expect(result.ok).toBe(false);
    expect(get(get(result, "problems"), "0")).toEqual({
      pointer: "",
      message: containing("no-such-file.yaml"),
    });
  });

  it("escapes ~ and / in a pointer", () => {
    const result = parseConfig(
      'protocol: "0.3.0"\nversion: "1"\npackage: p\nclass: web-app\nlayers: { "a/b~c": 1 }\n',
    );
    expect(get(result, "problems")).toContainEqual(objectLike({ pointer: "/layers/a~1b~0c" }));
  });

  it("names the allowed values of a failed enum and the range of a protocol outside it", () => {
    const result = loaded("invalid/bad-class.yaml");
    expect(get(result, "problems")).toContainEqual({
      pointer: "/class",
      message: containing('"ts-library"'),
    });
    expect(get(loaded("invalid/wrong-protocol.yaml"), "problems")).toContainEqual({
      pointer: "/protocol",
      message: containing("0.3.x"),
    });
  });

  it("reports each problem once", () => {
    const problems = get(loaded("invalid/disabled-blank-reason.yaml"), "problems");
    const lines = keys(problems).map((index) => JSON.stringify(get(problems, index)));
    expect(new Set(lines).size).toBe(lines.length);
    expect(lines.length).toBeGreaterThan(0);
  });
});

describe("G1b reader tables match the schema", () => {
  it("lists the built-in layers and takes the verdicts of section 3.3 from the core schema", () => {
    const layer = get(get(reportSchema, "$defs"), "layer");
    expect(get(get(get(layer, "properties"), "verdict"), "$ref")).toBe(
      "core.schema.json#/$defs/verdict",
    );
    const contains = get(reportSchema, "properties");
    expect(JSON.stringify(get(get(contains, "layers"), "allOf"))).toBe(
      JSON.stringify(
        LAYER_IDS.map((id) => ({
          contains: { type: "object", properties: { id: { const: id } }, required: ["id"] },
        })),
      ),
    );
  });
});
