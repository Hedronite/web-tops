import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStore } from "./notes.ts";
import { createService } from "./server.ts";

const service = createService(createStore());
let base = "";

beforeAll(async () => {
  await new Promise<void>((done) => service.listen(0, "127.0.0.1", done));
  const address = service.address();
  if (address === null || typeof address === "string") {
    throw new Error("the service did not listen on a port");
  }
  base = `http://127.0.0.1:${String(address.port)}`;
});

afterAll(async () => {
  await new Promise<void>((done) =>
    service.close(() => {
      done();
    }),
  );
});

describe("createService", () => {
  it("says 500 and nothing of the cause when answering fails", async () => {
    const broken = createService({
      add: () => ({ id: 0, text: "" }),
      get: () => undefined,
      list: () => {
        throw new Error("the store is down");
      },
    });
    await new Promise<void>((done) => broken.listen(0, "127.0.0.1", done));
    const address = broken.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    const answer = await fetch(`http://127.0.0.1:${String(address.port)}/notes`);
    expect(answer.status).toBe(500);
    expect(await answer.text()).toBe('{"error":"internal error"}');
    await new Promise<void>((done) =>
      broken.close(() => {
        done();
      }),
    );
  });

  it("answers over HTTP: a note posted is a note read", async () => {
    const posted = await fetch(`${base}/notes`, { method: "POST", body: '{"text":"over http"}' });
    expect(posted.status).toBe(201);
    const read = await fetch(`${base}/notes/1`);
    expect(await read.json()).toEqual({ id: 1, text: "over http" });
  });

  it("says 404 as JSON for a path it does not serve", async () => {
    const missing = await fetch(`${base}/nowhere`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toBe("application/json");
  });
});
