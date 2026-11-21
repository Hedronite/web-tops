import { afterEach, describe, expect, it } from "vitest";
import { cleanHandlers, contextOf, fakeExec, prepare, type Prepared } from "./testkit.ts";

const prepared: Prepared[] = [];

afterEach(() => {
  for (const item of prepared.splice(0)) {
    item.project.cleanup();
  }
});

function setup(): Prepared {
  const item = prepare({
    "package.json": '{ "name": "pkg", "version": "1.0.0", "type": "module" }',
  });
  prepared.push(item);
  return item;
}

describe("the hygiene test kit", () => {
  it.each(["bun install", "tsc", "astro", "prettier", "biome", "attw"])(
    "answers a clean %s with exit 0 and nothing printed",
    (name) => {
      expect(cleanHandlers()[name]?.([], "")).toEqual({ code: 0, stdout: "", stderr: "" });
    },
  );

  it("gives the layer PATH set to /usr/bin unless the run names another environment", () => {
    const item = setup();
    const { exec } = fakeExec(item.project.dir);
    expect(contextOf(item, exec).env).toEqual({ PATH: "/usr/bin" });
    expect(contextOf(item, exec, { env: { PATH: "/opt/other" } }).env).toEqual({
      PATH: "/opt/other",
    });
  });
});
