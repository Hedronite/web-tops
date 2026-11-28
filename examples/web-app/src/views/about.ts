/** The markup of the about view. It holds no input, so there is nothing to escape. */
export default function about(): string {
  return [
    "<h1>About</h1>",
    '<p class="mt-4">This is the web-app example of Web-TOPS. Go back <a href="/">home</a>.</p>',
  ].join("");
}
