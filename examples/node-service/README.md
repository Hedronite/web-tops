# node-service example

A small notes service (`GET /health`, `GET /notes`, `GET /notes/:id`, `POST /notes`) in the `node-service` class of Web-TOPS. It is the
class's example, and it gates itself with the kit's own source:

```sh
bun install --frozen-lockfile
bun ../../src/cli/main.ts gate --max-tier 1
```

- `package.json` pins its tools exactly; `web-tops` is linked from the kit (`link:../..`), so the presets in `eslint.config.js`,
  `tsconfig.json` and `.dependency-cruiser.cjs` are the ones the kit ships.
- The kit reaches it through the `references` of the root `tsconfig.json`, and lints it under its own `eslint.config.js`.
- Request bodies cross the boundary as `unknown` and are checked in `src/input.ts`, never asserted (W-06, strict reading).
