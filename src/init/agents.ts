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

const hasNoMarkers = (existing: string): boolean =>
  !existing.includes(BEGIN_MARKER) && !existing.includes(END_MARKER);

/** The text after existing AGENTS.md content that has no markers: one blank line between them. */
function appendTo(existing: string, rendered: string): string {
  if (existing === "") return rendered;
  return existing + (existing.endsWith("\n") ? "\n" : "\n\n") + rendered;
}

/** Why the markers cannot be trusted as one begin/end pair, or undefined when they are one pair. */
function pairProblem(existing: string): string | undefined {
  const begins = occurrences(existing, BEGIN_MARKER);
  const ends = occurrences(existing, END_MARKER);
  if (begins === 1 && ends === 1 && existing.indexOf(END_MARKER) > existing.indexOf(BEGIN_MARKER)) {
    return undefined;
  }
  return (
    `AGENTS.md has ${String(begins)} begin and ${String(ends)} end markers, or they are out of order ` +
    "(markers inside fenced code blocks count too, so a file that quotes them cannot be inited)"
  );
}

function classify(held: string, inner: string): Previous {
  if (held === inner) return "same";
  return held.trim() === "" ? "empty" : "different";
}

function replaceBlock(existing: string, rendered: string): AgentsMerge {
  const start = existing.indexOf(BEGIN_MARKER) + BEGIN_MARKER.length;
  const stop = existing.indexOf(END_MARKER);
  const inner = rendered.slice(
    rendered.indexOf(BEGIN_MARKER) + BEGIN_MARKER.length,
    rendered.indexOf(END_MARKER),
  );
  return {
    kind: "replace",
    text: existing.slice(0, start) + inner + existing.slice(stop),
    previous: classify(existing.slice(start, stop), inner),
  };
}

/**
 * Puts the rendered Web-TOPS section into AGENTS.md. Only the text between the markers is replaced;
 * every byte outside them is kept. A file with no markers gets the block appended; unbalanced or
 * repeated markers are refused, because guessing which pair is ours could destroy text. Markers
 * quoted inside a fenced code block count like any others: the refusal says so.
 */
export function mergeAgentsSection(existing: string | undefined, rendered: string): AgentsMerge {
  if (existing === undefined) return { kind: "create", text: rendered };
  if (hasNoMarkers(existing)) return { kind: "append", text: appendTo(existing, rendered) };
  const reason = pairProblem(existing);
  if (reason !== undefined) return { kind: "malformed", reason };
  return replaceBlock(existing, rendered);
}
