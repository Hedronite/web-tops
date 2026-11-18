import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { madeDirs, put, tempDir } from "../init/test-support.ts";
import { CLAMP_KEY, SUM_KEY, entryYaml, ledgerYaml } from "../survivors/test-support.ts";
import { runCheckCli } from "./check.ts";
import { run } from "./main.ts";

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

const EXAMPLE = readFileSync(
  fileURLToPath(new URL("../../fixtures/config/examples/ts-library.yaml", import.meta.url)),
  "utf8",
);

async function check(dir: string, argv: readonly string[] = []) {
  let out = "";
  let err = "";
  const code = await runCheckCli(argv, {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd: dir,
    env: {},
  });
  return { code, out, err };
}

const project = (ledger?: string): string => {
  const dir = tempDir();
  put(dir, "web-tops.yaml", EXAMPLE);
  if (ledger !== undefined) put(dir, ".web-tops/survivors.yaml", ledger);
  return dir;
};

describe("webtops check reads the survivor ledger", () => {
  it("passes with no ledger, and with a valid one", async () => {
    expect((await check(project())).code).toBe(0);
    const good = ledgerYaml(entryYaml(CLAMP_KEY, ["reason: r", "owner: o", "expires: 2999-01-01"]));
    expect((await check(project(good))).code).toBe(0);
  });

  it("fails an entry with no reason, naming the ledger and the pointer", async () => {
    const { code, err } = await check(project(ledgerYaml(entryYaml(CLAMP_KEY, ["owner: o"]))));
    expect(code).toBe(2);
    expect(err).toContain("web-tops.yaml: invalid");
    expect(err).toContain(".web-tops/survivors.yaml#/survivors/0/reason: reason is missing");
  });

  it("fails an entry with no owner, or a blank one", async () => {
    const missing = await check(project(ledgerYaml(entryYaml(CLAMP_KEY, ["reason: r"]))));
    expect(missing.err).toContain("#/survivors/0/owner: owner is missing");
    const blank = await check(
      project(ledgerYaml(entryYaml(CLAMP_KEY, ["reason: r", 'owner: "  "']))),
    );
    expect(blank.err).toContain("#/survivors/0/owner: owner is blank");
  });

  it("names every problem of every entry", async () => {
    const both = ledgerYaml(entryYaml(CLAMP_KEY, ["owner: o"]), entryYaml(SUM_KEY, ["reason: r"]));
    const { err } = await check(project(both));
    expect(err).toContain("#/survivors/0/reason");
    expect(err).toContain("#/survivors/1/owner");
  });

  it("reads the ledger the config names", async () => {
    const dir = tempDir();
    put(
      dir,
      "web-tops.yaml",
      EXAMPLE.replace("ledger: .web-tops/survivors.yaml", "ledger: accepted.yaml"),
    );
    put(dir, "accepted.yaml", ledgerYaml(entryYaml(CLAMP_KEY, ["owner: o"])));
    expect((await check(dir)).err).toContain("accepted.yaml#/survivors/0/reason");
  });

  it("still reports the config's own problems first, and not the ledger's beside them", async () => {
    const dir = tempDir();
    put(dir, "web-tops.yaml", "bogus: 1\n");
    put(dir, ".web-tops/survivors.yaml", ledgerYaml(entryYaml(CLAMP_KEY, ["owner: o"])));
    const { code, err } = await check(dir);
    expect(code).toBe(2);
    expect(err).not.toContain("survivors.yaml");
  });
});

describe("webtops is the registry of commands", () => {
  it("runs `survivors` through the entry point", async () => {
    let out = "";
    const code = await run(["survivors", "list"], {
      out: (text) => {
        out += text;
      },
      err: () => undefined,
      cwd: tempDir(),
      env: {},
    });
    expect(code).toBe(0);
    expect(out).toContain("0 entries");
  });
});
