import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";
import { lawsOfClass } from "../laws/probe/catalog.ts";
import { kitProbeLaws } from "../laws/probe/testkit.ts";
import { cleanTemp, put } from "../laws/probe/testkit.ts";
import {
  adopter,
  failing,
  messages,
  probeOf,
  probeProcess,
  verdicts,
} from "./test-support-probe.ts";

afterAll(cleanTemp);

const WEB_APP = lawsOfClass(kitProbeLaws(), "web-app").map((law) => law.id);
const TS_ONLY = lawsOfClass(kitProbeLaws(), "ts-library").map((law) => law.id);

/** Replaces one line of a config, as an adopter that did not enable a rule would have it. */
const without =
  (file: string, line: string) =>
  (name: string, text: string): string =>
    name === file ? text.replace(line, "") : text;

/** Real processes only: no mutant of a mutation run reaches them (R112). */
const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;

describe.skipIf(insideStryker)(
  "G3c `laws probe` under a class with JSX and CSS: W-22 and W-26",
  () => {
    let ui: Awaited<ReturnType<typeof probeOf>>;
    beforeAll(async () => {
      ui = await probeOf(adopter(undefined, true), "--class", "web-app");
    }, REAL_TOOL_TIMEOUT);

    it("proves W-22 and W-26 beside the laws every class maps, and every law passes", () => {
      expect(ui.code).toBe(0);
      expect(ui.report.laws.map((law) => law.id)).toEqual(WEB_APP);
      expect(failing(ui.report)).toEqual([]);
    });

    it("skips the .astro twins of a web-app that does not depend on astro, and names each with the reason", () => {
      const names = ui.report.skipped.map((twin) => twin.file);
      expect(names).toContain("W-22/bad/astro-a11y-alt-text.astro");
      expect(names).toContain("W-22/clean/astro-a11y-alt-text.astro");
      expect(names.every((name) => name.endsWith(".astro"))).toBe(true);
      expect(new Set(ui.report.skipped.map((twin) => twin.reason))).toEqual(
        new Set(["a web-app lints .astro files only when the project depends on astro"]),
      );
    });

    it("a law whose twins are all Astro is not probed for a web-app that does not depend on astro, and the exit says why", () => {
      const run = probeProcess(adopter(undefined, true), "--class", "web-app", "--law", "W-49");
      expect(run.code).toBe(2);
      expect(run.err).toBe(
        "webtops laws probe: every twin of the given laws was skipped: a web-app lints .astro files only when the project depends on astro\n",
      );
      expect(run.out).toBe("");
    });

    it(
      "a ts-library probes neither, and a project's web-tops.yaml names its class",
      async () => {
        const dir = adopter(undefined, true);
        const plain = await probeOf(dir);
        expect(plain.report.laws.map((law) => law.id)).toEqual(TS_ONLY);
        put(dir, { "web-tops.yaml": "class: web-app\n" });
        const named = await probeOf(dir);
        expect(named.report.laws.map((law) => law.id)).toEqual(WEB_APP);
      },
      REAL_TOOL_TIMEOUT,
    );

    it(
      "--class beats web-tops.yaml, and --law probes a law whatever the class",
      async () => {
        const dir = adopter(undefined, true);
        put(dir, { "web-tops.yaml": "class: web-app\n" });
        const flagged = await probeOf(dir, "--class", "ts-library");
        expect(flagged.report.laws.map((law) => law.id)).toEqual(TS_ONLY);
        const one = await probeOf(dir, "--class", "ts-library", "--law", "W-26");
        expect(verdicts(one.report)).toEqual(["W-26 pass"]);
      },
      REAL_TOOL_TIMEOUT,
    );

    it(
      "a config that does not enable an a11y rule fails W-22 as silent on that rule's line",
      async () => {
        const line = '      "jsx-a11y-x/alt-text": "error",\n';
        const result = await probeOf(
          adopter(without("eslint.config.js", line), true),
          "--class",
          "web-app",
        );
        expect(failing(result.report)).toEqual(["W-22 fail"]);
        expect(messages(result.report)).toEqual([
          "W-22/bad/semantics.tsx:1 stayed quiet: alt-text did not fire on its bad twin",
        ]);
      },
      REAL_TOOL_TIMEOUT,
    );

    it(
      "a Stylelint config that does not enable a rule fails W-26 as silent on that rule's line",
      async () => {
        const line = '    "block-no-empty": true,\n';
        const result = await probeOf(
          adopter(without("stylelint.config.js", line), true),
          "--class",
          "web-app",
        );
        expect(failing(result.report)).toEqual(["W-26 fail"]);
        expect(messages(result.report)).toEqual([
          "W-26/bad/rules.css:3 stayed quiet: block-no-empty did not fire on its bad twin",
        ]);
      },
      REAL_TOOL_TIMEOUT,
    );

    it(
      "a Stylelint config that does not allow a Tailwind at-rule fails W-26 as noisy on the clean twin",
      async () => {
        const line = '          "theme",\n';
        const result = await probeOf(
          adopter(without("stylelint.config.js", line), true),
          "--class",
          "web-app",
        );
        expect(failing(result.report)).toEqual(["W-26 fail"]);
        expect(messages(result.report)).toEqual([
          "W-26/clean/rules.css:6 fired at-rule-no-unknown on its clean twin",
        ]);
      },
      REAL_TOOL_TIMEOUT,
    );
  },
);
