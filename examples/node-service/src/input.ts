export type NewNote =
  { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string };

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

/** The text of a note from a request body: the body crosses the boundary as `unknown` and is checked, never asserted. */
export function parseNewNote(body: string): NewNote {
  const value = parseJson(body);
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "the body must be a JSON object" };
  }
  const text: unknown = Reflect.get(value, "text");
  return isText(text)
    ? { ok: true, text: text.trim() }
    : { ok: false, error: "text must be a non-empty string" };
}
