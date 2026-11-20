import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";
import { lawsOfClass } from "../laws/probe/catalog.ts";
import { kitProbeLaws } from "../laws/probe/testkit.ts";
import { cleanTemp, put, tempDir } from "../laws/probe/testkit.ts";
import type { LawSource } from "../laws/probe/types.ts";
import { runLawsCli } from "./laws.ts";
import { CatalogError } from "../laws/probe/catalog.ts";
import {
  adopter,
  cli,
  KIT,
  messages,
  probeOf,
  probeProcess,
  verdicts,
} from "./test-support-probe.ts";

afterAll(cleanTemp);

const KIT_LAWS = lawsOfClass(kitProbeLaws(), "ts-library").length;

describe("G3b `laws probe`: arguments and problems", () => {
  it("rejects an argument it does not know, and a flag with no value, with the usage", async () => {
    const unknown = await cli(["--wat"], tempDir());
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain("webtops laws probe:");
    expect(unknown.err).toContain("usage: webtops laws probe [--law W-NN]");
    expect((await cli(["--law"], tempDir())).code).toBe(2);
    expect((await cli(["stray"], tempDir())).code).toBe(2);
  });

  it("names a law the catalog does not have", async () => {
    const result = await cli(["--law", "W-98"], tempDir());
    expect(result).toMatchObject({ code: 2, err: "webtops laws probe: no law W-98 to probe\n" });
  });

  it("is routed from `webtops laws probe`, with the probe's own messages and its own exit code", async () => {
    let out = "";
    let err = "";
    const io = {
      out: (text: string) => {
        out += text;
      },
      err: (text: string) => {
        err += text;
      },
      cwd: tempDir(),
      env: {},
    };
    const code = await runLawsCli(["probe", "--wat"], io);
    expect(code).toBe(2);
    expect(err.startsWith("webtops laws probe: ")).toBe(true);
    expect(err).toContain("usage: webtops laws probe [--law W-NN]");
    expect(out).toBe("");
  });

  it("a catalog that cannot be read is exit 2 with its problems, never an empty probe", async () => {
    const broken: LawSource = () => {
      throw new CatalogError("the catalog is invalid: laws/W-01.yaml/id: is required");
    };
    const result = await cli([], tempDir(), { laws: broken });
    expect(result).toMatchObject({
      code: 2,
      err: "webtops laws probe: the catalog is invalid: laws/W-01.yaml/id: is required\n",
    });
  });

  it("an error that is not the catalog's is not hidden as a usage problem: it is thrown", async () => {
    const crashed: LawSource = () => {
      throw new Error("disk on fire");
    };
    await expect(cli([], tempDir(), { laws: crashed })).rejects.toThrow("disk on fire");
  });

  it("says so when the catalog has no law at all", async () => {
    const empty: LawSource = () => [];
    const result = await cli([], tempDir(), { laws: empty });
    expect(result).toMatchObject({ code: 2, err: "webtops laws probe: no law to probe\n" });
  });
});

describe("G3b `laws probe` on a project's own config", () => {
  let kitLike: Awaited<ReturnType<typeof probeOf>>;
  let kitText: string;
  beforeAll(async () => {
    const dir = adopter();
    kitLike = await probeOf(dir);
    kitText = probeProcess(dir).out;
  }, REAL_TOOL_TIMEOUT);

  it("passes every law under a config that is the kit's, with no finding left unexplained", () => {
    expect(kitLike.code).toBe(0);
    expect(verdicts(kitLike.report)).toEqual(
      lawsOfClass(kitProbeLaws(), "ts-library").map((law) => `${law.id} pass`),
    );
    expect(kitLike.report.laws.flatMap((law) => law.unrelated)).toEqual([]);
  });

  it("prints a line for each law and how many pass, in text", () => {
    expect(kitText).toContain("W-01  pass\n");
    expect(kitText).toContain("W-35  pass\n");
    expect(kitText.endsWith(`${String(KIT_LAWS)} of ${String(KIT_LAWS)} laws probed pass\n`)).toBe(
      true,
    );
  });

  it(
    "an adopter config that does not enable a rule fails the law that maps it, and only that law",
    async () => {
      const off = (name: string, text: string): string =>
        name === "eslint.config.js"
          ? text.replace(
              '"@typescript-eslint/no-floating-promises": "error"',
              '"@typescript-eslint/no-floating-promises": "off"',
            )
          : text;
      const result = await probeOf(adopter(off));
      expect(result.code).toBe(1);
      expect(verdicts(result.report).filter((line) => line.endsWith("fail"))).toEqual([
        "W-11 fail",
      ]);
      expect(messages(result.report)).toEqual([
        "W-11/bad/promises.ts:6 stayed quiet: no-floating-promises did not fire on its bad twin",
      ]);
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "an adopter tsconfig that turns a flag off fails the laws that prove it",
    async () => {
      const loose = (name: string, text: string): string =>
        name === "tsconfig.json"
          ? text.replace('"erasableSyntaxOnly": true', '"erasableSyntaxOnly": false')
          : text;
      const result = await probeOf(adopter(loose));
      const failed = verdicts(result.report).filter((line) => line.endsWith("fail"));
      expect(failed).toEqual(["W-02 fail", "W-04 fail", "W-05 fail"]);
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "--law probes one law, --config names the ESLint config, --tsconfig the compiler's, --fixtures the twins",
    async () => {
      const dir = adopter();
      cpSync(join(dir, "eslint.config.js"), join(dir, "other.config.js"));
      cpSync(join(dir, "tsconfig.json"), join(dir, "other.tsconfig.json"));
      const twins = tempDir();
      cpSync(join(KIT, "fixtures/laws/W-14"), join(twins, "W-14"), { recursive: true });
      const args = [
        "--law",
        "W-14",
        "--config",
        "other.config.js",
        "--tsconfig",
        "other.tsconfig.json",
        "--fixtures",
        twins,
      ];
      const result = await probeOf(dir, ...args);
      expect(verdicts(result.report)).toEqual(["W-14 pass"]);
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "a clean twin that a rule flags fails the law as noisy, and a bad twin it does not flag as silent",
    async () => {
      const twins = tempDir();
      put(twins, {
        "W-14/bad/throws.ts":
          'export function fail(): never {\n  throw new Error("x"); // expect: only-throw-error\n}\n',
        "W-14/clean/throws.ts": 'export function fail(): never {\n  throw "x";\n}\n',
      });
      const result = await probeOf(adopter(), "--law", "W-14", "--fixtures", twins);
      expect(result.code).toBe(1);
      expect(messages(result.report)).toEqual([
        "W-14/bad/throws.ts:2 stayed quiet: only-throw-error did not fire on its bad twin",
        "W-14/clean/throws.ts:2 fired @typescript-eslint/only-throw-error on its clean twin",
        "W-14 maps @typescript-eslint/prefer-promise-reject-errors, and no bad twin proves it fires",
      ]);
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "takes the ESLint config from web-tops.yaml when the project names one",
    async () => {
      const dir = adopter();
      cpSync(join(dir, "eslint.config.js"), join(dir, "named.config.js"));
      writeFileSync(
        join(dir, "eslint.config.js"),
        "export default [{ files: ['**/*.nothing'], rules: {} }];\n",
      );
      put(dir, {
        "web-tops.yaml": "gates:\n  hygiene:\n    eslint: { config: named.config.js }\n",
      });
      const result = await probeOf(dir, "--law", "W-14");
      expect(verdicts(result.report)).toEqual(["W-14 pass"]);
    },
    REAL_TOOL_TIMEOUT,
  );
});
