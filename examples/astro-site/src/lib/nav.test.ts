import { describe, expect, it } from "vitest";
import { currentOf, navItems } from "./nav.ts";

describe("navigation", () => {
  it("lists the three pages of the site, each as a directory", () => {
    expect(navItems()).toEqual([
      { href: "/", label: "Home" },
      { href: "/guides/", label: "Guides" },
      { href: "/about/", label: "About" },
    ]);
  });

  it.each([
    ["/", "/", "page"],
    ["/guides", "/guides/", "page"],
    ["/guides/", "/guides/", "page"],
    ["/guides/", "/", undefined],
    ["/about/", "/guides/", undefined],
  ])("marks the link %s to %s as %s", (pathname, href, expected) => {
    expect(currentOf(pathname, href)).toBe(expected);
  });
});
