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
- Build output and the laws layer are on at `hard`: the built pages are validated (W-20, W-22), their links checked,
  their JavaScript held to a budget of 0 bytes (W-29) and each page run through axe (W-21, W-44). The planted
  defects in `fixtures/plants/` show each of these red over this example.
