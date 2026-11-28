import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/validate.ts";
import type { WebTopsConfig } from "../config/types.ts";
import { budgetEntriesOf } from "./budgets.ts";
import { settingsOf } from "./settings.ts";

const HEAD = 'protocol: "0.3.0"\nversion: "1"\npackage: fixture\n';

function config(extra = "", className = "web-app"): WebTopsConfig {
  const read = parseConfig(`${HEAD}class: ${className}\n${extra}`);
  if (!read.ok) throw new Error(JSON.stringify(read.problems));
  return read.value;
}

describe("budget fixture snapshots", () => {
  it("ts-library default exposes the class JS ceiling only", () => {
    const values = budgetEntriesOf(config("", "ts-library"));
    expect(values.get("budgets.class_js_ceiling")?.shown).toBe("51200");
    expect(values.has("budgets.page_js_bytes")).toBe(false);
  });

  it("ui-components honors explicit page_js when budgets are set", () => {
    const values = budgetEntriesOf(config("budgets:\n  page_js_bytes: 48000\n", "ui-components"));
    expect(values.get("budgets.page_js_bytes")?.shown).toBe("48000");
  });

  it("astro-site uses page_js as static fallback", () => {
    const values = budgetEntriesOf(config("budgets:\n  page_js_bytes: 12000\n", "astro-site"));
    expect(values.get("budgets.static_page_js_bytes")?.shown).toBe("12000");
    expect(values.get("budgets.page_js_bytes")?.shown).toBe("12000");
  });

  it("web-app prefers route_js over island default", () => {
    const values = budgetEntriesOf(
      config("budgets:\n  page_js_bytes: 1000\n  route_js_bytes: 2000\n", "web-app"),
    );
    expect(values.get("budgets.route_js_bytes")?.shown).toBe("2000");
    expect(values.get("budgets.page_js_bytes")?.shown).toBe("2000");
  });

  it("merges size_limit entries from budgets and layers", () => {
    const values = budgetEntriesOf(
      config(
        'budgets:\n  entries:\n    "./a": 8000\nlayers:\n  size_limit:\n    entries:\n      "./b": 6000\n',
        "ts-library",
      ),
    );
    expect(values.get("budgets.entries../a")?.shown).toBe("8000");
    expect(values.get("budgets.entries../b")?.shown).toBe("6000");
  });

  it("keeps entry-only size_limit without default_bytes", () => {
    const values = budgetEntriesOf(
      config('layers:\n  size_limit:\n    entries:\n      ".": 2500\n', "ts-library"),
    );
    expect(values.get("budgets.entries..")?.shown).toBe("2500");
    expect(values.get("budgets.class_js_ceiling")?.shown).toBe("51200");
  });

  it("settingsOf forwards effective budgets into the gate settings surface", () => {
    const values = settingsOf(config("budgets:\n  page_js_bytes: 2048\n"));
    expect(values.values.get("budgets.page_js_bytes")?.rank).toBe(-2048);
  });

  it("budgets on node-service enables comparison without package class", () => {
    const values = budgetEntriesOf(config("budgets:\n  page_js_bytes: 2048\n", "node-service"));
    expect(values.get("budgets.page_js_bytes")?.shown).toBe("2048");
  });

  it("lists default build review entries", () => {
    const values = budgetEntriesOf(config("", "web-app"));
    expect(values.get("build.command")?.shown).toBe("unset");
    expect(values.get("build.dir")?.review).toBe(true);
  });
});
