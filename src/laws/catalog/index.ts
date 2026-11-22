import { resolve } from "node:path";

export { loadCatalog } from "./load.ts";
export type { Catalog } from "./load.ts";
export { findLaw, select } from "./query.ts";
export { syncTables } from "./table.ts";
export { LAW_CLASSES } from "./types.ts";
export type { Law, LawClass } from "./types.ts";
export { explainText, listText } from "./view.ts";

/** The kit's own catalog: `laws/` beside `src/`. The laws are the kit's, whatever project the command runs in. */
export const CATALOG_DIR = resolve(import.meta.dirname, "../../../laws");
