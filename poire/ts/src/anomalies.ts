/**
 * TS-22 quadratic accumulation, TS-25 unstable object shapes, TS-26 lost
 * counts in a pipeline. This replaces the sketch's example, whose drop
 * count was kept by a side effect in a lazy filter and stopped counting at the
 * limit.
 */

/** A row as it arrives. */
export interface RawSample {
  readonly tenant?: string;
  readonly ms: number;
  readonly err?: string;
}

/** A checked row. Every field is always present, so every sample has one shape. */
export interface Sample {
  readonly tenantId: string;
  readonly latencyMs: number;
  readonly errorCode: string | undefined;
}

/** The slow samples, and what happened to every other row. */
export interface Anomalies {
  readonly slow: readonly Sample[];
  readonly invalid: number;
  readonly fast: number;
  readonly overLimit: number;
}

/**
 * One pass over every row. The counts cover the whole input: `limit` caps how
 * many slow samples are kept, and the slow rows past it are counted in
 * `overLimit`, not silently dropped.
 */
export function slowSamples(
  rows: Iterable<RawSample>,
  thresholdMs: number,
  limit: number,
): Anomalies {
  const slow: Sample[] = [];
  const counts = { invalid: 0, fast: 0, overLimit: 0 };
  for (const row of rows) {
    const verdict = classify(row, thresholdMs);
    if (typeof verdict === "string") {
      counts[verdict] += 1;
    } else if (slow.length < limit) {
      slow.push(verdict);
    } else {
      counts.overLimit += 1;
    }
  }
  return { slow, ...counts };
}

function classify(row: RawSample, thresholdMs: number): Sample | "invalid" | "fast" {
  const tenant = tenantOf(row);
  if (tenant === undefined) {
    return "invalid";
  }
  return row.ms < thresholdMs
    ? "fast"
    : { tenantId: tenant, latencyMs: row.ms, errorCode: row.err };
}

/** The tenant of a row that can be judged: one with a tenant and a finite time. */
function tenantOf(row: RawSample): string | undefined {
  const tenant = row.tenant ?? "";
  return tenant === "" || !Number.isFinite(row.ms) ? undefined : tenant;
}

/** Indexes samples by tenant, building one map in place: linear, not one copy per row. */
export function byTenant(samples: readonly Sample[]): ReadonlyMap<string, readonly Sample[]> {
  const index = new Map<string, Sample[]>();
  for (const sample of samples) {
    const list = index.get(sample.tenantId);
    if (list === undefined) {
      index.set(sample.tenantId, [sample]);
    } else {
      list.push(sample);
    }
  }
  return index;
}
