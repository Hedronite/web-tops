import { afterEach, describe, expect, it, vi } from "vitest";
import { mapLimit } from "./pool.ts";

afterEach(() => {
  vi.useRealTimers();
});

/** Waits ms of (fake) time, or rejects when signal aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("cancelled", { cause: signal.reason }));
    });
  });
}

/** Records how many calls run at once. */
function tracker() {
  const state = { running: 0, peak: 0, started: 0 };
  const run = async (n: number, signal: AbortSignal, ms = 1000): Promise<number> => {
    state.running += 1;
    state.started += 1;
    state.peak = Math.max(state.peak, state.running);
    try {
      await sleep(ms, signal);
      return n * 2;
    } finally {
      state.running -= 1;
    }
  };
  return { state, run };
}

describe("mapLimit", () => {
  it("overlaps independent calls up to the limit, and no further", async () => {
    vi.useFakeTimers();
    const { state, run } = tracker();
    let settled = false;
    const done = mapLimit([1, 2, 3, 4, 5, 6, 7], 3, (n, signal) => run(n, signal)).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await done).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(state.peak).toBe(3);
  });

  it("keeps input order when calls finish out of order", async () => {
    vi.useFakeTimers();
    const { run } = tracker();
    const done = mapLimit([3, 1, 2], 3, (n, signal) => run(n, signal, n * 100));
    await vi.advanceTimersByTimeAsync(300);
    expect(await done).toEqual([6, 2, 4]);
  });

  it("treats a limit below one as one, and rounds a fractional limit down", async () => {
    vi.useFakeTimers();
    const one = tracker();
    const two = tracker();
    const a = mapLimit([1, 2], 0, (n, signal) => one.run(n, signal));
    const b = mapLimit([1, 2, 3], 2.7, (n, signal) => two.run(n, signal));
    await vi.advanceTimersByTimeAsync(2000);
    expect([await a, await b]).toEqual([
      [2, 4],
      [2, 4, 6],
    ]);
    expect([one.state.peak, two.state.peak]).toEqual([1, 2]);
  });

  it("stops starting work at the first failure, and lets the running calls finish first", async () => {
    vi.useFakeTimers();
    const { state, run } = tracker();
    const boom = new Error("item 2 failed");
    const done = mapLimit([1, 2, 3, 4, 5], 2, async (n, signal) => {
      if (n === 2) {
        await sleep(10, signal);
        throw boom;
      }
      return run(n, signal);
    });
    const outcome = done.then(
      () => "resolved",
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(await outcome).toBe(boom);
    expect(state.started).toBe(1);
    expect(state.running).toBe(0);
  });

  it("starts nothing once its caller has aborted", async () => {
    const caller = new AbortController();
    caller.abort();
    const { state, run } = tracker();
    await expect(mapLimit([1, 2], 2, (n, signal) => run(n, signal), caller.signal)).rejects.toThrow(
      "aborted",
    );
    expect(state.started).toBe(0);
  });

  it("returns an empty list for no items", async () => {
    await expect(mapLimit([], 4, () => Promise.resolve(1))).resolves.toEqual([]);
  });
});
