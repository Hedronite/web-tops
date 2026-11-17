export const BEGIN_MARKER = "<!-- web-tops:begin -->";
export const END_MARKER = "<!-- web-tops:end -->";

/** What the replaced block held: nothing (only whitespace), exactly what `init` writes, or other text. */
export type Previous = "empty" | "same" | "different";

/** What `init` would do to AGENTS.md. */
export type AgentsMerge =
  | { readonly kind: "create"; readonly text: string }
  | { readonly kind: "append"; readonly text: string }
  | { readonly kind: "replace"; readonly text: string; readonly previous: Previous }
  | { readonly kind: "malformed"; readonly reason: string };

const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;

/**
 * Puts the rendered Web-TOPS section into AGENTS.md. Only the text between the markers is replaced;
 * every byte outside them is kept. A file with no markers gets the block appended; unbalanced or
 * repeated markers are refused, because guessing which pair is ours could destroy text. Markers
 * quoted inside a fenced code block count like any others: the refusal says so.
 */
export function mergeAgentsSection(existing: string | undefined, rendered: string): AgentsMerge {
  if (existing === undefined) return { kind: "create", text: rendered };
  const begins = occurrences(existing, BEGIN_MARKER);
  const ends = occurrences(existing, END_MARKER);
  if (begins === 0 && ends === 0) {
    if (existing === "") return { kind: "append", text: rendered };
    const gap = existing.endsWith("\n") ? "\n" : "\n\n";
    return { kind: "append", text: existing + gap + rendered };
  }
  const start = existing.indexOf(BEGIN_MARKER);
  const stop = existing.indexOf(END_MARKER);
  if (begins !== 1 || ends !== 1 || stop < start) {
    return {
      kind: "malformed",
      reason:
        `AGENTS.md has ${String(begins)} begin and ${String(ends)} end markers, or they are out of order ` +
        "(markers inside fenced code blocks count too, so a file that quotes them cannot be inited)",
    };
  }
  const inner = rendered.slice(
    rendered.indexOf(BEGIN_MARKER) + BEGIN_MARKER.length,
    rendered.indexOf(END_MARKER),
  );
  const held = existing.slice(start + BEGIN_MARKER.length, stop);
  const previous: Previous = held === inner ? "same" : held.trim() === "" ? "empty" : "different";
  return {
    kind: "replace",
    text: existing.slice(0, start + BEGIN_MARKER.length) + inner + existing.slice(stop),
    previous,
  };
}
