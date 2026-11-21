import { describe, expect, it } from "vitest";
import { parseNewNote } from "./input.ts";

describe("parseNewNote", () => {
  it("takes the trimmed text of a JSON object", () => {
    expect(parseNewNote('{"text":"  buy milk "}')).toEqual({ ok: true, text: "buy milk" });
  });

  it.each(["", "not json", "null", "[1]", "3"])("refuses the body %j as no object", (body) => {
    expect(parseNewNote(body)).toMatchObject({ ok: false });
  });

  it.each(['{"text":""}', '{"text":"   "}', '{"text":3}', "{}"])(
    "refuses %s for want of text",
    (body) => {
      expect(parseNewNote(body)).toEqual({ ok: false, error: "text must be a non-empty string" });
    },
  );
});
