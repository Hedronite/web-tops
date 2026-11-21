import type { LawEntry } from "../laws/readers/types.ts";
import { yamlCatalog } from "../laws/layer/catalog.ts";

/** The severity of a law (`R` hard, `A` soft), or undefined for an id that is not a law (WEB_TOPS.md section 8.2). */
export type SeverityOf = (law: string) => "R" | "A" | undefined;

/** The severity of each law of a list; an id that is not in it has none. */
export const severityOf = (laws: readonly Pick<LawEntry, "id" | "severity">[]): SeverityOf => {
  const byId = new Map(laws.map((law) => [law.id, law.severity] as const));
  return (law) => byId.get(law);
};

/** The severity of each law of the kit's catalog, read when it is asked for and not before. */
export const catalogSeverity = (
  load: () => readonly Pick<LawEntry, "id" | "severity">[] = yamlCatalog,
): SeverityOf => severityOf(load());
