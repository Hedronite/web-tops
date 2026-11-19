import { CATALOG_DIR, loadCatalog } from "../catalog/index.ts";
import { sourceOf } from "./source.ts";
import type { LawSource, ProbeLaw } from "./types.ts";

/** The catalog cannot be read: the probe proves nothing from laws it cannot trust. */
export class CatalogError extends Error {}

/** The kit's laws, from `laws/W-NN.yaml` (G1): a catalog with a file that is not valid is an error, never an empty list. */
export function readCatalog(dir: string = CATALOG_DIR) {
  const loaded = loadCatalog(dir);
  if (!loaded.ok) {
    const lines = loaded.problems.map((found) => `${found.file}${found.pointer}: ${found.message}`);
    throw new CatalogError(`the catalog is invalid: ${lines.join("; ")}`);
  }
  return loaded.laws;
}

/** The laws the probe proves: the ticked laws a lint rule or a compiler flag judges, read from the catalog. */
export const catalogLaws: LawSource = sourceOf(readCatalog);

/** The laws a class maps (`classes` in each law's file); a law with no class list is mapped by every class. */
export const lawsOfClass = (list: readonly ProbeLaw[], className: string): ProbeLaw[] =>
  list.filter((law) => law.classes === undefined || law.classes.includes(className));
