import type { LayerContext } from "../../gate/types.ts";
import type { DistInventory } from "../build/index.ts";

/** One page to judge: the route it is asked for by, and the built file that answers it when there is one. */
export interface Target {
  readonly route: string;
  readonly file?: string;
}

/** The built file the static server answers a route with: the path, its `index.html`, or `<path>.html`. */
function fileOf(inventory: DistInventory, route: string): string | undefined {
  const path = new URL(route, "http://localhost").pathname.slice(1).replace(/\/$/u, "");
  const index = path === "" ? "index.html" : `${path}/index.html`;
  return [path, index, `${path}.html`].find((name) => inventory.files.includes(name));
}

function routed(inventory: DistInventory, route: string): Target {
  const file = fileOf(inventory, route);
  return file === undefined ? { route } : { route, file };
}

/** `web-app` is judged on the routes it declares; every other class on every built page. */
export function targetsOf(context: LayerContext, inventory: DistInventory): readonly Target[] {
  return context.config.class === "web-app"
    ? (context.config.routes ?? []).map((route) => routed(inventory, route))
    : inventory.pages.map(({ route, file }) => ({ route, file }));
}
