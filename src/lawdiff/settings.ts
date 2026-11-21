import { profileFor } from "../config/profiles.ts";
import type { WebTopsConfig } from "../config/types.ts";
import type { Ranked, Settings } from "./types.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The value at a dotted path of the config, or undefined where the path leaves it. */
export const at = (config: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), config);

type Entry = readonly [string, Ranked];

/** The switches of the config: on unless the file says `enabled: false`. */
function switchPaths(): readonly string[] {
  return [
    "gates.hygiene",
    "gates.hygiene.install",
    "gates.hygiene.tsc",
    "gates.hygiene.eslint",
    "gates.hygiene.format",
    "gates.hygiene.dependency_cruiser",
    "gates.hygiene.audit",
    "gates.tests",
    "gates.coverage",
    "gates.crap",
    "gates.mutation",
    "layers.size_limit",
    "layers.package_exports",
    "layers.html_validate",
    "layers.axe",
    "layers.rendered",
    "layers.themes",
    "laws",
  ];
}

const switchOf = (config: WebTopsConfig, path: string): Entry => [
  path,
  at(config, `${path}.enabled`) === false ? { shown: "off", rank: 0 } : { shown: "on", rank: 1 },
];

/** A limit by its path and which way is stricter: a floor is stricter higher, a cap lower. */
function limitPaths(): readonly (readonly [
  string,
  1 | -1,
  (name: string) => number | undefined,
])[] {
  return [
    ["gates.coverage.lines_floor", 1, (name) => profileFor(name)?.linesFloor],
    ["gates.crap.cap", -1, (name) => profileFor(name)?.crapCap],
    [
      "gates.mutation.unexplained_survivors_max",
      -1,
      (name) => profileFor(name)?.unexplainedSurvivorsMax,
    ],
  ];
}

function limitEntries(config: WebTopsConfig): Entry[] {
  return limitPaths().flatMap(([path, sign, fallback]): Entry[] => {
    const set = at(config, path);
    const value = typeof set === "number" ? set : fallback(config.class);
    return value === undefined ? [] : [[path, { shown: String(value), rank: sign * value }]];
  });
}

/** A setting with a fixed order of values, the stricter last, and the value it has when the file says nothing. */
function modePaths(): readonly (readonly [string, readonly string[], string])[] {
  return [
    ["gates.crap.scope", ["diff", "all"], "diff"],
    ["gates.mutation.scope", ["diff", "all"], "diff"],
    ["gates.hygiene.audit.fail_on", ["critical", "high", "moderate", "low"], "high"],
    ["laws.select", ["default", "all"], "default"],
  ];
}

const enforceOrder = (): readonly string[] => ["advisory", "ratchet", "hard"];

function modeEntries(config: WebTopsConfig): Entry[] {
  const enforce: Entry = [
    "enforce",
    { shown: config.enforce, rank: enforceOrder().indexOf(config.enforce) },
  ];
  const others = modePaths().map(([path, order, fallback]): Entry => {
    const set = at(config, path);
    const shown = typeof set === "string" ? set : fallback;
    return [path, { shown, rank: order.indexOf(shown) }];
  });
  return [enforce, ...others];
}

/** An exemption is weaker than none, and a later end is weaker than an earlier one. */
function exemptionEntry(config: WebTopsConfig): Entry {
  const granted = config.exemption;
  return granted === undefined
    ? ["exemption", { shown: "none", rank: 1 }]
    : ["exemption", { shown: `granted until ${granted.until}`, rank: -Date.parse(granted.until) }];
}

/** The tests run shuffled unless the file says they do not: not shuffling is weaker. */
const shuffleEntry = (config: WebTopsConfig): Entry => [
  "gates.tests.shuffle",
  at(config, "gates.tests.shuffle") === false
    ? { shown: "off", rank: 0 }
    : { shown: "on", rank: 1 },
];

/** Where the config says a file is: no better or worse, so a move is listed for review. */
function reviewPaths(): readonly string[] {
  return ["baseline", "gates.mutation.ledger", "laws.ack_ledger"];
}

function reviewEntries(config: WebTopsConfig): Entry[] {
  return reviewPaths().map((path): Entry => {
    const set = at(config, path);
    return [path, { shown: typeof set === "string" ? set : "unset", rank: 0, review: true }];
  });
}

/** The globs of `gates.coverage.exclude`. */
function globsOf(config: WebTopsConfig): string[] {
  const excluded = at(config, "gates.coverage.exclude");
  if (!Array.isArray(excluded)) return [];
  return excluded.flatMap((entry): string[] => {
    const glob = at(entry, "glob");
    return typeof glob === "string" ? [glob] : [];
  });
}

/** What the settings surface leaves out, said in its note. */
export function notCompared(): string {
  return "not compared: gates.tests.runner, the hygiene format tool and ESLint config path, mutation engine, base and time budget, toolchain, custom layers, the details of rendered and themes, report.path; size budgets: only whether size_limit is on, until M4 brings the per-entry byte budgets";
}

/** The settings of a `web-tops.yaml` that hold the gate: what is on, how high each floor, how low each cap, and the exclusions. */
export function settingsOf(config: WebTopsConfig): Settings {
  return {
    values: new Map([
      ...switchPaths().map((path) => switchOf(config, path)),
      ...limitEntries(config),
      ...modeEntries(config),
      exemptionEntry(config),
      shuffleEntry(config),
      ...reviewEntries(config),
    ]),
    globs: globsOf(config),
  };
}
