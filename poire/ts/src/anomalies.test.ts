import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { byTenant, slowSamples, type RawSample } from "./anomalies.ts";

describe("slowSamples", () => {
  it("counts every row, even past the limit (the sketch's example stopped counting there)", () => {
    const rows: RawSample[] = [
      { tenant: "a", ms: 500 },
      { ms: 1 },
      { tenant: "b", ms: 900 },
      { ms: 2 },
      { ms: 3 },
    ];
    const result = slowSamples(rows, 100, 1);
    expect(result).toEqual({
      slow: [{ tenantId: "a", latencyMs: 500, errorCode: undefined }],
      invalid: 3,
      fast: 0,
      overLimit: 1,
    });
  });

  it("treats the threshold itself as slow, and an empty or missing tenant or a non-finite time as invalid", () => {
    const rows: RawSample[] = [
      { tenant: "a", ms: 100, err: "E1" },
      { tenant: "a", ms: 99 },
      { tenant: "", ms: 500 },
      { tenant: "a", ms: Number.POSITIVE_INFINITY },
      { tenant: "a", ms: Number.NaN },
    ];
    expect(slowSamples(rows, 100, 10)).toEqual({
      slow: [{ tenantId: "a", latencyMs: 100, errorCode: "E1" }],
      invalid: 3,
      fast: 1,
      overLimit: 0,
    });
  });

  it("accounts for every row, keeps input order, and never exceeds the limit", () => {
    const row = fc.record(
      {
        tenant: fc.constantFrom("a", "b", ""),
        ms: fc.oneof(fc.integer({ min: 0, max: 200 }), fc.constant(Number.NaN)),
        err: fc.constantFrom("E1", "E2"),
      },
      { requiredKeys: ["ms"] },
    );
    fc.assert(
      fc.property(
        fc.array(row),
        fc.integer({ min: 0, max: 200 }),
        fc.nat(5),
        (rows, threshold, limit) => {
          const result = slowSamples(rows, threshold, limit);
          expect(result.slow.length + result.invalid + result.fast + result.overLimit).toBe(
            rows.length,
          );
          expect(result.slow.length).toBeLessThanOrEqual(limit);
          const kept = rows.filter(
            (r) => (r.tenant ?? "") !== "" && Number.isFinite(r.ms) && r.ms >= threshold,
          );
          expect(result.slow.map((s) => s.latencyMs)).toEqual(
            kept.slice(0, limit).map((r) => r.ms),
          );
        },
      ),
    );
  });
});

describe("byTenant", () => {
  it("groups samples by tenant in arrival order", () => {
    const a1 = { tenantId: "a", latencyMs: 1, errorCode: undefined };
    const b1 = { tenantId: "b", latencyMs: 2, errorCode: undefined };
    const a2 = { tenantId: "a", latencyMs: 3, errorCode: "E1" };
    expect([...byTenant([a1, b1, a2])]).toEqual([
      ["a", [a1, a2]],
      ["b", [b1]],
    ]);
  });
});
