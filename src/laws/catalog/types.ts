/** The launch classes (WEB_TOPS.md section 5.1): the ones that have a profile and map laws. */
export const LAW_CLASSES = [
  "ts-library",
  "ui-components",
  "astro-site",
  "web-app",
  "node-service",
] as const;

export type LawClass = (typeof LAW_CLASSES)[number];

/** tl: a tool. an: a webtops rule or reader. at: attested by review. tbd: not yet implemented (section 8.1). */
export type ReaderKind = "tl" | "an" | "at" | "tbd";

/** v0.1: ticked in section 8.2. m3: gets a reader in milestone M3. no: not judged yet. */
export type Judged = "v0.1" | "m3" | "no";

/** A tool rule, flag or check a law maps. */
export interface LawRule {
  readonly tool: string;
  readonly name: string;
  /** The classes the rule applies to, among the law's: absent, every class the law maps. */
  readonly classes?: readonly LawClass[];
}

/** One law, as `laws/W-NN.yaml` holds it (WEB_TOPS.md section 8.3, `schema/law.schema.json`). */
export interface Law {
  readonly id: string;
  readonly title: string;
  readonly family: string;
  readonly severity: "R" | "A";
  readonly classes: readonly LawClass[];
  readonly conditional_classes?: readonly LawClass[];
  readonly reader: { readonly kinds: readonly ReaderKind[]; readonly text: string };
  readonly rules: readonly LawRule[];
  readonly judged: Judged;
  readonly rationale: string;
  readonly fix: string;
  readonly note?: string;
}
