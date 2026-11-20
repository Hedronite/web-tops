import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { realExec } from "../gate/exec.ts";
import { catalogLaws } from "../laws/probe/catalog.ts";
import { runProbe, type ProbeOutcome, type ProbeRequest } from "../laws/probe/run.ts";
import { cleanTemp, put, tempDir } from "../laws/probe/testkit.ts";
import type { ProbeLaw } from "../laws/probe/types.ts";
import { defaults } from "./laws-probe.ts";
import { cli, KIT } from "./test-support-probe.ts";

afterAll(cleanTemp);

/**
 * The probe's command over a probe that is given: its text, its JSON, its exit code and the request it builds, judged
 * in this process without the probe's own code, which has its own tests. The real tools run it as a process elsewhere.
 */

const laws = (): readonly ProbeLaw[] => [
  { id: "W-99", proofs: ["no-thing"], classes: ["ts-library"] },
  { id: "W-98", proofs: ["no-thing"], classes: ["web-app"] },
  { id: "W-97", proofs: ["no-thing"], classes: ["ts-library"] },
];

const passed: ProbeOutcome = {
  ok: true,
  report: { laws: [{ id: "W-99", verdict: "pass", failures: [], unrelated: [] }] },
};

const failed: ProbeOutcome = {
  ok: true,
  report: {
    laws: [
      {
        id: "W-99",
        verdict: "fail",
        failures: [
          {
            kind: "silent",
            message: "W-99/bad/a.ts:1 stayed quiet: no-thing did not fire on its bad twin",
          },
        ],
        unrelated: [],
      },
    ],
  },
};

/** A probe that answers with the outcome and keeps the requests it was given. */
function given(outcome: ProbeOutcome): {
  readonly probe: (request: ProbeRequest) => Promise<ProbeOutcome>;
  readonly requests: ProbeRequest[];
} {
  const requests: ProbeRequest[] = [];
  return {
    probe: (request) => {
      requests.push(request);
      return Promise.resolve(outcome);
    },
    requests,
  };
}

function first(requests: readonly ProbeRequest[]): ProbeRequest {
  const request = requests[0];
  if (request === undefined) {
    throw new Error("the probe was not asked");
  }
  return request;
}

describe("G3b the command prints a probe's report and picks its exit code", () => {
  it("a report whose laws pass: exit 0, a line for each law, and how many pass", async () => {
    const { probe } = given(passed);
    const result = await cli(["--law", "W-99"], tempDir(), { probe, laws });
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toBe("W-99  pass\n1 of 1 laws probed pass\n");
  });

  it("--json prints the report as JSON, with the same exit code", async () => {
    const { probe } = given(passed);
    const result = await cli(["--law", "W-99", "--json"], tempDir(), { probe, laws });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual({
      laws: [{ id: "W-99", verdict: "pass", failures: [], unrelated: [] }],
    });
    expect(result.out.endsWith("}\n")).toBe(true);
  });

  it("a law that fails is exit 1, and its line says which marker stayed quiet", async () => {
    const { probe } = given(failed);
    const result = await cli(["--law", "W-99"], tempDir(), { probe, laws });
    expect(result.code).toBe(1);
    expect(result.out).toContain("W-99  fail\n");
    expect(result.out).toContain(
      "W-99/bad/a.ts:1 stayed quiet: no-thing did not fire on its bad twin",
    );
  });

  it("a probe that could not run is its own code and message, on stderr, and nothing on stdout", async () => {
    const outcome: ProbeOutcome = {
      ok: false,
      code: 3,
      problem: "eslint did not run: tool-missing. eslint is not installed in node_modules",
    };
    const { probe } = given(outcome);
    const result = await cli(["--law", "W-99"], tempDir(), { probe, laws });
    expect(result.code).toBe(3);
    expect(result.err).toBe(
      "webtops laws probe: eslint did not run: tool-missing. eslint is not installed in node_modules\n",
    );
    expect(result.out).toBe("");
  });
});

describe("G3b the request the command builds", () => {
  it("is for the project: its directory and environment, the tools' exec, the scratch directory", async () => {
    const cwd = tempDir();
    const { probe, requests } = given(passed);
    const exec = realExec;
    await cli(["--law", "W-99"], cwd, { probe, laws, exec });
    const request = first(requests);
    expect(request.cwd).toBe(cwd);
    expect(request.env).toBe(process.env);
    expect(request.exec).toBe(exec);
    expect(request.scratch).toBe(join(cwd, ".web-tops", "out", "laws-probe"));
    expect(request.laws.map((law) => law.id)).toEqual(["W-99"]);
  });

  it("with no flag and no web-tops.yaml it asks for the laws a ts-library maps, and no other", async () => {
    const { probe, requests } = given(passed);
    await cli([], tempDir(), { probe, laws });
    expect(first(requests).laws.map((law) => law.id)).toEqual(["W-99", "W-97"]);
  });

  it("the class is the one web-tops.yaml names, and --class beats it", async () => {
    const cwd = tempDir();
    put(cwd, { "web-tops.yaml": "class: web-app\n" });
    const named = given(passed);
    await cli([], cwd, { probe: named.probe, laws });
    expect(first(named.requests).laws.map((law) => law.id)).toEqual(["W-98"]);
    const flagged = given(passed);
    await cli(["--class", "ts-library"], cwd, { probe: flagged.probe, laws });
    expect(first(flagged.requests).laws.map((law) => law.id)).toEqual(["W-99", "W-97"]);
  });

  it("--law asks for exactly that law, whatever the class", async () => {
    const { probe, requests } = given(passed);
    await cli(["--law", "W-98"], tempDir(), { probe, laws });
    expect(first(requests).laws.map((law) => law.id)).toEqual(["W-98"]);
  });

  it("takes the ESLint config web-tops.yaml names, resolved from the project, --config over it, and none otherwise", async () => {
    const cwd = tempDir();
    put(cwd, { "web-tops.yaml": "gates:\n  hygiene:\n    eslint: { config: named.config.js }\n" });
    const named = given(passed);
    await cli([], cwd, { probe: named.probe, laws });
    expect(first(named.requests).eslintConfig).toBe(join(cwd, "named.config.js"));
    const flagged = given(passed);
    await cli(["--config", "other.config.js"], cwd, { probe: flagged.probe, laws });
    expect(first(flagged.requests).eslintConfig).toBe(join(cwd, "other.config.js"));
    const bare = given(passed);
    await cli([], tempDir(), { probe: bare.probe, laws });
    expect(first(bare.requests).eslintConfig).toBeUndefined();
  });

  it("proves the flags of the tsconfig named, or tsconfig.json of the project, resolved from it", async () => {
    const cwd = tempDir();
    const plain = given(passed);
    await cli([], cwd, { probe: plain.probe, laws });
    expect(first(plain.requests).tsconfig).toBe(join(cwd, "tsconfig.json"));
    const named = given(passed);
    await cli(["--tsconfig", "other.json"], cwd, { probe: named.probe, laws });
    expect(first(named.requests).tsconfig).toBe(join(cwd, "other.json"));
    const absolute = given(passed);
    await cli(["--tsconfig", "/elsewhere/t.json"], cwd, { probe: absolute.probe, laws });
    expect(first(absolute.requests).tsconfig).toBe("/elsewhere/t.json");
  });

  it("reads the twins from the directory named, resolved from the project, else the ones the command ships", async () => {
    const cwd = tempDir();
    const named = given(passed);
    await cli(["--fixtures", "twins"], cwd, { probe: named.probe, laws });
    expect(first(named.requests).fixtures).toBe(join(cwd, "twins"));
    const shipped = given(passed);
    await cli([], cwd, { probe: shipped.probe, laws, fixtures: "/the/twins" });
    expect(first(shipped.requests).fixtures).toBe("/the/twins");
  });

  it("a web-tops.yaml that cannot be read, or is no map, names no class and no config: the defaults hold", async () => {
    for (const text of ["a: [\n", "just words\n", "- one\n- two\n"]) {
      const cwd = tempDir();
      put(cwd, { "web-tops.yaml": text });
      const { probe, requests } = given(passed);
      await cli([], cwd, { probe, laws });
      expect(
        first(requests).laws.map((law) => law.id),
        text,
      ).toEqual(["W-99", "W-97"]);
      expect(first(requests).eslintConfig, text).toBeUndefined();
    }
  });
});

describe("G3b the command's own problems", () => {
  it("a usage problem prints the usage once, with no blank line after it, and asks nothing of the probe", async () => {
    const { probe, requests } = given(passed);
    const result = await cli(["--wat"], tempDir(), { probe, laws });
    expect(result.code).toBe(2);
    expect(result.err.endsWith("[--json]\n")).toBe(true);
    expect(result.err.endsWith("\n\n")).toBe(false);
    expect(result.err).toContain("Unknown option '--wat'");
    expect(requests).toEqual([]);
  });

  it("by default it runs the gate's own exec, the probe, the catalog's laws, and the twins the kit ships", () => {
    const made = defaults();
    expect(made.exec).toBe(realExec);
    expect(made.probe).toBe(runProbe);
    expect(made.laws).toBe(catalogLaws);
    expect(made.fixtures).toBe(join(KIT, "fixtures", "laws"));
  });
});
