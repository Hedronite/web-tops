import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BEGIN_MARKER, END_MARKER, mergeAgentsSection } from "./agents.ts";

const BLOCK = `${BEGIN_MARKER}\nnew generated text\n${END_MARKER}\n`;

const fixture = (name: string): string =>
  readFileSync(resolve(import.meta.dirname, "../../fixtures/init/agents", name), "utf8");

const count = (text: string, needle: string): number => text.split(needle).length - 1;

describe("AGENTS.md section", () => {
  it("is the whole block when the file does not exist", () => {
    expect(mergeAgentsSection(undefined, BLOCK)).toEqual({ kind: "create", text: BLOCK });
  });

  it("replaces only the text between the markers and keeps everything else byte for byte", () => {
    const existing = fixture("outside-text.txt");
    const result = mergeAgentsSection(existing, BLOCK);
    expect(result.kind).toBe("replace");
    if (result.kind !== "replace") return;
    const prefix = existing.slice(0, existing.indexOf(BEGIN_MARKER) + BEGIN_MARKER.length);
    const suffix = existing.slice(existing.indexOf(END_MARKER));
    expect(result.text.startsWith(prefix)).toBe(true);
    expect(result.text.endsWith(suffix)).toBe(true);
    expect(result.text).toContain("new generated text");
    expect(result.text).not.toContain("old generated text");
    expect(result.text.endsWith("Trailing notes, no newline at end")).toBe(true);
  });

  it("keeps CRLF line endings outside the markers", () => {
    const existing = fixture("crlf.txt");
    const result = mergeAgentsSection(existing, BLOCK);
    expect(result.kind).toBe("replace");
    if (result.kind !== "replace") return;
    expect(result.text.startsWith("# Notes\r\n\r\n")).toBe(true);
    expect(result.text.endsWith("\r\n\r\nafter\r\n")).toBe(true);
  });

  it("keeps exactly one pair of markers after a replacement", () => {
    const result = mergeAgentsSection(fixture("outside-text.txt"), BLOCK);
    if (result.kind !== "replace") throw new Error("expected a replacement");
    expect(count(result.text, BEGIN_MARKER)).toBe(1);
    expect(count(result.text, END_MARKER)).toBe(1);
  });

  it("is idempotent: merging its own output changes nothing", () => {
    const once = mergeAgentsSection(fixture("outside-text.txt"), BLOCK);
    if (once.kind !== "replace") throw new Error("expected a replacement");
    const twice = mergeAgentsSection(once.text, BLOCK);
    expect(twice).toEqual({ kind: "replace", text: once.text });
  });

  it("appends the block after a file that has no markers, leaving its bytes alone", () => {
    const existing = fixture("no-markers.txt");
    const result = mergeAgentsSection(existing, BLOCK);
    expect(result.kind).toBe("append");
    if (result.kind !== "append") return;
    expect(result.text.startsWith(existing)).toBe(true);
    expect(result.text.endsWith(BLOCK)).toBe(true);
    expect(count(result.text, BEGIN_MARKER)).toBe(1);
  });

  it.each(["two-begins.txt", "end-first.txt", "begin-only.txt"])(
    "refuses %s: the markers cannot be trusted",
    (name) => {
      const result = mergeAgentsSection(fixture(name), BLOCK);
      expect(result.kind).toBe("malformed");
    },
  );

  it("treats an empty file as having no markers", () => {
    expect(mergeAgentsSection("", BLOCK)).toEqual({ kind: "append", text: BLOCK });
  });
});

describe("AGENTS.md section, properties", () => {
  // Text that cannot contain either marker, so the markers in the file are exactly the ones placed.
  const plain = fc.string().filter((text) => !text.includes("<!--") && !text.includes("-->"));

  it("keeps every byte outside the markers, whatever surrounds them", () => {
    fc.assert(
      fc.property(plain, plain, plain, (before, inside, after) => {
        const existing = `${before}${BEGIN_MARKER}${inside}${END_MARKER}${after}`;
        const result = mergeAgentsSection(existing, BLOCK);
        expect(result.kind).toBe("replace");
        if (result.kind !== "replace") return;
        expect(result.text.startsWith(`${before}${BEGIN_MARKER}`)).toBe(true);
        expect(result.text.endsWith(`${END_MARKER}${after}`)).toBe(true);
        expect(count(result.text, BEGIN_MARKER)).toBe(1);
        expect(count(result.text, END_MARKER)).toBe(1);
        expect(mergeAgentsSection(result.text, BLOCK)).toEqual({
          kind: "replace",
          text: result.text,
        });
      }),
    );
  });

  it("appends after any file with no markers and keeps that file as the prefix", () => {
    fc.assert(
      fc.property(plain, (existing) => {
        const result = mergeAgentsSection(existing, BLOCK);
        expect(result.kind).toBe("append");
        if (result.kind !== "append") return;
        expect(result.text.startsWith(existing)).toBe(true);
        expect(result.text.endsWith(BLOCK)).toBe(true);
      }),
    );
  });
});
