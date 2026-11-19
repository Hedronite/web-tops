import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hostVersion } from "./environment.ts";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

afterEach(() => {
  vi.mocked(spawnSync).mockReset();
});

/** What the spawn gives back: the fields hostVersion reads, as the host would set them. */
function spawned(fields: { error?: Error; status: number | null; stdout: string }): void {
  vi.mocked(spawnSync).mockReturnValue({
    pid: 1,
    output: [null, fields.stdout, ""],
    stderr: "",
    signal: null,
    ...fields,
  });
}

describe("hostVersion: the host is faked, so no machine decides the result", () => {
  it("asks the program for --version, in the given environment, as text", () => {
    spawned({ status: 0, stdout: "node 1.2.3\n" });
    hostVersion("tool", { PATH: "/x" });
    expect(spawnSync).toHaveBeenCalledWith("tool", ["--version"], {
      encoding: "utf8",
      env: { PATH: "/x" },
    });
  });

  it.each([
    ["a plain version", "1.4.4\n", "1.4.4"],
    ["a v-prefixed version", "v24.22.3\n", "24.22.3"],
    ["a version after a name", "Bun 1.4.4 (linux)\n", "1.4.4"],
    ["the first of several", "1.2.3 and 4.5.6\n", "1.2.3"],
  ])("reads %s", (_, stdout, version) => {
    spawned({ status: 0, stdout });
    expect(hostVersion("tool", {})).toBe(version);
  });

  it("has no version when the output has no dotted number", () => {
    spawned({ status: 0, stdout: "" });
    expect(hostVersion("tool", {})).toBeUndefined();
    spawned({ status: 0, stdout: "usage: tool\n" });
    expect(hostVersion("tool", {})).toBeUndefined();
  });

  it("has no version when the program exits non-zero, whatever it printed", () => {
    spawned({ status: 3, stdout: "1.2.3\n" });
    expect(hostVersion("tool", {})).toBeUndefined();
  });

  it("has no version when it was killed by a signal", () => {
    spawned({ status: null, stdout: "1.2.3\n" });
    expect(hostVersion("tool", {})).toBeUndefined();
  });

  it("has no version when the spawn reports an error, whatever the status says", () => {
    spawned({ error: new Error("spawn tool ENOENT"), status: 0, stdout: "1.2.3\n" });
    expect(hostVersion("tool", {})).toBeUndefined();
    spawned({ error: new Error("spawn tool ENOENT"), status: null, stdout: "" });
    expect(hostVersion("tool", {})).toBeUndefined();
  });
});
