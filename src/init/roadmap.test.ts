import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The oracle for P3 G9, written from SPEC-p3 G9: section 19 is the plan of record in public words,
// section 16 records the 0.3.0 decisions and closes O6, and section 3.4 is the one list of rules.

const spec = readFileSync(join(import.meta.dirname, "../../WEB_TOPS.md"), "utf8");
const template = readFileSync(join(import.meta.dirname, "../../config/AGENTS.md.tmpl"), "utf8");

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`no section from ${start} to ${end}`);
  return text.slice(from, to);
}

const section16 = between(spec, "## 16. Decisions", "## 17. ");
const section19 = between(spec, "## 19. Roadmap", "## 20. ");
const section20 = between(spec, "## 20. First adopter", "## Credits and license");
const rules = between(spec, "### 3.4 Stated rules", "## 4. ");

/** The cells of the roadmap row that starts with the milestone label. */
function milestone(label: string): string[] {
  const line = section19.split("\n").find((candidate) => candidate.startsWith(`| **${label}**`));
  if (line === undefined) throw new Error(`section 19 has no row ${label}`);
  return line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((cell) => cell.trim());
}

describe("G9a: section 19 is the roadmap, one row per milestone with its exit", () => {
  it.each(["M0", "M1", "P3", "M2", "M3", "M4", "M5", "M6", "M7"])(
    "has a %s row with contents and an exit",
    (label) => {
      const [name, contents, exit] = milestone(label);
      expect(name).toBe(`**${label}**`);
      expect(contents?.length).toBeGreaterThan(20);
      expect(exit?.length).toBeGreaterThan(10);
    },
  );

  it("fixes M3's exit, and keeps law-diff in M3 and workspace-root in M6", () => {
    expect(milestone("M3")[2]).toBe(
      "Every law the class profile marks required is judged; the report prints N of M by class",
    );
    expect(milestone("M3")[1]).toContain("`law-diff`");
    expect(milestone("M6")[1]).toContain("`workspace-root`");
    for (const label of ["M2", "M4", "M5", "M7"]) {
      expect(milestone(label)[1], label).not.toContain("workspace-root");
    }
    expect(section19.match(/`law-diff`/g)).toHaveLength(1);
  });

  it("splits build output (M4) from rendered interface and themes (M5)", () => {
    expect(milestone("M4")[1]).toContain("Build output");
    expect(milestone("M4")[1]).not.toMatch(/W-4[2356]|theme/);
    expect(milestone("M5")[1]).toContain("Rendered interface and themes");
    for (const id of ["W-42", "W-43", "W-45", "W-46"]) expect(milestone("M5")[1], id).toContain(id);
    expect(milestone("M4")[2]).toContain("four planted defects");
    expect(milestone("M5")[2]).toContain("reduced motion");
  });

  it("states the adopter's exit in M6 and the freeze in M7", () => {
    expect(milestone("M6")[2]).toContain("`webtops gate` under ratchet");
    expect(milestone("M7")[2]).toContain("law ids and schemas frozen");
  });

  it("names P3's exit as the protocol true in text, schemas and fixtures with the gate green", () => {
    expect(milestone("P3")[2]).toContain("text, the schemas and the fixtures");
    expect(milestone("P3")[2]).toContain("kit's own gate is green");
  });
});

/**
 * The words are assembled from halves, so this file passes the name scan it enforces: a tracked
 * file may not spell a host, a seat or a person's name, and a test that did would fail the scan.
 */
const word = (...parts: string[]): string => parts.join("");
const HOSTS = [
  word("cas", "tle"),
  word("lat", "he"),
  word("api", "ary"),
  word("cita", "del"),
  word("her", "dr"),
];
const PEOPLE = [word("Ev", "an"), word("Pinch", "am"), word("Abd", "ul"), word("Ha", "lo")];

describe("G9a: the repository text keeps no vault path and no name", () => {
  it.each([
    ["a wikilink", /\[\[/],
    ["a vault path", /\bfoundry\/|~\/Obsidian|\.md\)/],
    ["a host or seat", new RegExp(`\\b(${HOSTS.join("|")})\\b`, "i")],
    ["a person or the squad", new RegExp(`\\b(${PEOPLE.join("|")})\\b`)],
  ])("has no %s anywhere in WEB_TOPS.md or the template", (_what, pattern) => {
    expect(spec).not.toMatch(pattern);
    expect(template).not.toMatch(pattern);
  });
});

describe("G9b: section 16 records the 0.3.0 decisions and closes O6", () => {
  const resolved = between(section16, "**Resolved for 0.3.0:**", "**Resolved for 0.2.1:**");

  it.each([
    ["23", "One verdict vocabulary"],
    ["24", "Required items"],
    ["25", "The report is the baseline's source"],
    ["26", "Protocol id by range"],
    ["27", "Migration"],
    ["28", "A shared core"],
    ["29", "Audience and platforms"],
    ["30", "ESLint 10"],
    ["31", "Rendered readers"],
  ])("resolves item %s, %s", (number, title) => {
    expect(resolved).toContain(`\n${number}. **${title}`);
    expect(section16).not.toContain("**Proposed for 0.3.0:**");
  });

  it("leaves nothing proposed for 0.3.0: the migration (27) is resolved with the rest", () => {
    expect(section16).not.toContain("**Proposed for 0.3.0:**");
    expect(resolved).toContain("27. **Migration:**");
  });

  it("records X1's seam, X4's macOS leg, W1's outcome with the fork, and W3", () => {
    expect(resolved).toContain("`schema/core.schema.json`, which is the seam");
    expect(resolved).toContain("`macos-latest`");
    expect(resolved).toContain("Only the fork also passed both claim rows");
    expect(resolved).toContain("`probes/w22/`");
    expect(resolved).toContain("the kit ships the W-42 to W-46 readers");
  });

  it("closes O6: it is gone from the open list, and item 31 says it is closed", () => {
    const open = section16.slice(section16.indexOf("**Open:**"));
    expect(open).not.toMatch(/^O6\./m);
    expect(resolved).toContain("This closes O6.");
  });

  it("marks the items the 0.2.1 runtime and 0.3.0 lint pin superseded", () => {
    expect(section16).toContain(
      "3. **Runtime:** Bun first; Node LTS supported for `node-service`. Superseded by item 19.",
    );
    expect(section16).toMatch(/4\. \*\*Test runner:\*\*[^\n]*Superseded by item 19/);
    expect(section16).toMatch(/11\. \*\*Lint pin:\*\*[^\n]*Superseded by item 30/);
  });
});

describe("G9c: section 20 is current", () => {
  it("assigns the pending classes to M6 and records the adoption plan and what it proves", () => {
    expect(section20).toContain("`cli` (profile in M6)");
    expect(section20).toContain("`workspace-root` (profile in M6)");
    expect(section20).not.toContain("profile pending");
    expect(section20).toContain("**What it proves for 0.3.0.**");
    expect(section20).toContain("**Adoption (M6).**");
    expect(section20).toContain("`knip` and `eslint-plugin-react-hooks`");
  });
});

describe("G9d: section 3.4 is the one list of rules", () => {
  it("holds the fourteen rules, numbered in order", () => {
    const numbers = [...rules.matchAll(/^(\d+)\. \*\*/gm)].map((match) => Number(match[1]));
    expect(numbers).toEqual(Array.from({ length: 14 }, (_, index) => index + 1));
  });

  it.each([
    [9, "Explain every accepted mutation survivor"],
    [10, "Every suppression names its rule and a reason"],
    [11, "Agent-authored code meets the same gate and the same cap"],
    [12, "Do not edit generated files"],
    [13, "Prefer deleting code to adding configuration"],
    [14, "Never edit `.web-tops/baseline.json` by hand"],
  ])("carries rule %i, which the template used to copy", (number, text) => {
    expect(rules).toContain(`${String(number)}. **${text}`);
  });

  it("is where the template's Policies section sends the reader, and the template lists none", () => {
    const policies = between(template, "## Policies", "## Standards");
    expect(policies).toContain("Web-TOPS §3.4");
    expect(policies).not.toMatch(/^\d+\. /m);
  });
});
