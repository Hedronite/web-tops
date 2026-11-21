/** What a diff says of one thing it compared: nothing moved, it is held tighter, or it is held looser. */
export type Direction = "unchanged" | "strengthened" | "weakened";

/** A direction, or `changed`: a version moved, which a person reviews, and which is neither weaker nor stronger. */
export type Change = Direction | "changed";

/** One thing that moved: what it is, how, and where the two refs differ. */
export interface Item {
  readonly what: string;
  readonly change: Change;
  readonly before: string;
  readonly after: string;
  readonly where?: string;
}

/** One surface of the diff, with how many of its parts were compared, whether or not any moved. */
export interface Surface {
  readonly name: string;
  readonly compared: number;
  readonly items: readonly Item[];
  readonly note?: string;
}

/** A surface the diff leaves out, and why: a pass says nothing of it. */
export interface NotCompared {
  readonly what: string;
  readonly reason: string;
}

export interface DiffReport {
  readonly base: string;
  readonly head: string;
  readonly mergeBase: string;
  readonly surfaces: readonly Surface[];
  readonly notCompared: readonly NotCompared[];
}

/** A value and how tight it holds: a higher rank is the stricter one. */
export interface Ranked {
  readonly shown: string;
  readonly rank: number;
  /** A value with no better or worse: when it differs, it is listed as changed, for a person to review. */
  readonly review?: boolean;
}

/** An ESLint rule's effective level (0 off, 1 warn, 2 error) and its options as JSON. */
export interface RuleSetting {
  readonly level: number;
  readonly options: string;
}

/** The effective settings of every rule, for each file ESLint reaches. */
export type Rules = ReadonlyMap<string, ReadonlyMap<string, RuleSetting>>;

/** The settings of a `web-tops.yaml`: a ranked value each, and the coverage exclusions by glob. */
export interface Settings {
  readonly values: ReadonlyMap<string, Ranked>;
  readonly globs: readonly string[];
}

/** What a dependency-cruiser config holds: a ranked value each for its named rules, the allowed set, and what it leaves out. */
export interface Cruise {
  readonly values: ReadonlyMap<string, Ranked>;
  readonly allowed: readonly string[];
  readonly excluded: readonly string[];
}

/** What a tsconfig project selects: its entries as the config says them, and the files that come of them. */
export interface ProjectSets {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly files: readonly string[];
  readonly references: readonly string[];
  readonly program: ReadonlySet<string>;
}

/** The files of the other ref a checkout is asked about as well as its own: ESLint's, and Stylelint's. */
export interface Asked {
  readonly source: readonly string[];
  readonly style: readonly string[];
}

/** What a surface holds at a ref: the data, none (the project has no such thing), or why it could not be read. */
export type Part<T> =
  | { readonly state: "ok"; readonly value: T }
  | { readonly state: "absent" }
  | { readonly state: "error"; readonly message: string };

/** A law as the diff compares it. */
export interface LawFacts {
  readonly severity: "R" | "A";
  readonly judged: string;
  readonly classes: readonly string[];
  readonly rules: readonly string[];
}

/** The class the project is, and what that class requires of it. */
export interface Profile {
  readonly className: string;
  readonly required: ReadonlySet<string>;
  readonly layers: ReadonlySet<string>;
}

/** Every surface of the diff, as it stands in one checkout. */
export interface Snapshot {
  /** The tracked source files ESLint was asked about, before any file of the other ref was added. */
  readonly tracked: readonly string[];
  /** The tracked CSS files Stylelint was asked about. */
  readonly trackedStyle: readonly string[];
  readonly levels: Part<Rules>;
  readonly style: Part<Rules>;
  readonly cruise: Part<Cruise>;
  readonly fileSets: Part<ReadonlyMap<string, ProjectSets>>;
  readonly flags: Part<ReadonlyMap<string, Ranked>>;
  readonly settings: Part<Settings>;
  readonly laws: Part<ReadonlyMap<string, LawFacts>>;
  readonly profile: Part<Profile>;
  readonly tools: Part<ReadonlyMap<string, string>>;
}
