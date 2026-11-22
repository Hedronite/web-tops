import { describe, expect, it } from "vitest";
import { createStore } from "./notes.ts";
import { route } from "./routes.ts";

const call = (method: string, path: string, body = "") => ({ method, path, body });

describe("route", () => {
  it("answers the health check", () => {
    expect(route(createStore(), call("GET", "/health"))).toEqual({
      status: 200,
      body: { ok: true },
    });
  });

  it("creates a note, then lists it and shows it", () => {
    const store = createStore();
    const made = route(store, call("POST", "/notes", '{"text":"buy milk"}'));
    expect(made).toEqual({ status: 201, body: { id: 1, text: "buy milk" } });
    expect(route(store, call("GET", "/notes")).body).toEqual([{ id: 1, text: "buy milk" }]);
    expect(route(store, call("GET", "/notes/1"))).toEqual({
      status: 200,
      body: { id: 1, text: "buy milk" },
    });
  });

  it("refuses a note with no text as 400, and stores nothing", () => {
    const store = createStore();
    expect(route(store, call("POST", "/notes", "{}")).status).toBe(400);
    expect(store.list()).toEqual([]);
  });

  it("says 404 for a note that is not there", () => {
    expect(route(createStore(), call("GET", "/notes/7"))).toEqual({
      status: 404,
      body: { error: "no such note" },
    });
  });

  it.each([
    ["GET", "/nowhere"],
    ["DELETE", "/notes"],
    ["POST", "/health"],
  ])("says 404 for %s %s", (method, path) => {
    expect(route(createStore(), call(method, path)).status).toBe(404);
  });
});
