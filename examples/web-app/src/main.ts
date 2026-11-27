import { routeFor, type Route } from "./routes.ts";
import "./styles/global.css";

async function show(route: Route): Promise<void> {
  const view = await route.view();
  const main = document.querySelector("main");
  if (main === null) return;
  // The views are fixed markup of this app: no input reaches them.
  main.replaceChildren(document.createRange().createContextualFragment(view.default()));
  document.title = route.title;
}

/** A link this app has a route for, else nothing: the browser follows every other link. */
function routeOfLink(target: EventTarget | null): Route | undefined {
  if (!(target instanceof Element)) return undefined;
  const link = target.closest("a");
  return link === null || link.origin !== location.origin ? undefined : routeFor(link.pathname);
}

document.addEventListener("click", (event) => {
  const route = routeOfLink(event.target);
  if (route === undefined) return;
  event.preventDefault();
  history.pushState(null, "", route.path);
  void show(route);
});

window.addEventListener("popstate", () => {
  const route = routeFor(location.pathname);
  if (route !== undefined) void show(route);
});

const first = routeFor(location.pathname);
if (first !== undefined) void show(first);
