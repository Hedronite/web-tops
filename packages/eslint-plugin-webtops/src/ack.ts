/**
 * The acknowledgement a soft law (severity A) accepts written in the source: `webtops-ack W-NN: reason`,
 * with a reason. The ledger form lives in `.web-tops/` and is read by the laws layer (milestone M3, G8):
 * this is the one place the plugin reads an acknowledgement, so G8 widens it here.
 */
const ACK = /^\s*webtops-ack\s+(W-\d+):\s*(\S[\s\S]*?)\s*$/u;

/** The reason a comment's text gives for acknowledging the law, or undefined when it does not acknowledge it. */
export function ackReason(text: string, law: string): string | undefined {
  const match = ACK.exec(text);
  return match?.[1] === law ? match[2] : undefined;
}
