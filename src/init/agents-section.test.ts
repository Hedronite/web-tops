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
