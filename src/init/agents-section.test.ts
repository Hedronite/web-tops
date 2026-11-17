import { describe, expect, it } from "vitest";
import { PROTOCOL } from "../config/protocol.ts";
import type { DropIn } from "./profile.ts";
import { loadProfile } from "./profile.ts";
import { agentsSection } from "./render.ts";

const SUBJECT = { name: "@example/subject", version: "1.2.3" };
const SKIPPED = { mapped: false, reason: "not mapped for class: x" };
const ASTRO = { mapped: true, reason: "" };

function profileOf(className: string, disabled: Record<string, string> = {}): DropIn {
  const loaded = loadProfile(className);
  if (!loaded.ok) throw new Error(loaded.error);
  return { ...loaded.profile, disabled };
}

const sentence = (text: string): string => /It runs (.+?)\. Running/s.exec(text)?.[1] ?? "";

const LAWS_NOTE =
  "Law IDs name the rule; while laws is disabled, these are checked in review, not by the gate.";

describe("the AGENTS section, with every layer enabled", () => {
  const text = agentsSection(profileOf("web-app"), SUBJECT, ASTRO);

  it("keeps each floor line with the class's number", () => {
    expect(text).toContain("CRAP cap ≤ `6`");
    expect(text).toContain("Unexplained mutation survivors ≤ `2`");
    expect(text).toContain("JS per page or route ≤ `170 KB per route`");
    expect(text).toContain("Line coverage ≥ `70%`");
  });

  it("lists every layer in the Verification line, joined with a final and", () => {
    expect(sentence(text)).toBe(
      "type checks, astro check, lint, tests with coverage, CRAP, mutation on the diff, " +
        "package export checks, size limits, HTML validation, accessibility checks, " +
        "rendered checks, theme checks, and the laws",
    );
  });

  it("drops the law note, because the laws are checked by the gate", () => {
    expect(text).not.toContain("Law IDs name the rule");
    expect(text).toContain("the reviewer must.\n");
  });

  it("never writes a ratchet line or the laws command, whatever is enabled", () => {
    expect(text).not.toContain("Under `ratchet`");
    expect(text).not.toContain("laws run");
    expect(text).toContain(`Web-TOPS ${PROTOCOL}`);
  });
});

describe("the AGENTS section, with every switchable layer disabled", () => {
  const all = Object.fromEntries(
    [
      "crap",
      "mutation",
      "package_exports",
      "size_limit",
      "html_validate",
      "axe",
      "rendered",
      "themes",
      "laws",
    ].map((layer) => [layer, "off"]),
  );
  const text = agentsSection(profileOf("web-app", all), SUBJECT, SKIPPED);

  it("drops the CRAP, survivor and byte-budget lines, leaving no blank line behind", () => {
    expect(text).not.toMatch(/^- (CRAP cap|Unexplained mutation|JS per page)/m);
    expect(text).toContain("- Line coverage ≥ `70%`\n- Other layers: see `web-tops.yaml`");
  });

  it("verifies only type checks, lint and tests", () => {
    expect(sentence(text)).toBe("type checks, lint, and tests with coverage");
  });

  it("says on the Standards line that law IDs are checked in review", () => {
    expect(text).toContain(`the reviewer must. ${LAWS_NOTE}\n`);
  });

  it("leaves no placeholder behind", () => {
    expect(text).not.toMatch(/\{[A-Z][A-Z_]+\}/);
  });
});

describe("the AGENTS section, with one layer enabled", () => {
  it("puts a final and before the last name", () => {
    const only = Object.fromEntries(
      [
        "mutation",
        "package_exports",
        "size_limit",
        "html_validate",
        "axe",
        "rendered",
        "themes",
        "laws",
      ].map((layer) => [layer, "off"]),
    );
    const text = agentsSection(profileOf("ts-library", only), SUBJECT, SKIPPED);
    expect(sentence(text)).toBe("type checks, lint, tests with coverage, and CRAP");
    expect(text).toContain("CRAP cap ≤ `4`");
  });
});

describe("the AGENTS section cites the stated rules and keeps no copy", () => {
  const text = agentsSection(profileOf("web-app"), SUBJECT, ASTRO);

  it("has a Policies section that points at section 3.4 and lists nothing", () => {
    const policies = text.slice(text.indexOf("## Policies"), text.indexOf("## Standards"));
    expect(policies).toContain("Web-TOPS §3.4");
    expect(policies).toContain("blob/main/WEB_TOPS.md#34-stated-rules");
    expect(policies).not.toMatch(/^\d+\. /m);
  });

  it("corrects the boundary, error and label lines", () => {
    expect(text).toContain("`response.json()`, `JSON.parse` and message `data` return `any`");
    expect(text).toContain(
      "`FormData` and storage reads, `URLSearchParams` and `process.env` are typed",
    );
    expect(text).toContain("**[W-13, `preserve-caught-error`]**");
    expect(text).toContain("a `<label>` tied to its control");
    expect(text).toContain("axe judges that on the built page");
  });

  it("names dead code as a review item, because nothing checks it until M3", () => {
    expect(text).toContain("**[review, W-48]**");
  });

  it("leaves no doubled blank line, whichever sections are present", () => {
    for (const disabled of [{}, { rendered: "off", themes: "off" }]) {
      expect(agentsSection(profileOf("web-app", disabled), SUBJECT, ASTRO)).not.toContain("\n\n\n");
    }
  });
});

describe("the AGENTS section names the hooks law only where the config lints hooks", () => {
  it.each([
    ["web-app", true],
    ["ui-components", true],
    ["astro-site", false],
    ["ts-library", false],
    ["node-service", false],
  ])("%s: the W-47 line is present: %s", (className, present) => {
    const text = agentsSection(profileOf(className), SUBJECT, ASTRO);
    expect(text.includes("**[W-47]**")).toBe(present);
  });
});

describe("the AGENTS section names W-42 to W-46 only for the layers the config enables", () => {
  const off = { rendered: "off", themes: "off" };
  it("names none while both layers are written off, as every M1 profile does", () => {
    const text = agentsSection(profileOf("web-app", off), SUBJECT, ASTRO);
    expect(text).not.toContain("### Rendered interface");
    expect(text).not.toMatch(/W-4[2-6]/);
    for (const className of [
      "web-app",
      "astro-site",
      "ui-components",
      "ts-library",
      "node-service",
    ]) {
      const loaded = loadProfile(className);
      if (!loaded.ok) throw new Error(loaded.error);
      expect(agentsSection(loaded.profile, SUBJECT, ASTRO), className).not.toMatch(/W-4[2-6]/);
    }
  });

  it("names W-43 to W-46 when rendered is enabled and themes is not", () => {
    const { themes } = off;
    const text = agentsSection(profileOf("web-app", { themes }), SUBJECT, ASTRO);
    expect(text).toContain("### Rendered interface");
    for (const id of ["W-43", "W-44", "W-45", "W-46"]) expect(text, id).toContain(`**[${id}]**`);
    expect(text).not.toContain("W-42");
  });

  it("names W-42 alone when themes is enabled and rendered is not", () => {
    const { rendered } = off;
    const text = agentsSection(profileOf("web-app", { rendered }), SUBJECT, ASTRO);
    expect(text).toContain("**[W-42]**");
    expect(text).not.toMatch(/W-4[3-6]/);
  });

  it("puts the section between the HTML standards and the tests, one blank line each side", () => {
    const text = agentsSection(profileOf("web-app"), SUBJECT, ASTRO);
    expect(text).toMatch(
      /\*\*\[W-36\]\*\*\n\n### Rendered interface\n\n- [^]*\*\*\[W-46\]\*\*\n\n### Tests/,
    );
  });
});
