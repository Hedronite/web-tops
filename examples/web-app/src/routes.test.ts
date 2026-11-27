import { describe, expect, it } from "vitest";
import { routeFor, routes } from "./routes.ts";

describe("routes", () => {
  it("lists the two routes web-tops.yaml declares", () => {
    expect(routes().map((route) => [route.path, route.title])).toEqual([
      ["/", "Example app"],
      ["/about/", "About the example app"],
    ]);
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
