import { describe, expect, it } from "vitest";
import config from "../web-tops.yaml?raw";
import { routeFor, routes } from "./routes.ts";

describe("routes", () => {
  it("lists the two routes web-tops.yaml declares", () => {
    expect(routes().map((route) => [route.path, route.title])).toEqual([
      ["/", "Example app"],
      ["/about/", "About the example app"],
    ]);
  });

  // The static server answers any other path with the app's shell and status 200, so for a route that is not there
  // the gate would measure and check the shell instead of failing. Only real routes are declared.
  it("declares to the gate exactly the paths the app has", () => {
    const declared: unknown = JSON.parse(/^routes: (\[.*\])$/mu.exec(config)?.[1] ?? "[]");
    expect(declared).toEqual(routes().map((route) => route.path));
  });

  it.each([
    ["/", "/"],
    ["/about", "/about/"],
    ["/about/", "/about/"],
    ["/nowhere", undefined],
  ])("finds the route for %s", (pathname, expected) => {
    expect(routeFor(pathname)?.path).toBe(expected);
  });

  it("loads each route's view, which has one heading", async () => {
    for (const route of routes()) {
      const view = await route.view();
      expect(view.default().match(/<h1>/gu), route.path).toHaveLength(1);
    }
  });
});
