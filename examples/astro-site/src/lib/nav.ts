/** One entry of the site's navigation. */
export interface NavItem {
  readonly href: string;
  readonly label: string;
}

export const navItems = (): readonly NavItem[] => [
  { href: "/", label: "Home" },
  { href: "/guides/", label: "Guides" },
  { href: "/about/", label: "About" },
];

const withSlash = (path: string): string => (path.endsWith("/") ? path : `${path}/`);

/** `page` for the link to the page being shown, so it is announced as the current one. */
export function currentOf(pathname: string, href: string): "page" | undefined {
  return withSlash(pathname) === href ? "page" : undefined;
}
