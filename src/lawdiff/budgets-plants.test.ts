import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/validate.ts";
import type { WebTopsConfig } from "../config/types.ts";
import { compareBudgetSettings } from "./budgets.ts";
import { settingsOf } from "./settings.ts";

const HEAD = 'protocol: "0.3.0"\nversion: "1"\npackage: fixture\n';

function config(extra = "", className = "ts-library"): WebTopsConfig {
  const read = parseConfig(`${HEAD}class: ${className}\n${extra}`);
  if (!read.ok) {
    throw new Error(JSON.stringify(read.problems));
  }
  return read.value;
}

describe("byte budget plants", () => {
  it("inverted ceiling comparison: a higher byte ceiling is weaker, a lower one stronger", () => {
    const astroOff = 'gates:\n  hygiene:\n    astro_check: { enabled: false, reason: "fixture" }\n';
    const loose = settingsOf(config(`${astroOff}budgets:\n  page_js_bytes: 900000\n`, "web-app"));
    const tight = settingsOf(config(`${astroOff}budgets:\n  page_js_bytes: 1000\n`, "web-app"));
    expect(compareBudgetSettings(tight, loose)).toEqual([
      {
        what: "budgets.page_js_bytes",
        change: "weakened",
        before: "1000",
        after: "900000",
      },
    ]);
    expect(compareBudgetSettings(loose, tight)).toEqual([
      {
        what: "budgets.page_js_bytes",
        change: "strengthened",
        before: "900000",
        after: "1000",
      },
    ]);
  });

  it("ignored override removal: dropping a redundant budgets.entries row is unchanged when the layer still sets the ceiling", () => {
    const base = settingsOf(
      config(
        'budgets:\n  entries:\n    ".": 5000\nlayers:\n  size_limit:\n    entries:\n      ".": 2000\n',
      ),
    );
    const head = settingsOf(config('layers:\n  size_limit:\n    entries:\n      ".": 2000\n'));
    expect(compareBudgetSettings(base, head)).toEqual([]);
  });

  it("precedence swap must detect weaken when the layer entry ceiling rises", () => {
    const base = settingsOf(
      config(
        'budgets:\n  entries:\n    ".": 2000\nlayers:\n  size_limit:\n    entries:\n      ".": 2000\n',
      ),
    );
    const head = settingsOf(
      config(
        'budgets:\n  entries:\n    ".": 2000\nlayers:\n  size_limit:\n    entries:\n      ".": 900000\n',
      ),
    );
    expect(compareBudgetSettings(base, head)).toEqual([
      {
        what: "budgets.entries..",
        change: "weakened",
        before: "2000",
        after: "900000",
      },
    ]);
  });
});
