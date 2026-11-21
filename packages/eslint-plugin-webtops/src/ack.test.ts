import { describe, expect, it } from "vitest";
import { ackReason, projectPath } from "./ack.ts";

describe("ackReason", () => {
  it("gives the reason, trimmed", () => {
    expect(ackReason(" webtops-ack W-28: the cart must work at once ", "W-28")).toBe(
      "the cart must work at once",
    );
  });

  it("reads the first line of the comment only", () => {
    expect(ackReason("\n  webtops-ack W-28: the cart\n  must work\n", "W-28")).toBe("the cart");
    expect(ackReason("webtops-ack W-28:\nthe cart", "W-28")).toBeUndefined();
  });

  it("takes a space before the colon, and a reason of letters or digits in any script", () => {
    expect(ackReason("webtops-ack W-28 : reason", "W-28")).toBe("reason");
    expect(ackReason("webtops-ack W-28: 2026", "W-28")).toBe("2026");
    expect(ackReason("webtops-ack W-28: été", "W-28")).toBe("été");
  });

  it("needs no space after the colon, and takes more than one before the law", () => {
    expect(ackReason("webtops-ack W-28:reason", "W-28")).toBe("reason");
    expect(ackReason("webtops-ack   W-28: reason", "W-28")).toBe("reason");
  });

  it.each([
    ["no reason", "webtops-ack W-28:"],
    ["a blank reason", "webtops-ack W-28:   "],
    ["a reason of punctuation only", "webtops-ack W-28: ."],
    ["a reason of symbols only", "webtops-ack W-28: - ... --"],
    ["a one digit law number", "webtops-ack W-2: reason"],
    ["another law", "webtops-ack W-30: reason"],
    ["a longer law number", "webtops-ack W-280: reason"],
    ["no colon", "webtops-ack W-28 reason"],
    ["no space before the law", "webtops-ackW-28: reason"],
    ["text before it", "see webtops-ack W-28: reason"],
    ["another marker", "ack W-28: reason"],
    ["a plain comment", "the cart"],
  ])("is nothing for %s", (_name, text) => {
    expect(ackReason(text, "W-28")).toBeUndefined();
  });

  it("is nothing for a law that is not the one asked for", () => {
    expect(ackReason("webtops-ack W-28: reason", "W-2")).toBeUndefined();
    expect(ackReason("webtops-ack W-28: reason", "W-30")).toBeUndefined();
  });
});

describe("projectPath", () => {
  it("gives a file's path from the project root, with / between parts", () => {
    expect(projectPath("/work/site", "/work/site/src/page.astro")).toBe("src/page.astro");
    expect(projectPath("/work/site/", "/work/site/page.astro")).toBe("page.astro");
    expect(projectPath("C:\\work\\site", "C:\\work\\site\\src\\page.astro")).toBe("src/page.astro");
  });

  it("leaves a path that is not under the root as it is, and a longer folder name alone", () => {
    expect(projectPath("/work/site", "/elsewhere/page.astro")).toBe("/elsewhere/page.astro");
    expect(projectPath("/work/site", "/work/site2/page.astro")).toBe("/work/site2/page.astro");
  });
});
