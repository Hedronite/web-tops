import { afterEach, describe, expect, it } from "vitest";
import type { Exec } from "../../gate/types.ts";
import { cleanHandlers, fakeExec, prepare, runHygiene, type Prepared } from "./testkit.ts";

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

/** The environment each process the layer starts was given. */
async function environments(options: Parameters<typeof runHygiene>[2]): Promise<unknown[]> {
  const item = setup();
  const fake = fakeExec(item.project.dir);
  const seen: unknown[] = [];
  const exec: Exec = (command, args, run) => {
    seen.push(run?.env);
    return fake.exec(command, args, run);
  };
  await runHygiene(item, exec, options);
  return seen;
}

describe("the hygiene test kit", () => {
  it.each(["bun install", "tsc", "astro", "prettier", "biome", "attw"])(
    "answers a clean %s with exit 0 and nothing printed",
    (name) => {
      expect(cleanHandlers()[name]?.([], "")).toEqual({ code: 0, stdout: "", stderr: "" });
    },
  );

  it("runs the layer with PATH set to /usr/bin unless the run names another environment", async () => {
    const seen = await environments({});
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen.map((env) => JSON.stringify(env)))).toEqual(
      new Set([JSON.stringify({ PATH: "/usr/bin" })]),
    );
  });

  it("gives the layer the environment the run names", async () => {
    const seen = await environments({ env: { PATH: "/opt/other" } });
    expect(new Set(seen.map((env) => JSON.stringify(env)))).toEqual(
      new Set([JSON.stringify({ PATH: "/opt/other" })]),
    );
  });
});
