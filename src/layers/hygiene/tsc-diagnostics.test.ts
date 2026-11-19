import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hygieneLayer } from "./index.ts";
import { failures, fakeExec, prepare, recorded, runHygiene, type Prepared } from "./testkit.ts";

// The hygiene tsc step keeps every diagnostic of `tsc -b --noEmit` in a run artifact that the laws
// layer reads; what the layer reports as findings and as a verdict is unchanged by it.

const prepared: Prepared[] = [];

afterEach(() => {
  for (const item of prepared.splice(0)) {
    item.project.cleanup();
  }
});

const PACKAGE = JSON.stringify({
  name: "pkg",
  version: "1.0.0",
  type: "module",
  exports: { ".": "./dist/index.js" },
});

function setup(): Prepared {
  const item = prepare({ "package.json": PACKAGE });
  prepared.push(item);
  return item;
}

async function runTsc(code: number, stdout: string) {
  const item = setup();
  const fake = fakeExec(item.project.dir, { tsc: () => ({ code, stdout, stderr: "" }) });
  const result = await runHygiene(item, fake.exec);
  const path = join(item.outDir, "hygiene", "tsc-diagnostics.json");
  const written: unknown = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
  return { result, path, written };
}

describe("R87 hygiene tsc: tsc-diagnostics.json", () => {
  it("is declared as an artifact of the hygiene layer", () => {
    expect(hygieneLayer.produces).toContain("tsc-diagnostics");
  });

  it("holds an empty array when the compile was clean, and is listed as the artifact", async () => {
    const { result, path, written } = await runTsc(0, "");
    expect(written).toEqual([]);
    expect(result.artifacts["tsc-diagnostics"]).toBe(path);
    expect(result.verdict).toBe("pass");
  });

  it("holds an empty array on exit 0 whatever the output says", async () => {
    const { written } = await runTsc(0, "src/a.ts(1,2): error TS1005: ';' expected.\n");
    expect(written).toEqual([]);
  });

  it("holds one entry per diagnostic, with file, line, column, code and message", async () => {
    const { result, written } = await runTsc(1, recorded("tsc-errors.txt"));
    expect(written).toEqual([
      {
        file: "src/z.ts",
        line: 1,
        column: 14,
        code: "TS2322",
        message: "Type 'string' is not assignable to type 'number'.",
      },
      {
        file: "src/z.ts",
        line: 2,
        column: 14,
        code: "TS2322",
        message: "Type 'number' is not assignable to type 'string'.",
      },
    ]);
    expect(failures(result)).toEqual(["TS2322", "TS2322"]);
    expect(result.verdict).toBe("fail");
  });

  it("gives a diagnostic with no file null file, line and column, and keeps the verdict as it was", async () => {
    const stdout = "error TS5058: The specified path does not exist: 'src/missing'.\n";
    const { result, written } = await runTsc(1, stdout);
    expect(written).toEqual([
      {
        file: null,
        line: null,
        column: null,
        code: "TS5058",
        message: "The specified path does not exist: 'src/missing'.",
      },
    ]);
    expect(failures(result)).toEqual(["tsc-failed"]);
    expect(result.verdict).toBe("fail");
  });

  it("keeps a file-less diagnostic beside the others, in order, and reports only the ones with a file", async () => {
    const stdout = [
      "error TS5058: The specified path does not exist: 'src/missing'.",
      "src/a.ts(3,7): error TS7006: Parameter 'x' implicitly has an 'any' type.",
      "",
    ].join("\n");
    const { result, written } = await runTsc(1, stdout);
    expect(written).toEqual([
      expect.objectContaining({ file: null, code: "TS5058" }),
      expect.objectContaining({ file: "src/a.ts", line: 3, column: 7, code: "TS7006" }),
    ]);
    expect(failures(result)).toEqual(["TS7006"]);
  });

  it("keeps the first line of a message, not the lines that continue it", async () => {
    const stdout = "src/a.ts(3,7): error TS2345: Argument is wrong.\n  Type 'a' is not 'b'.\n";
    const { written } = await runTsc(1, stdout);
    expect(written).toEqual([
      { file: "src/a.ts", line: 3, column: 7, code: "TS2345", message: "Argument is wrong." },
    ]);
  });

  it("writes a project-relative path with forward slashes", async () => {
    const { written } = await runTsc(1, "src\\deep\\a.ts(3,7): error TS2345: Wrong.\n");
    expect(written).toEqual([
      { file: "src/deep/a.ts", line: 3, column: 7, code: "TS2345", message: "Wrong." },
    ]);
  });

  it("writes nothing when tsc failed with no diagnostic to read, so a missing file means no answer", async () => {
    const { result, written } = await runTsc(2, "something went wrong\n");
    expect(written).toBeUndefined();
    expect(result.artifacts["tsc-diagnostics"]).toBeUndefined();
    expect(failures(result)).toEqual(["tsc-failed"]);
  });

  it("writes nothing when the step is switched off", async () => {
    const item = setup();
    const fake = fakeExec(item.project.dir);
    const result = await runHygiene(item, fake.exec, {
      steps: { tsc: { enabled: false, reason: "not under test" } },
    });
    expect(existsSync(join(item.outDir, "hygiene", "tsc-diagnostics.json"))).toBe(false);
    expect(result.artifacts["tsc-diagnostics"]).toBeUndefined();
  });
});
