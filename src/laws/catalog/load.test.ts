import { afterAll, describe, expect, it } from "vitest";
import { loadCatalog } from "./load.ts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parse } from "yaml";

const ROOT = resolve(import.meta.dirname, "../../..");

/** One law file of the kit, read as the plain object the YAML holds (a test mutates a copy of it). */
function plainLaw(id: string): Record<string, unknown> {
  const doc: unknown = parse(readFileSync(join(ROOT, "laws", `${id}.yaml`), "utf8"));
  if (typeof doc !== "object" || doc === null) throw new Error(`${id}.yaml is not a map`);
  return Object.fromEntries(Object.entries(doc));
}

const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A scratch folder holding the given files, removed after the file's tests. */
function folder(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-laws-"));
  made.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

/** A law file's text, from a plain object (JSON is YAML). */
const asYaml = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** A catalog of `count` laws, each file W-NN.yaml holding law W-NN, with the given files replaced or added. */
function catalog(count: number, replace: Readonly<Record<string, string>> = {}): string {
  const files: Record<string, string> = {};
  for (let index = 1; index <= count; index += 1) {
    const id = `W-${String(index).padStart(2, "0")}`;
    files[`${id}.yaml`] = asYaml({ ...plainLaw("W-01"), id });
  }
  return folder({ ...files, ...replace });
}

const problemsOf = (dir: string): string[] => {
  const loaded = loadCatalog(dir);
  return loaded.ok
    ? []
    : loaded.problems.map((found) => `${found.file}${found.pointer} ${found.message}`);
};

describe("loadCatalog", () => {
  it("reads every W-NN.yaml of the folder, in id order, whatever order the folder lists them", () => {
    const loaded = loadCatalog(catalog(12));
    expect(loaded.ok && loaded.laws.map((law) => law.id)).toEqual(
      Array.from({ length: 12 }, (_, index) => `W-${String(index + 1).padStart(2, "0")}`),
    );
  });

  it("orders ids by number, so W-100 follows W-99", () => {
    const loaded = loadCatalog(catalog(101));
    expect(loaded.ok && loaded.laws.map((law) => law.id).slice(-3)).toEqual([
      "W-99",
      "W-100",
      "W-101",
    ]);
  });

  it("ignores a file that is not .yaml", () => {
    const dir = catalog(2, { "README.md": "# laws\n", "notes.txt": "x" });
    expect(problemsOf(dir)).toEqual([]);
  });

  it("is an empty catalog for a folder with no law", () => {
    expect(loadCatalog(folder({ "README.md": "x" }))).toEqual({ ok: true, laws: [] });
  });

  it("names the file and the field of an invalid law, and loads nothing", () => {
    const broken = { ...plainLaw("W-01"), id: "W-02", reader: undefined };
    const dir = catalog(3, { "W-02.yaml": asYaml(broken) });
    expect(problemsOf(dir)).toEqual(["W-02.yaml/reader must have required property 'reader'"]);
    expect(loadCatalog(dir).ok).toBe(false);
  });

  it("reports every invalid file, not the first", () => {
    const dir = catalog(3, {
      "W-01.yaml": asYaml({ ...plainLaw("W-01"), classes: ["cli"] }),
      "W-03.yaml": asYaml({ ...plainLaw("W-01"), id: "W-03", severity: "X" }),
    });
    expect(problemsOf(dir).map((line) => line.slice(0, 9))).toEqual(["W-01.yaml", "W-03.yaml"]);
  });

  it("refuses a file that is not YAML, naming it", () => {
    const dir = catalog(2, { "W-02.yaml": "id: [unclosed\n" });
    const [problem] = problemsOf(dir);
    expect(problem).toMatch(/^W-02\.yaml is not valid YAML: /);
  });

  it("refuses a file whose name is not its id", () => {
    const dir = catalog(2, { "W-02.yaml": asYaml({ ...plainLaw("W-01"), id: "W-05" }) });
    expect(problemsOf(dir)).toEqual(["W-02.yaml/id is W-05: a file is named for its id"]);
  });

  it("refuses a gap in the ids, at the first law that is out of place", () => {
    const dir = folder({
      "W-01.yaml": asYaml({ ...plainLaw("W-01") }),
      "W-03.yaml": asYaml({ ...plainLaw("W-01"), id: "W-03" }),
    });
    expect(problemsOf(dir)).toEqual([
      "W-03.yaml/id is out of place: expected W-02 (ids run from W-01 with no gap)",
    ]);
  });

  it("refuses ids that do not start at W-01", () => {
    const dir = folder({ "W-02.yaml": asYaml({ ...plainLaw("W-01"), id: "W-02" }) });
    expect(problemsOf(dir)).toEqual([
      "W-02.yaml/id is out of place: expected W-01 (ids run from W-01 with no gap)",
    ]);
  });

  it("does not report a gap while a file is invalid: the missing law is already the problem", () => {
    const dir = catalog(3, { "W-02.yaml": "not: [valid" });
    expect(problemsOf(dir)).toHaveLength(1);
  });

  it("says why a folder cannot be read", () => {
    const [problem] = problemsOf("/nonexistent/wt-laws");
    expect(problem).toMatch(/^\/nonexistent\/wt-laws cannot be read: .*ENOENT/);
  });
});
