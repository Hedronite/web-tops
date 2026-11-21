import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runTool } from "../../layers/hygiene/tooling.ts";
import { inputFor, lawOf } from "./testkit.ts";

const dir = mkdtempSync(join(tmpdir(), "wt-tool-missing-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("runTool of a tool the project has not installed", () => {
  it.each(["secretlint", "knip"])("gives %s as missing, with nothing printed", async (tool) => {
    const { ctx } = inputFor([lawOf("W-01", [])], { cwd: dir });
    const result = await runTool(ctx, tool, ["--version"]);
    expect(result.code).toBeNull();
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(`${tool} is not installed in node_modules`);
    expect(result.failure).toBe("tool-missing");
  });
});
