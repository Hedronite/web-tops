import { availableParallelism } from "node:os";
import { readOutput } from "../hygiene/tooling.ts";

/** cgroup v2 `cpu.max` is `<quota|max> <period>`; v1 keeps the quota and the period in two files (`-1` for none). */
const V2 = "/sys/fs/cgroup/cpu.max";
const V1_QUOTA = "/sys/fs/cgroup/cpu/cpu.cfs_quota_us";
const V1_PERIOD = "/sys/fs/cgroup/cpu/cpu.cfs_period_us";

/** A quota over a period as whole CPUs, at least 1; undefined for `max`, `-1`, zero or text that is not a number. */
function cpusOf(quota: string | undefined, period: string | undefined): number | undefined {
  const [q, p] = [Number(quota), Number(period)];
  return q > 0 && p > 0 ? Math.max(1, Math.ceil(q / p)) : undefined;
}

/** The whitespace-separated fields of a file, none when it cannot be read. */
const fieldsOf = (read: (path: string) => string | undefined, path: string): string[] =>
  read(path)?.trim().split(/\s+/u) ?? [];

/**
 * The CPU limit of the process's control group, in CPUs, or undefined when none is set. A container with a quota of
 * one CPU on a host of ten still reports ten from `os.cpus()`, and a worker for each of them starves the run.
 */
export function cgroupCpus(read: (path: string) => string | undefined): number | undefined {
  const [quota, period] = fieldsOf(read, V2);
  const [v1Quota] = fieldsOf(read, V1_QUOTA);
  const [v1Period] = fieldsOf(read, V1_PERIOD);
  return cpusOf(quota, period) ?? cpusOf(v1Quota, v1Period);
}

/** The CPUs the process can use, less one for the coordinating process, and at least one worker. */
export function workers(available: number, limit: number | undefined): number {
  return Math.max(1, Math.min(available, limit ?? available) - 1);
}

/** Stryker's worker count for this machine: what `os.availableParallelism()` and the control group's limit allow. */
export function usableWorkers(
  read: (path: string) => string | undefined = readOutput,
  available: number = availableParallelism(),
): number {
  return workers(available, cgroupCpus(read));
}
