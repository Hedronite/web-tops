import { resolve } from "node:path";

export { loadCatalog } from "./load.ts";
export type { Catalog, FileProblem } from "./load.ts";
export { findLaw, isConditional, select } from "./query.ts";
export type { Filter } from "./query.ts";
export { validateLaw } from "./schema.ts";
export { rowOf, syncTables } from "./table.ts";
export type { Synced } from "./table.ts";
export { LAW_CLASSES } from "./types.ts";
export type { Judged, Law, LawClass, LawRule, ReaderKind } from "./types.ts";
export { explainText, listText } from "./view.ts";

/** The kit's own catalog: `laws/` beside `src/`. The laws are the kit's, whatever project the command runs in. */
export const CATALOG_DIR = resolve(import.meta.dirname, "../../../laws");
