/**
 * The acknowledgement a soft law (severity A) accepts written in the source: `webtops-ack W-NN: reason`.
 * It reads what the kit reads (`src/acks/comment.ts`, kept equal by a conformance test): only the first
 * line of the comment, the law and a colon, and a reason that holds a letter or a digit. The ledger form
 * lives in `.web-tops/acks.yaml` and reaches the rule as its `ackedFiles` option.
 */
/** The reason a comment's text gives for acknowledging the law, or undefined when it does not acknowledge it. */
export function ackReason(text: string, law: string): string | undefined {
  const first = text.trim().split("\n")[0] ?? "";
  const match = /^webtops-ack\s+(W-\d{2,})\s*:\s*(.*[\p{L}\p{N}].*)/u.exec(first);
  return match?.[1] === law ? match[2] : undefined;
}
