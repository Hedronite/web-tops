import { describe, expect, it } from "vitest";
import { githubApi } from "./github.ts";

describe("the GitHub API over a token", () => {
  it("is a GET with the token, the JSON accept and the version header, answering status and body", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const api = githubApi("tok", (url, init) => {
      seen.push({ url, headers: init.headers });
      return Promise.resolve(new Response(JSON.stringify({ role_name: "admin" }), { status: 200 }));
    });
    expect(await api("repos/o/r/collaborators/x/permission")).toEqual({
      status: 200,
      body: { role_name: "admin" },
    });
    expect(seen).toEqual([
      {
        url: "https://api.github.com/repos/o/r/collaborators/x/permission",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer tok",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    ]);
  });

  it("answers the status with no body when the answer is not JSON, and status 0 when the call fails", async () => {
    const text = githubApi("tok", () => Promise.resolve(new Response("nope", { status: 502 })));
    expect(await text("x")).toEqual({ status: 502, body: undefined });
    const down = githubApi("tok", () => Promise.reject(new Error("offline")));
    expect(await down("x")).toEqual({ status: 0, body: undefined });
  });
});
