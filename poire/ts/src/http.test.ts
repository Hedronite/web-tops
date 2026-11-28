import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { fetchJson, readLimited, type FetchOptions } from "./http.ts";

const Rate = z.object({ micro: z.int().positive() });

function respond(body: string | null, status = 200): typeof fetch {
  return () => Promise.resolve(new Response(body, { status }));
}

function options(fetchImpl: typeof fetch, signal?: AbortSignal): FetchOptions {
  const base = { fetch: fetchImpl, timeoutMs: 1000, maxBytes: 64 };
  return signal === undefined ? base : { ...base, signal };
}

/** A fetch that never answers, and rejects when its signal aborts, as the real one does. */
const hanging: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  });

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchJson", () => {
  it("returns the checked value and leaves no timer behind", async () => {
    vi.useFakeTimers();
    const result = await fetchJson("https://rates.test", Rate, options(respond(`{"micro":5}`)));
    expect(result).toEqual({ ok: true, value: { micro: 5 } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reads a body exactly at the limit, and refuses one byte more", async () => {
    const exact = `{"micro":1,"pad":"${"x".repeat(64 - 20)}"}`;
    expect(exact).toHaveLength(64);
    const atLimit = await fetchJson("u", Rate, options(respond(exact)));
    const over = await fetchJson("u", Rate, options(respond(`${exact} `)));
    expect(atLimit).toEqual({ ok: true, value: { micro: 1 } });
    expect(over).toEqual({ ok: false, error: { kind: "too-large", maxBytes: 64 } });
  });

  it("types every failure it can return", async () => {
    const cases: readonly [typeof fetch, unknown][] = [
      [respond("busy", 503), { kind: "status", status: 503 }],
      [respond("{"), { kind: "invalid", issues: ["the body is not JSON"] }],
      [respond(null), { kind: "invalid", issues: ["the body is not JSON"] }],
      [
        respond(`{"micro":0}`),
        { kind: "invalid", issues: ["Too small: expected number to be >0"] },
      ],
    ];
    for (const [fetchImpl, error] of cases) {
      expect(await fetchJson("u", Rate, options(fetchImpl))).toEqual({ ok: false, error });
    }
  });

  it("gives up at its own deadline", async () => {
    vi.useFakeTimers();
    const pending = fetchJson("u", Rate, options(hanging));
    await vi.advanceTimersByTimeAsync(999);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, error: { kind: "timeout", afterMs: 1000 } });
  });

  it("stops when its caller does", async () => {
    const caller = new AbortController();
    const pending = fetchJson("u", Rate, options(hanging, caller.signal));
    caller.abort();
    expect(await pending).toEqual({ ok: false, error: { kind: "aborted" } });
  });

  it("reports another DOMException as a network failure, not an abort", async () => {
    const cause = new DOMException("connection reset", "NetworkError");
    const result = await fetchJson(
      "u",
      Rate,
      options(() => Promise.reject(cause)),
    );
    expect(result).toEqual({ ok: false, error: { kind: "network", cause } });
  });

  it("keeps the cause of a network failure", async () => {
    const cause = new TypeError("fetch failed");
    const result = await fetchJson(
      "u",
      Rate,
      options(() => Promise.reject(cause)),
    );
    expect(result).toEqual({ ok: false, error: { kind: "network", cause } });
  });
});

describe("readLimited", () => {
  it("decodes a character split across chunks", async () => {
    const euro = new TextEncoder().encode("€");
    await expect(readLimited([euro.slice(0, 1), euro.slice(1)], 3)).resolves.toBe("€");
  });

  it("ends a stream cut inside a character with a replacement character", async () => {
    const euro = new TextEncoder().encode("€");
    await expect(readLimited([euro.slice(0, 1)], 3)).resolves.toBe("\uFFFD");
  });

  it("refuses a chunk that is not bytes", async () => {
    function* strings(): Generator<string> {
      yield "text, not bytes";
    }
    await expect(readLimited(strings(), 64)).rejects.toThrow("a body chunk is not bytes");
  });
});
