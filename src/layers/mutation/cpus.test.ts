import { availableParallelism } from "node:os";
import { describe, expect, it } from "vitest";
import { cgroupCpus, usableWorkers, workers } from "./cpus.ts";

/** R78: Stryker's worker count follows the CPUs the process can use, not the ones the host has. */

const V2 = "/sys/fs/cgroup/cpu.max";
const V1_QUOTA = "/sys/fs/cgroup/cpu/cpu.cfs_quota_us";
const V1_PERIOD = "/sys/fs/cgroup/cpu/cpu.cfs_period_us";

const files =
  (found: Record<string, string>) =>
  (path: string): string | undefined =>
    found[path];

describe("R78 cgroupCpus reads the CPU limit of a control group, in CPUs", () => {
  it.each([
    ["200000 100000\n", 2],
    ["100000 100000", 1],
    ["50000 100000", 1],
    ["150000 100000", 2],
    ["400000 100000", 4],
  ])("v2 cpu.max %j is %d CPUs", (text, cpus) => {
    expect(cgroupCpus(files({ [V2]: text }))).toBe(cpus);
  });

  it.each(["max 100000\n", "max", "", "x y", "0 100000", "100000 0", "-1 100000"])(
    "v2 cpu.max %j sets no limit",
    (text) => {
      expect(cgroupCpus(files({ [V2]: text }))).toBeUndefined();
    },
  );

  it("reads cgroup v1 when there is no v2 file: a quota and a period", () => {
    expect(cgroupCpus(files({ [V1_QUOTA]: "300000\n", [V1_PERIOD]: "100000\n" }))).toBe(3);
    expect(cgroupCpus(files({ [V1_QUOTA]: "-1\n", [V1_PERIOD]: "100000\n" }))).toBeUndefined();
    expect(cgroupCpus(files({ [V1_QUOTA]: "100000" }))).toBeUndefined();
  });

  it("prefers v2, and says none when no file is there", () => {
    const both = files({ [V2]: "100000 100000", [V1_QUOTA]: "400000", [V1_PERIOD]: "100000" });
    expect(cgroupCpus(both)).toBe(1);
    expect(cgroupCpus(files({}))).toBeUndefined();
  });

  it("falls back to v1 when v2 says no limit and v1 has one", () => {
    const mixed = files({ [V2]: "max 100000", [V1_QUOTA]: "200000", [V1_PERIOD]: "100000" });
    expect(cgroupCpus(mixed)).toBe(2);
  });
});

describe("R78 workers: the CPUs it can use, minus one, and at least one", () => {
  it.each([
    [10, undefined, 9],
    [10, 1, 1],
    [10, 2, 1],
    [4, 2, 1],
    [4, 8, 3],
    [4, undefined, 3],
    [2, undefined, 1],
    [1, undefined, 1],
    [1, 1, 1],
  ])("%d available, limit %s, gives %d workers", (available, limit, expected) => {
    expect(workers(available, limit)).toBe(expected);
  });

  it("usableWorkers takes the control group's limit over the host's CPUs", () => {
    expect(usableWorkers(files({ [V2]: "100000 100000" }), 10)).toBe(1);
    expect(usableWorkers(files({ [V2]: "300000 100000" }), 10)).toBe(2);
    expect(usableWorkers(files({ [V2]: "max 100000" }), 10)).toBe(9);
    expect(usableWorkers(files({}), 4)).toBe(3);
  });

  it("usableWorkers is a whole number from 1 up to the host's CPUs", () => {
    const found = usableWorkers();
    expect(Number.isInteger(found)).toBe(true);
    expect(found).toBeGreaterThanOrEqual(1);
    expect(found).toBeLessThanOrEqual(Math.max(1, availableParallelism()));
  });
});
