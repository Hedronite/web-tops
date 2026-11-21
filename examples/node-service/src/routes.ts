import { parseNewNote } from "./input.ts";
import type { NoteStore } from "./notes.ts";

export interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: string;
}

export interface Reply {
  readonly status: number;
  readonly body: unknown;
}

interface Route {
  readonly method: string;
  readonly pattern: RegExp;
  readonly run: (store: NoteStore, call: Call, id: number) => Reply;
}

const reply = (status: number, body: unknown): Reply => ({ status, body });

function create(store: NoteStore, call: Call): Reply {
  const parsed = parseNewNote(call.body);
  return parsed.ok ? reply(201, store.add(parsed.text)) : reply(400, { error: parsed.error });
}

function show(store: NoteStore, _call: Call, id: number): Reply {
  const note = store.get(id);
  return note === undefined ? reply(404, { error: "no such note" }) : reply(200, note);
}

const ROUTES: readonly Route[] = [
  { method: "GET", pattern: /^\/health$/u, run: () => reply(200, { ok: true }) },
  { method: "GET", pattern: /^\/notes$/u, run: (store) => reply(200, store.list()) },
  { method: "POST", pattern: /^\/notes$/u, run: create },
  { method: "GET", pattern: /^\/notes\/(\d+)$/u, run: show },
];

/** The reply to one call: the first route that matches both the method and the path, else 404. */
export function route(store: NoteStore, call: Call): Reply {
  for (const entry of ROUTES) {
    const match = entry.pattern.exec(call.path);
    if (match !== null && entry.method === call.method) {
      return entry.run(store, call, Number(match[1]));
    }
  }
  return reply(404, { error: "not found" });
}
