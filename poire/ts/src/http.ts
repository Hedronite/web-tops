/**
 * TS-01 laundering at the boundary, TS-02 inherited `any`, TS-06 untyped
 * errors, TS-08 missing cancellation, TS-21 unbounded input.
 *
 * A JSON fetch that is bounded in time and in bytes, cancellable by its caller,
 * and that returns a schema-checked value or a typed failure. `fetch` is passed
 * in, so tests need no network.
 */
import type { z } from "zod";
import { err, ok, type Result } from "./result.ts";

/** Why a fetch produced no value. */
export type FetchError =
  | { readonly kind: "status"; readonly status: number }
  | { readonly kind: "too-large"; readonly maxBytes: number }
  | { readonly kind: "invalid"; readonly issues: readonly string[] }
  | { readonly kind: "timeout"; readonly afterMs: number }
  | { readonly kind: "aborted" }
  | { readonly kind: "network"; readonly cause: unknown };

/** How to fetch. */
export interface FetchOptions {
  readonly fetch: typeof fetch;
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly signal?: AbortSignal;
}

/**
 * Fetches `url` and parses its JSON body with `schema`.
 *
 * The request ends when the caller's signal aborts or `timeoutMs` passes,
 * whichever comes first, and the body is read only up to `maxBytes`.
 */
export async function fetchJson<T>(
  url: string,
  schema: z.ZodType<T>,
  options: FetchOptions,
): Promise<Result<T, FetchError>> {
  const deadline = new AbortController();
  const timer = setTimeout(() => {
    deadline.abort();
  }, options.timeoutMs);
  const signal = AbortSignal.any([deadline.signal, options.signal ?? new AbortController().signal]);
  try {
    const response = await options.fetch(url, { signal });
    return await decode(response, schema, options.maxBytes);
  } catch (error: unknown) {
    return err(classify(error, deadline.signal, options.timeoutMs));
  } finally {
    clearTimeout(timer);
  }
}

async function decode<T>(
  response: Response,
  schema: z.ZodType<T>,
  maxBytes: number,
): Promise<Result<T, FetchError>> {
  if (!response.ok) {
    return err({ kind: "status", status: response.status });
  }
  const text = await readLimited(response.body, maxBytes);
  if (text === undefined) {
    return err({ kind: "too-large", maxBytes });
  }
  const json = parseJson(text);
  return json.ok ? check(json.value, schema) : json;
}

function parseJson(text: string): Result<unknown, FetchError> {
  try {
    const value: unknown = JSON.parse(text);
    return ok(value);
  } catch {
    return err({ kind: "invalid", issues: ["the body is not JSON"] });
  }
}

function check<T>(raw: unknown, schema: z.ZodType<T>): Result<T, FetchError> {
  const parsed = schema.safeParse(raw);
  return parsed.success
    ? ok(parsed.data)
    : err({ kind: "invalid", issues: parsed.error.issues.map((issue) => issue.message) });
}

/**
 * Reads a byte stream as UTF-8 text, or returns undefined once it passes `maxBytes`; reading
 * stops there. Chunks are taken as `unknown` and checked: Node's fetch types declare
 * `Response.body` as `ReadableStream` with no element type, which makes every chunk `any`.
 */
export async function readLimited(
  body: AsyncIterable<unknown> | Iterable<unknown> | null,
  maxBytes: number,
): Promise<string | undefined> {
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let size = 0;
  for await (const chunk of body ?? []) {
    const bytes = asBytes(chunk);
    size += bytes.byteLength;
    if (size > maxBytes) {
      return undefined;
    }
    parts.push(decoder.decode(bytes, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join("");
}

function asBytes(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) {
    return chunk;
  }
  throw new TypeError("a body chunk is not bytes");
}

function classify(error: unknown, deadline: AbortSignal, timeoutMs: number): FetchError {
  if (deadline.aborted) {
    return { kind: "timeout", afterMs: timeoutMs };
  }
  return error instanceof DOMException && error.name === "AbortError"
    ? { kind: "aborted" }
    : { kind: "network", cause: error };
}
