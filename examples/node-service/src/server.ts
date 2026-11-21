import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { NoteStore } from "./notes.ts";
import { route } from "./routes.ts";

async function bodyOf(request: IncomingMessage): Promise<string> {
  const parts: string[] = [];
  request.setEncoding("utf8");
  for await (const part of request) {
    parts.push(String(part));
  }
  return parts.join("");
}

async function respond(
  store: NoteStore,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const reply = route(store, {
    method: request.method ?? "GET",
    path: url.pathname,
    body: await bodyOf(request),
  });
  response.writeHead(reply.status, { "content-type": "application/json" });
  response.end(JSON.stringify(reply.body));
}

/** The HTTP server over a store. A failure while answering is a 500 that says nothing of its cause. */
export function createService(store: NoteStore): Server {
  return createServer((request, response) => {
    respond(store, request, response).catch(() => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "internal error" }));
    });
  });
}
