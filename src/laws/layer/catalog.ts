import { CATALOG_DIR, loadCatalog } from "../../laws/catalog/index.ts";
import type { Law } from "../../laws/catalog/index.ts";
import type { LawEntry } from "../../laws/readers/types.ts";
import type { ClassedLaw } from "./entries.ts";

/** Where the layer reads its laws: a function, so a test gives it a catalog of its own. */
export type LawCatalog = () => readonly LawEntry[];

/** A law as the layer takes it: what the catalog's file says, with a law that M3 gives a reader judged from now on. */
export const entryOf = (law: Law): ClassedLaw => ({
  id: law.id,
  severity: law.severity,
  reader: law.reader.kinds[0] ?? "tbd",
  classes: law.classes,
  ...(law.conditional_classes === undefined ? {} : { conditional: law.conditional_classes }),
  judged: law.judged !== "no",
  rules: law.rules,
});

/** The kit's laws, from `laws/W-NN.yaml`: a catalog with a file that is not valid fails the layer, never an empty list. */
export function yamlCatalog(
  load: typeof loadCatalog = loadCatalog,
  dir: string = CATALOG_DIR,
): readonly LawEntry[] {
  const loaded = load(dir);
  if (!loaded.ok) {
    const lines = loaded.problems.map((found) => `${found.file}${found.pointer}: ${found.message}`);
    throw new Error(`the law catalog is invalid: ${lines.join("; ")}`);
  }
  return loaded.laws.map(entryOf);
}
