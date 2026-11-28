/** A value, or the reason there is none. Callers branch on `ok`; nothing is thrown. */
export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** A success. */
export function ok<const T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** A failure. */
export function err<const E>(error: E): Result<never, E> {
  return { ok: false, error };
}
