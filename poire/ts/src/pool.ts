/**
 * TS-07 floating promises, TS-20 unbounded concurrency, TS-24 sequential
 * waterfall.
 *
 * Runs async work with a fixed number in flight. Independent calls overlap;
 * the count never exceeds the limit; every call started has settled before the
 * returned promise does.
 */

/**
 * Calls `fn` for every item with at most `limit` calls in flight, and returns
 * the results in input order.
 *
 * On the first rejection, or when `signal` aborts, no further call starts; the
 * running ones are given an aborted signal and awaited; then the returned
 * promise rejects with that reason.
 */
export async function mapLimit<T, U>(
  items: Iterable<T>,
  limit: number,
  fn: (item: T, signal: AbortSignal) => Promise<U>,
  signal: AbortSignal = new AbortController().signal,
): Promise<U[]> {
  const stop = new AbortController();
  const live = AbortSignal.any([signal, stop.signal]);
  const queue = Array.from(items).entries();
  const results: U[] = [];

  const worker = async (): Promise<void> => {
    live.throwIfAborted();
    const next = queue.next();
    if (next.done === true) {
      return;
    }
    const [index, item] = next.value;
    results[index] = await fn(item, live);
    return worker();
  };

  const workers = Array.from({ length: Math.max(1, Math.floor(limit)) }, worker);
  try {
    await Promise.all(workers);
  } catch (error: unknown) {
    stop.abort(error);
    await Promise.allSettled(workers);
    throw error;
  }
  return results;
}
