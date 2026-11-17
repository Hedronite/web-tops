/**
 * The protocol this kit speaks (WEB_TOPS.md sections 2, 12 and 18), and the one place that says which
 * protocol ids it accepts: a patch of this minor. A new minor changes `PROTOCOL_MINOR` and both
 * schemas' `$id` and `protocol` pattern together; a test holds them equal.
 */
export const PROTOCOL_MINOR = "0.3";

/** The id this kit writes (init) and reports (gate). */
export const PROTOCOL = `${PROTOCOL_MINOR}.0`;

/** The range as a reader sees it, in messages. */
export const PROTOCOL_RANGE = `${PROTOCOL_MINOR}.x`;

/** The same range as the `pattern` of `protocol` in `schema/web-tops.schema.json` and the report schema. */
export const PROTOCOL_PATTERN = `^${PROTOCOL_MINOR.replaceAll(".", "\\.")}\\.[0-9]+$`;

const IN_RANGE = new RegExp(PROTOCOL_PATTERN, "u");

/** True for a string that is a patch of the supported minor; any other value, never. */
export function inProtocolRange(id: unknown): boolean {
  return typeof id === "string" && IN_RANGE.test(id);
}
