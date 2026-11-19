import { describe, expect, it } from "vitest";
import { ackReason } from "./ack.ts";

describe("ackReason", () => {
  it("gives the reason, trimmed", () => {
    expect(ackReason(" webtops-ack W-28: the cart must work at once ", "W-28")).toBe(
      "the cart must work at once",
    );
  });

  it("takes a reason over several lines", () => {
    expect(ackReason("\n  webtops-ack W-28: the cart\n  must work\n", "W-28")).toBe(
      "the cart\n  must work",
    );
  });

  it("needs no space after the colon, and takes more than one before the law", () => {
    expect(ackReason("webtops-ack W-28:reason", "W-28")).toBe("reason");
    expect(ackReason("webtops-ack   W-28: reason", "W-28")).toBe("reason");
  });

  it.each([
    ["no reason", "webtops-ack W-28:"],
    ["a blank reason", "webtops-ack W-28:   "],
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
