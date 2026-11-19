import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";
import { loadCatalog, syncTables } from "../laws/catalog/index.ts";
import type { Law } from "../laws/catalog/index.ts";
import type { Io } from "./io.ts";
import { runLawsCli } from "./laws.ts";

const ROOT = resolve(import.meta.dirname, "../..");
/** The kit's own catalog, loaded: a test that needs the real laws fails here if the catalog is invalid. */
function realLaws(): readonly Law[] {
  const loaded = loadCatalog(join(ROOT, "laws"));
  if (!loaded.ok) throw new Error(loaded.problems.map((found) => found.message).join("; "));
  return loaded.laws;
}

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

function capture(cwd = ROOT): { io: Io; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd,
    env: {},
  };
  return { io, out: () => out, err: () => err };
}

async function laws(argv: readonly string[], cwd = ROOT, catalog?: string) {
  const { io, out, err } = capture(cwd);
  const code = await runLawsCli(argv, io, catalog);
  return { code, out: out(), err: err() };
}

const idsOf = (out: string): string[] =>
  out
    .split("\n")
    .filter((line) => line.startsWith("W-"))
    .map((line) => line.slice(0, 4 + 1).trim());

describe("webtops laws list (G1b)", () => {
  it("lists all 48 laws with no filter", async () => {
    const { code, out } = await laws(["list"]);
    expect(code).toBe(0);
    expect(out.startsWith("48 of 48 laws\n")).toBe(true);
    expect(idsOf(out)).toHaveLength(48);
  });

  it("lists the laws a class requires, 22 for a ts-library and 21 for a node-service", async () => {
    const tsLibrary = await laws(["list", "--class", "ts-library", "--required"]);
    expect(tsLibrary.out.split("\n")[0]).toBe("22 of 48 laws (class ts-library, required)");
    const service = await laws(["list", "--class=node-service", "--required"]);
    expect(service.out.split("\n")[0]).toBe("21 of 48 laws (class node-service, required)");
    expect(idsOf(service.out)).not.toContain("W-18");
  });

  it("lists the laws a class maps with --class alone, and the judged laws with --required alone", async () => {
    expect((await laws(["list", "--class", "astro-site"])).out.split("\n")[0]).toBe(
      "47 of 48 laws (class astro-site)",
    );
    expect((await laws(["list", "--required"])).out.split("\n")[0]).toBe(
      "33 of 48 laws (required)",
    );
  });

  it("prints the filtered laws as JSON, every field", async () => {
    const { code, out } = await laws(["list", "--class", "ts-library", "--required", "--json"]);
    const parsed: unknown = JSON.parse(out);
    expect(code).toBe(0);
    expect(Array.isArray(parsed) && parsed).toHaveLength(22);
    expect(Array.isArray(parsed) && parsed[0]).toMatchObject({
      id: "W-01",
      severity: "R",
      judged: "v0.1",
    });
  });

  it("exits 2 with the classes it knows for a class it does not", async () => {
    const { code, out, err } = await laws(["list", "--class", "cli"]);
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toContain(
      'unknown class "cli" (one of ts-library, ui-components, astro-site, web-app, node-service)',
    );
    expect(err).toContain("usage: webtops laws");
  });

  it("exits 2 for a word it does not take, an option it does not know and an option with no value", async () => {
    expect((await laws(["list", "W-01"])).err).toContain("list takes no words after it");
    expect((await laws(["list", "--all"])).err).toContain("unknown option --all");
    expect((await laws(["list", "--class"])).err).toContain("--class needs a value");
  });
});

describe("webtops laws explain (G1b)", () => {
  it("prints every field of a law", async () => {
    const { code, out } = await laws(["explain", "W-01"]);
    expect(code).toBe(0);
    for (const label of [
      "family:",
      "severity:",
      "classes:",
      "kinds:",
      "reader:",
      "rules:",
      "judged:",
      "rationale:",
      "fix:",
    ]) {
      expect(out, label).toContain(`\n${label}`);
    }
    expect(out.startsWith("W-01  No `any`")).toBe(true);
  });

  it("prints the law as JSON under --json", async () => {
    const { out } = await laws(["explain", "W-27", "--json"]);
    expect(JSON.parse(out)).toMatchObject({
      id: "W-27",
      conditional_classes: ["ui-components", "web-app"],
    });
  });

  it("exits 2 for an id that is not in the catalog, and for no id or two", async () => {
    expect((await laws(["explain", "W-99"])).err).toContain('no law "W-99" in the catalog');
    expect((await laws(["explain", "W-99"])).code).toBe(2);
    expect((await laws(["explain"])).err).toContain("explain takes one law id after it");
    expect((await laws(["explain", "W-01", "W-02"])).code).toBe(2);
  });
});

describe("webtops laws with a bad subcommand or a bad catalog", () => {
  it("exits 2 with the usage for no subcommand and for an unknown one", async () => {
    for (const argv of [[], ["frobnicate"], ["constructor"]]) {
      const { code, out, err } = await laws(argv);
      expect(code, argv.join(" ")).toBe(2);
      expect(out).toBe("");
      expect(err).toBe(
        "webtops laws: expected list, explain or sync\nusage: webtops laws [list [--class <class>] [--required] [--json] | explain <W-NN> [--json] | sync [--check]]\n",
      );
    }
  });

  it("names each invalid file and field, and exits 2, for a catalog that is not valid", async () => {
    const dir = folder({
      "W-01.yaml": asYaml({ ...plainLaw("W-01"), reader: undefined, classes: ["cli"] }),
    });
    const { code, out, err } = await laws(["list"], ROOT, dir);
    expect(code).toBe(2);
    expect(out).toBe("");
    const lines = err.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("webtops laws: the catalog is invalid");
    expect(lines.slice(1, 3).sort()).toEqual([
      '  W-01.yaml/classes/0: must be equal to one of the allowed values: ["ts-library","ui-components","astro-site","web-app","node-service"]',
      "  W-01.yaml/reader: must have required property 'reader'",
    ]);
    expect(lines[3]).toBe("");
  });
});

describe("webtops laws sync (G1c)", () => {
  const protocol = readFileSync(join(ROOT, "WEB_TOPS.md"), "utf8");
  const drifted = protocol.replace("`switch` over a union is exhaustive", "`switch` is exhaustive");

  it("says the section 8.2 of the kit's WEB_TOPS.md matches the catalog, and exits 0", async () => {
    const { code, out } = await laws(["sync", "--check"]);
    expect([code, out]).toEqual([0, "WEB_TOPS.md section 8.2 matches laws/\n"]);
  });

  it("with --check, exits 1 for a drifted document, says so and changes nothing", async () => {
    const dir = folder({ "WEB_TOPS.md": drifted });
    const { code, out, err } = await laws(["sync", "--check"], dir);
    expect([code, out]).toEqual([1, ""]);
    expect(err).toBe("WEB_TOPS.md section 8.2 differs from laws/: run webtops laws sync\n");
    expect(readFileSync(join(dir, "WEB_TOPS.md"), "utf8")).toBe(drifted);
  });

  it("without --check, rewrites the tables from the catalog and says so", async () => {
    const dir = folder({ "WEB_TOPS.md": drifted });
    const { code, out } = await laws(["sync"], dir);
    expect([code, out]).toEqual([0, "WEB_TOPS.md section 8.2 rewritten from laws/\n"]);
    expect(readFileSync(join(dir, "WEB_TOPS.md"), "utf8")).toBe(protocol);
  });

  it("says a document that matches matches, with or without --check, and leaves it alone", async () => {
    const dir = folder({ "WEB_TOPS.md": protocol });
    writeFileSync(join(dir, "marker"), "");
    for (const argv of [["sync"], ["sync", "--check"]]) {
      const { code, out } = await laws(argv, dir);
      expect([code, out]).toEqual([0, "WEB_TOPS.md section 8.2 matches laws/\n"]);
    }
  });

  it("exits 2 when there is no WEB_TOPS.md, or it has no section 8.2 tables for the catalog", async () => {
    const empty = folder({ "other.md": "x" });
    expect((await laws(["sync"], empty)).err).toBe(
      `webtops laws: cannot read WEB_TOPS.md in ${empty}\n`,
    );
    const bare = folder({ "WEB_TOPS.md": "# nothing\n" });
    const { code, err } = await laws(["sync"], bare);
    expect(code).toBe(2);
    expect(err).toBe("webtops laws: WEB_TOPS.md has no section 8.2 followed by section 8.3\n");
  });

  it("exits 2 for a word it does not take", async () => {
    const { code, err } = await laws(["sync", "extra"]);
    expect(code).toBe(2);
    expect(err).toContain("sync takes no words after it");
  });

  it("lists, one to a line, every family the document has no table for", async () => {
    const bare = folder({
      "WEB_TOPS.md": "# x\n\n### 8.2 Law catalog\n\ntext\n\n### 8.3 Law metadata\n",
    });
    const { code, err } = await laws(["sync"], bare);
    const lines = err.trimEnd().split("\n");
    expect(code).toBe(2);
    expect(lines).toHaveLength(9);
    expect(lines[0]).toBe("webtops laws: section 8.2 has no table for the Types family");
    expect(lines[8]).toBe("section 8.2 has no table for the React and dead code family");
  });

  it("produces from the catalog what the library function produces", () => {
    expect(syncTables(drifted, realLaws())).toEqual({ ok: true, markdown: protocol });
  });
});
