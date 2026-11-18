import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { madeDirs, put, tempDir } from "../init/test-support.ts";
import { keyString } from "../survivors/key.ts";
import type { SurvivorKey } from "../survivors/key.ts";
import {
  CLAMP_KEY,
  SUM_KEY,
  entryYaml,
  ledgerYaml,
  reportWith,
} from "../survivors/test-support.ts";
import { survivorId } from "../survivors/view.ts";
import { runSurvivorsCli } from "./survivors.ts";

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date("2026-11-17T12:00:00Z");
const LEDGER = ".web-tops/survivors.yaml";
const REPORT = ".web-tops/report.json";

async function cli(argv: readonly string[], cwd: string, now: Date = NOW) {
  let out = "";
  let err = "";
  const code = await runSurvivorsCli(
    argv,
    {
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
      cwd,
      env: {},
    },
    () => now,
  );
  return { code, out, err };
}

const OTHER_KEY: SurvivorKey = { ...SUM_KEY, occurrence: 2 };

/** A project with a ledger (live entry for clamp, expired one for total, stale one) and a report with two survivors. */
function project(): string {
  const dir = tempDir();
  put(
    dir,
    LEDGER,
    ledgerYaml(
      entryYaml(CLAMP_KEY, [
        "reason: boundary is equivalent",
        "owner: web-platform",
        "expires: 2027-03-31",
      ]),
      entryYaml(SUM_KEY, ["reason: old", "owner: someone", "expires: 2026-11-16"]),
      entryYaml({ ...CLAMP_KEY, occurrence: 3 }, ["reason: gone", "owner: someone"]),
    ),
  );
  put(dir, REPORT, reportWith(CLAMP_KEY, OTHER_KEY));
  return dir;
}

const digest = (dir: string, path = LEDGER): string =>
  createHash("sha256")
    .update(readFileSync(join(dir, path)))
    .digest("hex");

describe("webtops survivors list", () => {
  it("is an empty ledger and a missing report, said plainly, for a project with neither", async () => {
    const { code, out } = await cli(["list"], tempDir());
    expect(code).toBe(0);
    expect(out).toContain("0 entries, 0 expired, 0 stale");
    expect(out).toContain("no report");
  });

  it("marks each entry ok, expired or stale, and lists the unexplained survivors with an id", async () => {
    const { code, out } = await cli(["list"], project());
    expect(code).toBe(0);
    expect(out).toContain("3 entries, 1 expired, 1 stale (today 2026-11-17 UTC)");
    expect(out).toMatch(/\n {2}ok {6} /);
    expect(out).toMatch(/\n {2}expired /);
    expect(out).toMatch(/\n {2}stale {3} /);
    expect(out).toContain("expires 2027-03-31 (in 134 days)");
    expect(out).toContain("expired 2026-11-16 (1 day ago)");
    expect(out).toContain("owner web-platform");
    expect(out).toContain("reason: boundary is equivalent");
    expect(out).toContain("unexplained survivors in the last report: 1");
    expect(out).toContain(survivorId(OTHER_KEY));
  });

  it("prints the same as JSON, with every key field", async () => {
    const { out } = await cli(["list", "--json"], project());
    const parsed: unknown = JSON.parse(out);
    const entries = field(parsed, "entries");
    expect(field(parsed, "today")).toBe("2026-11-17");
    expect(field(parsed, "report")).toBe("present");
    expect(Array.isArray(entries) && entries.map((row) => field(row, "status"))).toEqual([
      "ok",
      "expired",
      "stale",
    ]);
    expect(Array.isArray(entries) && field(entries[0], "original")).toBe("n < low");
    const unexplained = field(parsed, "unexplained");
    expect(Array.isArray(unexplained) && field(unexplained[0], "id")).toBe(survivorId(OTHER_KEY));
  });

  it("is `list` when no subcommand is given, with or without an option", async () => {
    const dir = project();
    expect((await cli([], dir)).out).toContain("3 entries");
    expect(JSON.parse((await cli(["--json"], dir)).out)).toHaveProperty("entries");
  });

  it("changes nothing", async () => {
    const dir = project();
    const before = digest(dir);
    await cli(["list"], dir);
    expect(digest(dir)).toBe(before);
  });

  it("exits 2 with each problem at its pointer for an invalid ledger", async () => {
    const dir = tempDir();
    put(
      dir,
      LEDGER,
      ledgerYaml(entryYaml(CLAMP_KEY, ["owner: o"]), entryYaml(SUM_KEY, ["reason: r"])),
    );
    const { code, err } = await cli(["list"], dir);
    expect(code).toBe(2);
    expect(err).toContain("/survivors/0/reason: reason is missing");
    expect(err).toContain("/survivors/1/owner: owner is missing");
  });

  it("reads the ledger and report paths web-tops.yaml names", async () => {
    const dir = tempDir();
    put(
      dir,
      "web-tops.yaml",
      "gates:\n  mutation:\n    ledger: ledger/accepted.yaml\nreport:\n  path: out/r.json\n",
    );
    put(dir, "ledger/accepted.yaml", ledgerYaml(entryYaml(CLAMP_KEY)));
    put(dir, "out/r.json", reportWith(CLAMP_KEY));
    const { code, out } = await cli(["list"], dir);
    expect(code).toBe(0);
    expect(out).toContain("ledger/accepted.yaml: 1 entries");
    expect(out).toContain("unexplained survivors in the last report: 0");
  });

  it("refuses a ledger that is a symbolic link, and a list with arguments", async () => {
    const dir = tempDir();
    put(dir, "real.yaml", "version: 1\n");
    mkdirSync(join(dir, ".web-tops"));
    symlinkSync(join(dir, "real.yaml"), join(dir, LEDGER));
    expect((await cli(["list"], dir)).code).toBe(2);
    expect((await cli(["list", "extra"], project())).code).toBe(2);
  });
});

describe("webtops survivors explain", () => {
  const id = survivorId(OTHER_KEY);
  const said = ["--reason", "equivalent mutant", "--owner", "web-platform"];

  it("records the survivor named by its id, with its reason, owner and expiry", async () => {
    const dir = project();
    const { code, out } = await cli(["explain", id, ...said, "--expires", "2027-01-31"], dir);
    expect(code).toBe(0);
    expect(out).toContain(`explained ${id}`);
    const listed: unknown = JSON.parse((await cli(["list", "--json"], dir)).out);
    const unexplained = field(listed, "unexplained");
    expect(Array.isArray(unexplained) && unexplained).toHaveLength(0);
    expect(readFileSync(join(dir, LEDGER), "utf8")).toContain("expires: 2027-01-31");
  });

  it("takes an id prefix of six characters, and `--flag=value`", async () => {
    const dir = project();
    const { code } = await cli(["explain", id.slice(0, 6), "--reason=r", "--owner=o"], dir);
    expect(code).toBe(0);
  });

  it("says `replaced` and changes only reason, owner and expiry when the survivor already has an entry", async () => {
    const dir = project();
    const clamp = survivorId(CLAMP_KEY);
    const { out } = await cli(
      ["explain", clamp, "--reason", "new reason", "--owner", "new owner"],
      dir,
    );
    expect(out).toContain(`replaced ${clamp}`);
    const text = readFileSync(join(dir, LEDGER), "utf8");
    expect(text).toContain("new reason");
    expect(text).not.toContain("boundary is equivalent");
    expect(text).not.toContain("expires: 2027-03-31");
  });

  it("is idempotent", async () => {
    const dir = project();
    await cli(["explain", id, ...said], dir);
    const once = digest(dir);
    expect((await cli(["explain", id, ...said], dir)).out).toContain("replaced");
    expect(digest(dir)).toBe(once);
  });

  it.each([
    ["no reason", ["--owner", "o"], "--reason and --owner"],
    ["no owner", ["--reason", "r"], "--reason and --owner"],
    ["a blank reason", ["--reason", "  ", "--owner", "o"], "--reason and --owner"],
    ["a blank owner", ["--reason", "r", "--owner", ""], "--reason and --owner"],
    ["an expiry that is not a date", [...said, "--expires", "soon"], "--expires"],
    ["an impossible date", [...said, "--expires", "2027-02-30"], "--expires"],
    ["an expiry in the past", [...said, "--expires", "2026-11-16"], "--expires"],
    ["an unknown option", [...said, "--force"], "unknown option --force"],
    ["a value with nothing after it", ["--reason"], "needs a value"],
  ])("refuses %s and writes nothing", async (_name, rest, message) => {
    const dir = project();
    const before = digest(dir);
    const { code, err } = await cli(["explain", id, ...rest], dir);
    expect(code).toBe(2);
    expect(err).toContain(message);
    expect(digest(dir)).toBe(before);
  });

  it("accepts an expiry on today's date", async () => {
    expect((await cli(["explain", id, ...said, "--expires", "2026-11-17"], project())).code).toBe(
      0,
    );
  });

  it.each([
    ["no id", [...said], "one survivor id"],
    ["two ids", [id, "abcdef1234", ...said], "one survivor id"],
    ["an id that is too short", ["abc12", ...said], "at least 6 characters"],
    ["an id that is not in the report", ["0000000000", ...said], "no survivor 0000000000"],
  ])("refuses %s", async (_name, args, message) => {
    const dir = project();
    const before = digest(dir);
    const { code, err } = await cli(["explain", ...args], dir);
    expect(code).toBe(2);
    expect(err).toContain(message);
    expect(digest(dir)).toBe(before);
  });

  it("refuses an id prefix that names two survivors", async () => {
    const seen = new Map<string, SurvivorKey>();
    let pair: [SurvivorKey, SurvivorKey] | undefined;
    for (let occurrence = 1; pair === undefined; occurrence += 1) {
      const key: SurvivorKey = { ...CLAMP_KEY, occurrence };
      const other = seen.get(survivorId(key).slice(0, 6));
      if (other === undefined) seen.set(survivorId(key).slice(0, 6), key);
      else pair = [other, key];
    }
    const dir = tempDir();
    put(dir, REPORT, reportWith(...pair));
    const { code, err } = await cli(["explain", survivorId(pair[0]).slice(0, 6), ...said], dir);
    expect(code).toBe(2);
    expect(err).toContain("names more than one survivor");
    expect(
      await cli(["explain", survivorId(pair[0]), ...said], dir).then((result) => result.code),
    ).toBe(0);
  });

  it("refuses, and says why, when the ledger cannot be written", async () => {
    const dir = tempDir();
    put(dir, "web-tops.yaml", "gates:\n  mutation:\n    ledger: state/survivors.yaml\n");
    put(dir, "state", "a file where the ledger's directory should be");
    put(dir, REPORT, reportWith(CLAMP_KEY));
    const { code, err } = await cli(["explain", survivorId(CLAMP_KEY), ...said], dir);
    expect(code).toBe(2);
    expect(err).toContain("could not write");
    expect(readFileSync(join(dir, "state"), "utf8")).toBe(
      "a file where the ledger's directory should be",
    );
  });

  it("refuses when there is no report to name a survivor from", async () => {
    const dir = tempDir();
    const { code, err } = await cli(["explain", id, ...said], dir);
    expect(code).toBe(2);
    expect(err).toContain("run webtops gate first");
  });

  it("refuses an invalid ledger without touching it", async () => {
    const dir = project();
    put(dir, LEDGER, ledgerYaml(entryYaml(CLAMP_KEY, ["owner: o"])));
    const before = digest(dir);
    const { code, err } = await cli(["explain", id, ...said], dir);
    expect(code).toBe(2);
    expect(err).toContain("reason is missing");
    expect(digest(dir)).toBe(before);
  });
});

describe("webtops survivors expire", () => {
  it("exits 1 and names an expired entry, whether or not its survivor still exists", async () => {
    const dir = project();
    const { code, out } = await cli(["expire"], dir);
    expect(code).toBe(1);
    expect(out).toContain("1 expired, 0 expiring within 14 days");
    expect(out).toContain("expired 2026-11-16");
  });

  it("exits 0 when nothing has expired, and says what is coming", async () => {
    const dir = tempDir();
    put(
      dir,
      LEDGER,
      ledgerYaml(entryYaml(CLAMP_KEY, ["reason: r", "owner: o", "expires: 2026-11-30"])),
    );
    const soon = await cli(["expire"], dir);
    expect(soon.code).toBe(0);
    expect(soon.out).toContain("0 expired, 1 expiring within 14 days");
    expect((await cli(["expire", "--within", "5"], dir)).out).toContain(
      "none expires within 5 days",
    );
    expect((await cli(["expire", "--within=13"], dir)).out).toContain("1 expiring within 13 days");
  });

  it("flips exactly at midnight UTC, in any machine zone", async () => {
    const dir = tempDir();
    put(
      dir,
      LEDGER,
      ledgerYaml(entryYaml(CLAMP_KEY, ["reason: r", "owner: o", "expires: 2026-11-17"])),
    );
    for (const zone of ["UTC", "Pacific/Kiritimati", "Pacific/Pago_Pago", "America/Los_Angeles"]) {
      const before = process.env["TZ"];
      process.env["TZ"] = zone;
      try {
        expect((await cli(["expire"], dir, new Date("2026-11-17T23:59:59Z"))).code, zone).toBe(0);
        expect((await cli(["expire"], dir, new Date("2026-11-18T00:00:00Z"))).code, zone).toBe(1);
      } finally {
        if (before === undefined) delete process.env["TZ"];
        else process.env["TZ"] = before;
      }
    }
  });

  it("prints JSON and changes nothing, even with an expired entry", async () => {
    const dir = project();
    const before = digest(dir);
    const { code, out } = await cli(["expire", "--json"], dir);
    expect(code).toBe(1);
    const expired = field(JSON.parse(out), "expired");
    expect(Array.isArray(expired) && expired).toHaveLength(1);
    expect(digest(dir)).toBe(before);
  });

  it("exits 2 for an invalid ledger, as list does", async () => {
    const dir = tempDir();
    put(dir, LEDGER, ledgerYaml(entryYaml(CLAMP_KEY, ["owner: o"])));
    const { code, err } = await cli(["expire"], dir);
    expect(code).toBe(2);
    expect(err).toContain("/survivors/0/reason");
  });

  it.each([
    [["expire", "--within", "soon"]],
    [["expire", "--within", "-3"]],
    [["expire", "extra"]],
    [["expire", "--wat"]],
  ])("refuses %j", async (argv) => {
    expect((await cli(argv, project())).code).toBe(2);
  });
});

describe("webtops survivors, as a command", () => {
  it("refuses a subcommand it does not have", async () => {
    const { code, err } = await cli(["prune"], tempDir());
    expect(code).toBe(2);
    expect(err).toContain('unknown subcommand "prune"');
  });

  it("refuses a web-tops.yaml that is not valid YAML, and a ledger path that is not text", async () => {
    const bad = tempDir();
    put(bad, "web-tops.yaml", "gates: [");
    expect((await cli(["list"], bad)).err).toContain("not valid YAML");
    const odd = tempDir();
    put(odd, "web-tops.yaml", "gates:\n  mutation:\n    ledger: 5\n");
    expect((await cli(["list"], odd)).err).toContain("/gates/mutation/ledger");
  });

  it("keys survivors by all six fields, so two that differ in one are two ids", () => {
    const keys = [CLAMP_KEY, { ...CLAMP_KEY, occurrence: 2 }, { ...CLAMP_KEY, replacement: "x" }];
    expect(new Set(keys.map(keyString)).size).toBe(3);
    expect(new Set(keys.map(survivorId)).size).toBe(3);
  });
});

function field(from: unknown, key: string): unknown {
  return typeof from === "object" && from !== null ? Reflect.get(from, key) : undefined;
}
