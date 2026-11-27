// Loads each page in headless Chromium and runs axe on it, with the options the gate passes. Playwright and axe are
// the project's own copies, named by the request: they are tools the project installs, not dependencies of the kit.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import process from "node:process";

const request = JSON.parse(readFileSync(process.argv[2], "utf8"));
const load = createRequire(join(request.cwd, "package.json"));
const { chromium } = load(request.tools.playwright);
const AxeBuilder = load(request.tools.axe).default;

const trimmed = ({ id, impact, help, nodes }) => ({
  id,
  impact,
  help,
  nodes: nodes.map(({ target }) => ({ target })),
});

// A page the server did not serve is reported by its status and not judged: an error page is not the route.
async function judge(page, url) {
  const response = await page.goto(url, { waitUntil: "load" });
  const status = response.status();
  if (status >= 400) {
    return { status };
  }
  const found = await new AxeBuilder({ page }).options(request.options).analyze();
  return {
    status,
    violations: found.violations.map(trimmed),
    incomplete: found.incomplete.map(trimmed),
  };
}

async function visit(browser, url) {
  const context = await browser.newContext({ viewport: request.viewport });
  try {
    return await judge(await context.newPage(), url);
  } finally {
    await context.close();
  }
}

// The browser is closed whatever happens, so a failed page never leaves one running.
async function visitAll() {
  const browser = await chromium.launch();
  try {
    const results = [];
    for (const url of request.urls) {
      results.push(await visit(browser, url));
    }
    return results;
  } finally {
    await browser.close();
  }
}

try {
  process.stdout.write(JSON.stringify(await visitAll()));
} catch (error) {
  // The message, not the stack: it says what to fix, such as a browser that is not installed.
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
