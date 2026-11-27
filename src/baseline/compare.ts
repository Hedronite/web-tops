import type { Baseline, BaselineCoverage, BaselineCrap, Breach, CensusEntry } from "./types.ts";

/** A package's coverage is below its baseline: the ratio compared exactly, by cross-multiplying, with no tolerance. */
function lower(now: BaselineCoverage, then: BaselineCoverage): boolean {
  if (now.lines_found === 0) return then.lines_hit > 0;
  if (then.lines_found === 0) return false;
  return now.lines_hit * then.lines_found < then.lines_hit * now.lines_found;
}

const fileOf = (key: string): string => key.split("::")[0] ?? key;

function newCrap(key: string, now: BaselineCrap, cap: number): Breach[] {
  if (now.crap <= cap) return [];
  const message = `${key} is new and its CRAP ${String(now.crap)} is above the cap ${String(cap)}`;
  return [{ layer: "crap", rule: "ratchet-crap-new", file: fileOf(key), message }];
}

function upCrap(key: string, now: BaselineCrap, then: BaselineCrap): Breach[] {
  if (now.crap <= then.crap) return [];
  const message = `${key} has CRAP ${String(now.crap)}, above its baseline ${String(then.crap)}`;
  return [{ layer: "crap", rule: "ratchet-crap-up", file: fileOf(key), message }];
}

function crapBreach(
  key: string,
  now: BaselineCrap,
  then: BaselineCrap | undefined,
  cap: number,
): Breach[] {
  return then === undefined ? newCrap(key, now, cap) : upCrap(key, now, then);
}

function crapBreaches(base: Baseline, current: Baseline, cap: number): readonly Breach[] {
  return Object.entries(current.crap).flatMap(([key, now]) =>
    crapBreach(key, now, base.crap[key], cap),
  );
}

function coverageBreaches(base: Baseline, current: Baseline): readonly Breach[] {
  return Object.entries(base.coverage).flatMap(([name, then]): Breach[] => {
    const now = current.coverage[name];
    return now !== undefined && lower(now, then)
      ? [
          {
            layer: "coverage",
            rule: "ratchet-coverage-down",
            message: `coverage of ${name} is ${String(now.lines_hit)} of ${String(now.lines_found)} lines, below its baseline ${String(then.lines_hit)} of ${String(then.lines_found)}`,
          },
        ]
      : [];
  });
}

const findingLayer = (rule: string): Breach["layer"] =>
  rule.startsWith("axe:") ? "build-output" : "hygiene";

function toFindingBreach(rule: string, file: string, count: number, then: number): Breach {
  return {
    layer: findingLayer(rule),
    rule: "ratchet-findings-up",
    ...(file === "(built-page)" ? {} : { file }),
    message: `${rule} in ${file}: ${String(count)} findings, above its baseline ${String(then)}`,
  };
}

function findingBreaches(base: Baseline, current: Baseline): readonly Breach[] {
  return Object.entries(current.findings).flatMap(([rule, files]) =>
    Object.entries(files).flatMap(([file, count]): Breach[] => {
      const then = base.findings[rule]?.[file] ?? 0;
      return count > then ? [toFindingBreach(rule, file, count, then)] : [];
    }),
  );
}

function newPrints(now: CensusEntry, then: CensusEntry | undefined): string[] {
  const known = new Set(then?.fingerprints ?? []);
  return now.fingerprints.filter((print) => !known.has(print)).slice(0, 3);
}

const COVERAGE_KINDS = /^(v8|istanbul|c8)-ignore$/u;

const censusLayer = (kind: string): Breach["layer"] =>
  COVERAGE_KINDS.test(kind) ? "coverage" : "hygiene";

function censusBreach(kind: string, now: CensusEntry, then: CensusEntry | undefined): Breach[] {
  const before = then?.count ?? 0;
  if (now.count <= before) return [];
  const added = newPrints(now, then).join(", ");
  const message = `${kind}: ${String(now.count)} directives, above its baseline ${String(before)} (new: ${added})`;
  return [{ layer: censusLayer(kind), rule: "ratchet-census-up", message }];
}

function censusBreaches(base: Baseline, current: Baseline): readonly Breach[] {
  return Object.entries(current.census).flatMap(([kind, now]) =>
    censusBreach(kind, now, base.census[kind]),
  );
}

function pageBreaches(base: Baseline, current: Baseline): readonly Breach[] {
  return Object.entries(current.pages).flatMap(([route, bytes]): Breach[] => {
    const then = base.pages[route];
    return then !== undefined && bytes > then
      ? [
          {
            layer: "build-output",
            rule: "ratchet-pages-up",
            message: `${route} is ${String(bytes)} bytes, above its baseline ${String(then)}`,
          },
        ]
      : [];
  });
}

/**
 * What a run has above its baseline (WEB_TOPS.md section 6.7): a new function above the class cap, an existing
 * function above its baseline CRAP, package coverage below its baseline, a per-rule per-file finding count that
 * rose, a suppression kind whose count rose, and a page over its bytes. A function or file that is gone has no
 * allowance left, and a function that is renamed is new.
 */
export function ratchetBreaches(base: Baseline, current: Baseline, cap: number): readonly Breach[] {
  return [
    ...crapBreaches(base, current, cap),
    ...coverageBreaches(base, current),
    ...findingBreaches(base, current),
    ...censusBreaches(base, current),
    ...pageBreaches(base, current),
  ];
}
