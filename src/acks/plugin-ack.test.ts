import { describe, expect, it } from "vitest";
import { ackReason } from "../../packages/eslint-plugin-webtops/src/ack.ts";
import { parseAck } from "./comment.ts";

/**
 * The plugin cannot import the kit, so `ackReason` (the plugin's reading of a comment) is a copy of
 * `parseAck`'s grammar. This table keeps the two equal: the kit reads a comment only when its text starts
 * with `webtops-ack`, and then `parseAck` says whether it is an acknowledgement of the law asked for.
 */
const startsAck = (text: string): boolean => /^webtops-ack(?![\w-])/u.test(text.trim());

function kitReason(text: string, law: string): string | undefined {
  if (!startsAck(text)) return undefined;
  const parsed = parseAck(text);
  return parsed.ok && parsed.law === law ? parsed.reason : undefined;
}

const TEXTS = [
  " webtops-ack W-28: the cart must work at once ",
  "webtops-ack W-28:reason",
  "webtops-ack   W-28: reason",
  "webtops-ack W-28 : reason",
  "webtops-ack W-28\t:\treason",
  "webtops-ack W-28: reason\nmore on a second line",
  "\n  webtops-ack W-28: the cart\n  must work\n",
  "webtops-ack W-28:\nreason on the next line",
  "webtops-ack W-28:",
  "webtops-ack W-28:   ",
  "webtops-ack W-28: .",
  "webtops-ack W-28: - ... --",
  "webtops-ack W-28: 2026",
  "webtops-ack W-28: été",
  "webtops-ack W-28: 理由",
  "webtops-ack W-28",
  "webtops-ack W-28 reason",
  "webtops-ack W-2: reason",
  "webtops-ack W-280: reason",
  "webtops-ack W-30: reason",
  "webtops-ack w-28: reason",
  "webtops-ackW-28: reason",
  "webtops-ack-more W-28: reason",
  "see webtops-ack W-28: reason",
  "ack W-28: reason",
  "the cart",
  "",
];

describe("the plugin's reading of an acknowledgement comment is the kit's", () => {
  it.each(TEXTS.flatMap((text) => ["W-28", "W-30", "W-2"].map((law) => [text, law] as const)))(
    "reads %j for %s as the kit does",
    (text, law) => {
      expect(ackReason(text, law)).toBe(kitReason(text, law));
    },
  );
});
