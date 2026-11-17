import { describe, expect, it } from "vitest";
import { checkConfigFile } from "../config/validate.ts";
import { containing, fixture, fixturesDir, get } from "../config/test-support.ts";
import { runCheckCli } from "./check.ts";
import type { Io } from "./io.ts";

function io(): { io: Io; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  return {
    io: {
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
      cwd: fixturesDir,
      env: {},
    },
    out: () => out,
    err: () => err,
  };
}

// File, then the JSON pointer `check` must name. "" is the document itself.
const invalid: readonly (readonly [string, string])[] = [
  ["unknown-top-key", "/bogus"],
  ["unknown-nested-key", "/gates/crap/bogus"],
  ["missing-class", "/class"],
  ["wrong-protocol", "/protocol"],
  ["bad-class", "/class"],
  ["class-without-profile", "/class"],
  ["crap-cap-below-one", "/gates/crap/cap"],
  ["ts-library-survivors", "/gates/mutation/unexplained_survivors_max"],
  ["advisory-no-exemption", "/exemption"],
  ["advisory-expired", "/exemption/until"],
  ["advisory-bad-date", "/exemption/until"],
  ["advisory-old-key", "/exemption/until"],
  ["hard-tests-off", "/gates/tests/enabled"],
  ["hard-hygiene-off", "/gates/hygiene/enabled"],
  ["hard-coverage-off", "/gates/coverage/enabled"],
  ["hard-package-exports-off", "/layers/package_exports/enabled"],
  ["hard-step-off", "/gates/hygiene/eslint/enabled"],
  ["hard-format-off", "/gates/hygiene/format/enabled"],
  ["hard-stylelint-off-astro", "/gates/hygiene/stylelint/enabled"],
  ["hard-astro-check-off-astro-site", "/gates/hygiene/astro_check/enabled"],
  ["custom-id-builtin", "/layers/custom/0/id"],
  ["custom-id-duplicate", "/layers/custom/1/id"],
  ["laws-select-bad", "/laws/select"],
  ["laws-old-key", "/laws/enable"],
  ["format-tool-bad", "/gates/hygiene/format/tool"],
  ["hygiene-step-unknown", "/gates/hygiene/lint"],
  ["step-disabled-no-reason", "/gates/hygiene/stylelint/reason"],
  ["ratchet-no-baseline", "/baseline"],
  ["disabled-no-reason", "/layers/axe/reason"],
  ["disabled-blank-reason", "/layers/axe/reason"],
  ["gate-disabled-no-reason", "/gates/crap/reason"],
  ["laws-disabled-no-reason", "/laws/reason"],
  ["coverage-exclude-no-reason", "/gates/coverage/exclude/0/reason"],
  ["bad-tier", "/layers/size_limit/tier"],
  ["custom-missing-command", "/layers/custom/0/command"],
  ["toolchain-range", "/toolchain/typescript"],
  ["not-a-mapping", ""],
  ["empty", ""],
  ["duplicate-key", ""],
];

describe("G1c: check fails each broken config with its JSON pointer", () => {
  it.each(invalid)("%s names %j", (name, pointer) => {
    const result = checkConfigFile(fixture(`invalid/${name}.yaml`));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((problem) => problem.pointer)).toContain(pointer);
  });

  it.each(invalid)(
    "%s exits 2 with the pointer on stderr and nothing on stdout",
    async (name, pointer) => {
      const { io: streams, out, err } = io();
      const code = await runCheckCli([`invalid/${name}.yaml`], streams);
      expect(code).toBe(2);
      expect(out()).toBe("");
      expect(err()).toContain(`invalid/${name}.yaml: invalid\n`);
      expect(err()).toContain(`  ${pointer === "" ? "(document)" : pointer}: `);
    },
  );
});

// astro_check follows the project: package.json beside the config decides it (section 9).
const projects: readonly (readonly [string, string | undefined])[] = [
  ["vite-web-app", undefined],
  ["no-package-json-web-app", undefined],
  ["broken-package-json-web-app", undefined],
  ["astro-lookalike-web-app", undefined],
  ["astro-peer-web-app", undefined],
  ["ui-components-no-astro", undefined],
  ["astro-ts-library", undefined],
  ["astro-web-app", "/gates/hygiene/astro_check/enabled"],
  ["astro-dev-web-app", "/gates/hygiene/astro_check/enabled"],
  ["astro-ui-components", "/gates/hygiene/astro_check/enabled"],
];

describe("R27: astro_check off under hard, by project", () => {
  it.each(projects)("%s", async (name, pointer) => {
    const path = `projects/${name}/web-tops.yaml`;
    const result = checkConfigFile(fixture(path));
    const { io: streams, err } = io();
    const code = await runCheckCli([path], streams);
    if (pointer === undefined) {
      expect(result.ok).toBe(true);
      expect(code).toBe(0);
    } else {
      expect(get(result, "problems")).toEqual([{ pointer, message: containing("astro_check") }]);
      expect(code).toBe(2);
      expect(err()).toContain(`  ${pointer}: `);
    }
  });
});

describe("check on a valid config", () => {
  it.each([
    "valid/full.yaml",
    "valid/advisory.yaml",
    "valid/advisory-tests-off.yaml",
    "valid/hard-later-layers-off.yaml",
    "valid/hard-exports-off-astro.yaml",
    "valid/hard-unmapped-steps-off.yaml",
  ])("%s exits 0 and says ok", async (path) => {
    const { io: streams, out, err } = io();
    expect(await runCheckCli([path], streams)).toBe(0);
    expect(out()).toMatch(new RegExp(`^${path}: ok \\(class [a-z-]+, enforce [a-z]+\\)\\n$`));
    expect(err()).toBe("");
  });
});

describe("check usage and unreadable input", () => {
  it("defaults to web-tops.yaml in the working directory and exits 2 when it is absent", async () => {
    const { io: streams, err } = io();
    expect(await runCheckCli([], streams)).toBe(2);
    expect(err()).toContain("web-tops.yaml: invalid\n  (document): cannot read");
  });

  it.each([["--json"], ["a.yaml", "b.yaml"]])("%j exits 2 with usage", async (...argv) => {
    const { io: streams, out, err } = io();
    expect(await runCheckCli(argv, streams)).toBe(2);
    expect(out()).toBe("");
    expect(err()).toBe("usage: webtops check [path]\n");
  });
});
