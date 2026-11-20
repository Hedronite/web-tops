import { CATALOG_DIR, loadCatalog } from "../catalog/index.ts";
import { sourceOf } from "./source.ts";
import type { LawSource, ProbeLaw } from "./types.ts";

/** The catalog cannot be read: the probe proves nothing from laws it cannot trust. */
export class CatalogError extends Error {}

/** The kit's laws, from `laws/W-NN.yaml` (G1): a catalog with a file that is not valid is an error, never an empty list. */
export function readCatalog(dir: string = CATALOG_DIR, load: typeof loadCatalog = loadCatalog) {
  const loaded = load(dir);
  if (!loaded.ok) {
    const lines = loaded.problems.map((found) => `${found.file}${found.pointer}: ${found.message}`);
    throw new CatalogError(`the catalog is invalid: ${lines.join("; ")}`);
  }
  return loaded.laws;
}

/** The laws the probe proves: the ticked laws a lint rule or a compiler flag judges, read from the catalog. */
export const catalogLaws: LawSource = sourceOf(readCatalog);

const mapsClass = (law: ProbeLaw, className: string): boolean =>
  law.classes === undefined || law.classes.includes(className);

/** The proofs of a law that apply to a class: a rule whose entry names classes (R106) is proven only for those. */
const proofsFor = (law: ProbeLaw, className: string): ProbeLaw => ({
  ...law,
  proofs: law.proofs.filter((proof) => law.scoped?.[proof]?.includes(className) ?? true),
});

/**
 * The laws a class maps (`classes` in each law's file; a law with no class list is mapped by every class), each with
 * the proofs that apply to the class.
 */
export const lawsOfClass = (list: readonly ProbeLaw[], className: string): ProbeLaw[] =>
  list.filter((law) => mapsClass(law, className)).map((law) => proofsFor(law, className));
