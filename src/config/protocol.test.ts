import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import configSchema from "../../schema/web-tops.schema.json" with { type: "json" };
import reportSchema from "../../schema/gate-report.schema.json" with { type: "json" };
import {
  PROTOCOL,
  PROTOCOL_MINOR,
  PROTOCOL_PATTERN,
  PROTOCOL_RANGE,
  inProtocolRange,
} from "./protocol.ts";
import { get } from "./test-support.ts";

const src = join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

describe("G0c: the protocol id is held by range, in one place", () => {
  it("is 0.3.0, the first patch of the minor the kit supports", () => {
    expect(PROTOCOL).toBe("0.3.0");
    expect(PROTOCOL_MINOR).toBe("0.3");
    expect(PROTOCOL_RANGE).toBe("0.3.x");
    expect(inProtocolRange(PROTOCOL)).toBe(true);
  });

  it.each(["0.3.0", "0.3.1", "0.3.7", "0.3.10", "0.3.123"])("accepts %s", (id) => {
    expect(inProtocolRange(id)).toBe(true);
  });

  it.each([
    "0.2.1",
    "0.2.0",
    "0.4.0",
    "1.3.0",
    "0.30.0",
    "0.3",
    "0.3.",
    "0.3.x",
    "0.3.0-rc.1",
    " 0.3.0",
    "0.3.0 ",
    "",
  ])("rejects %j", (id) => {
    expect(inProtocolRange(id)).toBe(false);
  });

  it.each([undefined, null, 0.3, 3, true, ["0.3.0"], { protocol: "0.3.0" }])(
    "rejects the non-string %j",
    (value) => {
      expect(inProtocolRange(value)).toBe(false);
    },
  );

  it("is the pattern both schemas carry for protocol, with no const left", () => {
    const shape = { type: "string", pattern: PROTOCOL_PATTERN };
    expect(PROTOCOL_PATTERN).toBe("^0\\.3\\.[0-9]+$");
    expect(get(get(configSchema, "properties"), "protocol")).toEqual(shape);
    expect(get(get(reportSchema, "properties"), "protocol")).toEqual(shape);
  });

  it("names the minor, not a patch, in each schema $id", () => {
    expect(get(configSchema, "$id")).toBe(
      `https://hedronite.com/schemas/web-tops/${PROTOCOL_MINOR}/web-tops.schema.json`,
    );
    expect(get(reportSchema, "$id")).toBe(
      `https://hedronite.com/schemas/web-tops/${PROTOCOL_MINOR}/gate-report.schema.json`,
    );
  });

  it("is written once in src: no other source file quotes the minor", () => {
    const holders = sourceFiles(src)
      .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"))
      .filter((path) => /["'`]0\.3(\.0)?["'`]/.test(readFileSync(path, "utf8")))
      .map((path) => relative(src, path));
    expect(holders).toEqual([join("config", "protocol.ts")]);
  });
});
