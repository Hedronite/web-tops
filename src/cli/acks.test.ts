import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { SeverityOf } from "../acks/severity.ts";
import { runAcksCli } from "./acks.ts";
import type { Io } from "./io.ts";

/** Soft laws W-01, W-02, W-28 and W-30, the hard law W-04, and no other id. */
const SEVERITY: SeverityOf = (law) =>
  new Map<string, "R" | "A">([
    ["W-01", "A"],
    ["W-02", "A"],
    ["W-28", "A"],
    ["W-30", "A"],
    ["W-04", "R"],
  ]).get(law);

const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function repo(files: Readonly<Record<string, string>>, track = true): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-acks-cli-"));
  made.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  if (track) {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["add", "-A"], { cwd: dir });
  }
  return dir;
}

function run(argv: readonly string[], cwd: string) {
  let out = "";
  let err = "";
  const io: Io = { out: (t) => (out += t), err: (t) => (err += t), cwd, env: {} };
  return runAcksCli(argv, io, () => SEVERITY).then((code) => ({ code, out, err }));
}

const LEDGER =
  "version: 1\nacks:\n  - law: W-30\n    file: src/about.astro\n    reason: No known size.\n    owner: web-platform\n";

describe("webtops acks", () => {
  it("lists the comments and the ledger entries, and exits 0 when each is well formed", async () => {
    const dir = repo({
      "src/a.ts": "// webtops-ack W-01: a reason\n",
      "src/b.ts": "// webtops-ack W-02: another reason\n",
      ".web-tops/acks.yaml": LEDGER,
    });
    expect(await run([], dir)).toEqual({
      code: 0,
      err: "",
      out: [
        "acks: 3 (2 comments, 1 ledger entries)",
        "  W-01  src/a.ts:1  comment  a reason",
        "  W-02  src/b.ts:1  comment  another reason",
        "  W-30  src/about.astro  ledger  No known size.",
        "",
      ].join("\n"),
    });
  });

  it("reads a file list far longer than a few hundred bytes", async () => {
    const files: Record<string, string> = {};
    for (let n = 0; n < 40; n += 1) files[`src/a-long-file-name-${String(n)}.ts`] = "export {};\n";
    files["src/last.ts"] = "// webtops-ack W-01: found at the end\n";
    const { code, out } = await run([], repo(files));
    expect(code).toBe(0);
    expect(out).toContain("W-01  src/last.ts:1  comment  found at the end");
  });

  it("lists the problems after them, and exits 1", async () => {
    const dir = repo({ "src/a.ts": "// webtops-ack W-01:\n" });
    const { code, out } = await run([], dir);
    expect(code).toBe(1);
    expect(out).toBe(
      [
        "acks: 0 (0 comments, 0 ledger entries)",
        "problems:",
        "  src/a.ts:1  ack-no-reason  the acknowledgement of W-01 gives no reason: write webtops-ack W-01: <why>",
        "",
      ].join("\n"),
    );
  });

  it("prints the same as JSON with --json, and exits as the text does", async () => {
    const dir = repo({ "src/a.ts": "// webtops-ack W-01: a reason\n" });
    const { code, out } = await run(["--json"], dir);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({
      acks: [{ source: "comment", law: "W-01", file: "src/a.ts", line: 1, reason: "a reason" }],
      problems: [],
    });
  });

  it("reads the ledger the config names", async () => {
    const dir = repo({
      "web-tops.yaml": "laws:\n  ack_ledger: custom/acks.yaml\n",
      "custom/acks.yaml": LEDGER,
    });
    expect((await run([], dir)).out).toContain("W-30  src/about.astro  ledger");
  });

  it("falls back to the default ledger when the config names none, or is not a document", async () => {
    const dir = repo({ "web-tops.yaml": "class: ts-library\n", ".web-tops/acks.yaml": LEDGER });
    expect((await run([], dir)).out).toContain("ledger");
  });

  it.each([["--bogus"], ["--json", "--json"], ["x"]])(
    "exits 2 for the arguments %j, with the usage",
    async (...argv) => {
      const { code, err, out } = await run(argv.flat(), repo({}));
      expect([code, out]).toEqual([2, ""]);
      expect(err).toBe("webtops acks: bad arguments\nusage: webtops acks [--json]\n");
    },
  );

  it("exits 2 outside a git repository, saying why", async () => {
    const { code, err } = await run([], repo({ "src/a.ts": "" }, false));
    expect(code).toBe(2);
    expect(err).toBe("webtops acks: cannot list the tracked files: this is not a git repository\n");
  });
});

describe("webtops acks: a hard law or an unknown id is a problem", () => {
  it("exits 1 and lists, with its rule, a comment of a hard law and a ledger entry of an unknown id", async () => {
    const dir = repo({
      "src/a.ts": "// webtops-ack W-04: a reason\n",
      ".web-tops/acks.yaml":
        "version: 1\nacks:\n  - law: W-99\n    file: src/b.ts\n    reason: No such law.\n    owner: web-platform\n",
    });
    const result = await run([], dir);
    expect(result.code).toBe(1);
    expect(result.out).toContain("acks: 0 (0 comments, 0 ledger entries)");
    expect(result.out).toContain("src/a.ts:1  ack-not-needed  W-04 is a hard law");
    expect(result.out).toContain(
      ".web-tops/acks.yaml  ack-unknown-law  src/b.ts: W-99 is not a law",
    );
  });
});

describe("webtops acks says when a ledger entry runs out", () => {
  const withExpiry = (date: string): string => `${LEDGER}    expires: ${date}\n`;
  const on = (dir: string, today: string) => {
    let out = "";
    const io: Io = { out: (t) => (out += t), err: () => undefined, cwd: dir, env: {} };
    return runAcksCli([], io, () => SEVERITY, today).then((code) => ({ code, out }));
  };

  it("prints `expires` and the day while the entry is valid, through that day", async () => {
    const dir = repo({ ".web-tops/acks.yaml": withExpiry("2026-11-20") });
    for (const today of ["2026-11-19", "2026-11-20"]) {
      const { code, out } = await on(dir, today);
      expect(code).toBe(0);
      expect(out).toContain(
        "  W-30  src/about.astro  ledger  No known size.  expires 2026-11-20\n",
      );
    }
  });

  it("prints `expired` from the day after it, and still lists the entry", async () => {
    const dir = repo({ ".web-tops/acks.yaml": withExpiry("2026-11-20") });
    const { code, out } = await on(dir, "2026-11-21");
    expect(code).toBe(0);
    expect(out).toContain("  W-30  src/about.astro  ledger  No known size.  expired\n");
    expect(out).toContain("acks: 1 (0 comments, 1 ledger entries)");
  });

  it("prints nothing of expiry for an entry with none, and for a comment", async () => {
    const dir = repo({
      ".web-tops/acks.yaml": LEDGER,
      "src/a.ts": "// webtops-ack W-01: a reason\n",
    });
    const { out } = await on(dir, "2999-01-01");
    expect(out).toContain("  W-30  src/about.astro  ledger  No known size.\n");
    expect(out).toContain("  W-01  src/a.ts:1  comment  a reason\n");
  });
});
