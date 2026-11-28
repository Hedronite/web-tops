/** The markup of the home view. It holds no input, so there is nothing to escape. */
export default function home(): string {
  return [
    "<h1>Example app</h1>",
    '<p class="mt-4">One module for every route, and one more for each view it shows.</p>',
    '<p class="mt-4"><a class="nav-link" href="/about/">About this app</a></p>',
  ].join("");
}
