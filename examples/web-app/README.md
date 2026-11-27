# web-app example

A small client-routed app in the `web-app` class of Web-TOPS, in plain TypeScript with Vite and Tailwind CSS 4:
two routes, one lazy chunk for each view.

```sh
bun install --frozen-lockfile
bun run build
bun ../../src/cli/main.ts gate --max-tier 1
```

- `package.json` pins its tools exactly; `web-tops` is linked from the kit (`link:../..`), so the presets are the
  ones the kit ships.
- The build writes `<route>/index.html` for every route in `src/routes.ts`, with the view already in `<main>`, so
  any static server answers each route and the page reads the same before its JavaScript has run.
- `routes` in `web-tops.yaml` lists the same paths; each is held to the route JavaScript budget (W-29).
- `src/main.ts` wires the DOM and is left out of coverage with that reason; routes and views are tested without a
  DOM.
- Build output and the laws layer are on at `hard`: the built pages are validated, their links checked, and each
  declared route is held to its JavaScript budget and run through axe in headless Chromium.
