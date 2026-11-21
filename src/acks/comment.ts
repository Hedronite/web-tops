import { failed } from "../census/finding.ts";
import type { RawFinding } from "../report/findings.ts";

/** What a `webtops-ack` comment says: a law and a reason, or why it is not an acknowledgement. */
export type AckParse =
  | { readonly ok: true; readonly law: string; readonly reason: string }
  | {
      readonly ok: false;
      readonly rule: "ack-no-reason" | "ack-malformed";
      readonly message: string;
    };

/** `webtops-ack W-NN: reason`, the reason holding a letter or a digit. */
const WRITTEN = /^webtops-ack\s+(W-\d{2,})\s*:\s*(.*[\p{L}\p{N}].*)/u;
/** The law alone, or with a colon and then only punctuation: an acknowledgement that says nothing. */
const REASONLESS = /^webtops-ack\s+(W-\d{2,})\s*(?::[^\p{L}\p{N}]*)?$/u;

const firstLine = (body: string): string => String(body.trim().split("\n")[0]);

/** Reads the text of a comment that starts with `webtops-ack` (WEB_TOPS.md section 8.1). */
export function parseAck(body: string): AckParse {
  const text = firstLine(body);
  const written = WRITTEN.exec(text);
  if (written !== null) {
    return { ok: true, law: String(written[1]), reason: String(written[2]) };
  }
  const bare = REASONLESS.exec(text);
  if (bare !== null) {
    const law = String(bare[1]);
    return {
      ok: false,
      rule: "ack-no-reason",
      message: `the acknowledgement of ${law} gives no reason: write webtops-ack ${law}: <why>`,
    };
  }
  return {
    ok: false,
    rule: "ack-malformed",
    message: "an acknowledgement reads webtops-ack W-NN: <reason>, and this one does not",
  };
}

/** The failing finding for a comment that is not an acknowledgement, or none for one that is. */
export function ackProblem(parsed: AckParse, file: string, line: number): RawFinding[] {
  return parsed.ok ? [] : [failed(parsed.rule, parsed.message, { file, line })];
}
