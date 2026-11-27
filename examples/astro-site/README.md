# astro-site example

A small static site in the `astro-site` class of Web-TOPS, styled with Tailwind CSS 4: three pages, an image
through `astro:assets`, anchors and links between pages, and no page JavaScript.

```sh
bun install --frozen-lockfile
bun run build
bun ../../src/cli/main.ts gate --max-tier 1
```

- `package.json` pins its tools exactly; `web-tops` is linked from the kit (`link:../..`), so the presets are the
  ones the kit ships.
- `src/styles/global.css` uses the Tailwind 4 at-rules (`@theme`, `@apply`, `@utility`, `@custom-variant`) the
  kit's Stylelint preset allows.
- Navigation links are blocks of their own, at least 24 by 24 CSS px (WCAG 2.5.8); links inside a sentence are
  exempt.
- A template callback that returns markup says `unknown`: Astro types a template element as `any`, which W-01
  does not let a function return.
- The build-output and laws layers are off in `web-tops.yaml` until the built-page wiring lands.
