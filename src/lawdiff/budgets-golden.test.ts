import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/validate.ts";
import type { WebTopsConfig } from "../config/types.ts";
import { budgetEntriesOf } from "./budgets.ts";

const HEAD = 'protocol: "0.3.0"\nversion: "1"\npackage: fixture\n';

function config(extra = "", className = "web-app"): WebTopsConfig {
  const read = parseConfig(`${HEAD}class: ${className}\n${extra}`);
  if (!read.ok) throw new Error(JSON.stringify(read.problems));
  return read.value;
}

const snapshot = (extra = "", className = "web-app"): Record<string, string> =>
  Object.fromEntries(
    [...budgetEntriesOf(config(extra, className)).entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, ranked]) => [key, ranked.shown]),
  );

describe("budget golden maps", () => {
  const cases: {
    name: string;
    extra: string;
    className?: string;
    expect: Record<string, string>;
  }[] = [
    {
      name: "node-service bare",
      extra: "",
      className: "node-service",
      expect: { "build.command": "unset", "build.dir": "dist" },
    },
    {
      name: "ts-library package default",
      extra: "",
      className: "ts-library",
      expect: {
        "budgets.class_js_ceiling": "51200",
        "build.command": "unset",
        "build.dir": "dist",
      },
    },
    {
      name: "web-app defaults",
      extra: "",
      className: "web-app",
      expect: {
        "budgets.class_js_ceiling": "174080",
        "build.command": "unset",
        "build.dir": "dist",
      },
    },
    {
      name: "astro-site defaults",
      extra: "",
      className: "astro-site",
      expect: {
        "budgets.class_js_ceiling": "51200",
        "budgets.static_page_js_bytes": "0",
        "build.command": "unset",
        "build.dir": "dist",
      },
    },
    {
      name: "ui-components explicit page_js",
      extra: "budgets:\n  page_js_bytes: 44000\n",
      className: "ui-components",
      expect: {
        "budgets.page_js_bytes": "44000",
        "build.command": "unset",
        "build.dir": "dist",
      },
    },
    {
      name: "astro static uses page_js fallback",
      extra: "budgets:\n  page_js_bytes: 9000\n",
      className: "astro-site",
      expect: {
        "budgets.page_js_bytes": "9000",
        "budgets.static_page_js_bytes": "9000",
        "build.command": "unset",
        "build.dir": "dist",
      },
    },
    {
      name: "routes list",
      extra: "routes:\n  - /\n  - /app\n",
      expect: {
        "budgets.class_js_ceiling": "174080",
        "build.command": "unset",
        "build.dir": "dist",
        "routes./": "judged",
        "routes./app": "judged",
      },
    },
    {
      name: "entry-only layer on node-service",
      extra: 'layers:\n  size_limit:\n    entries:\n      "./pkg": 1200\n',
      className: "node-service",
      expect: {
        "budgets.entries../pkg": "1200",
        "build.command": "unset",
        "build.dir": "dist",
      },
    },
    {
      name: "pages map only",
      extra: 'budgets:\n  pages:\n    "/home/": 32000\n',
      expect: {
        "budgets.class_js_ceiling": "174080",
        "budgets.pages./home/": "32000",
        "build.command": "unset",
        "build.dir": "dist",
      },
    },
    {
      name: "routes map only",
      extra: 'budgets:\n  routes:\n    "/api": 64000\n',
      expect: {
        "budgets.class_js_ceiling": "174080",
        "budgets.routes./api": "64000",
        "build.command": "unset",
        "build.dir": "dist",
      },
    },
    {
      name: "custom build",
      extra: 'build:\n  dir: build\n  command: "vite build"\n',
      expect: {
        "budgets.class_js_ceiling": "174080",
        "build.command": "vite build",
        "build.dir": "build",
      },
    },
    {
      name: "default dot entry",
      extra: "layers:\n  size_limit:\n    default_bytes: 8000\n",
      className: "ts-library",
      expect: {
        "budgets.entries..": "8000",
        "build.command": "unset",
        "build.dir": "dist",
        "layers.size_limit.default_bytes": "8000",
      },
    },
  ];

  for (const row of cases) {
    it(row.name, () => {
      expect(snapshot(row.extra, row.className)).toEqual(row.expect);
    });
  }
});
