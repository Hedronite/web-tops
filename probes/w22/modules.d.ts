// Neither a11y plugin ships types that fit the ESLint they run on, so each is typed here as the
// plugin of its own ESLint. The control is installed as `jsx-a11y-control` (see README.md).
declare module "jsx-a11y-control" {
  import type { ESLint } from "eslint-9";
  const plugin: ESLint.Plugin;
  export default plugin;
}

declare module "eslint-plugin-jsx-a11y-x" {
  import type { ESLint } from "eslint";
  const plugin: ESLint.Plugin;
  export default plugin;
}
