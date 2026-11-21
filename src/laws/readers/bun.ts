import type { LawEntry, LawReader } from "./types.ts";
import { auditReader } from "./audit.ts";
import { frozenReader } from "./frozen.ts";
import { notEvaluated, rulesOf } from "./reading.ts";

const AUDIT = "audit";
const FROZEN = "install --frozen-lockfile";

/**
 * `bun` is one tool with two laws: W-38 maps its `audit`, W-40 its `install --frozen-lockfile`. Each other `bun` rule a
 * law names has no reader, and the law is not evaluated for it, whatever else it maps.
 */
const unknownRules = (law: LawEntry): string[] =>
  rulesOf(law, "bun").filter((rule) => rule !== AUDIT && rule !== FROZEN);

/** Why no reader judged a law: the `bun` rules it names that none reads, or that it names no `bun` rule at all. */
function unreadReason(law: LawEntry): string | undefined {
  const rules = unknownRules(law);
  if (rules.length > 0) {
    return `bun has no reader for ${rules.join(", ")} of ${law.id}`;
  }
  return rulesOf(law, "bun").length === 0
    ? `bun has no reader for the rules of ${law.id}`
    : undefined;
}

export const bunReader: LawReader = async (input) => {
  const named = (rule: string) => input.laws.filter((law) => rulesOf(law, "bun").includes(rule));
  const unknown = input.laws.flatMap((law) => {
    const reason = unreadReason(law);
    return reason === undefined ? [] : [notEvaluated(law, reason)];
  });
  return [
    ...(await auditReader({ ...input, laws: named(AUDIT) })),
    ...(await frozenReader({ ...input, laws: named(FROZEN) })),
    ...unknown,
  ];
};
