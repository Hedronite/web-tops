/** One route of the app: the path it answers, its title, and how its view is loaded. */
export interface Route {
  readonly path: string;
  readonly title: string;
  readonly view: () => Promise<{ readonly default: () => string }>;
}

/** Each view is a chunk of its own, so a route costs only what it shows. */
export const routes = (): readonly Route[] => [
  { path: "/", title: "Example app", view: () => import("./views/home.ts") },
  { path: "/about/", title: "About the example app", view: () => import("./views/about.ts") },
];

const withSlash = (path: string): string => (path.endsWith("/") ? path : `${path}/`);

/** The route for a path, else nothing: an unknown path is left to the server. */
export function routeFor(pathname: string): Route | undefined {
  return routes().find((route) => route.path === withSlash(pathname));
}
