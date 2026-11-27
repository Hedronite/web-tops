// Loads each route in headless Chromium and lists the JavaScript the browser asked for while it loaded. Playwright is
// the project's own copy, named by the request: a tool the project installs, not a dependency of the kit.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import process from "node:process";

const request = JSON.parse(readFileSync(process.argv[2], "utf8"));
const load = createRequire(join(request.cwd, "package.json"));
const { chromium } = load(request.tool);

// A script the page asked for, or anything served as JavaScript (a module preload, a worker's script).
const isScript = (response) =>
  response.request().resourceType() === "script" ||
  /javascript/u.test(String(response.headers()["content-type"]));

function listen(page) {
  const seen = { scripts: [], failed: [] };
  page.on("response", (response) => {
    if (isScript(response)) {
      seen.scripts.push({ url: response.url(), status: response.status() });
    }
  });
  page.on("requestfailed", (failed) => {
    if (failed.resourceType() === "script") {
      seen.failed.push(failed.url());
    }
  });
  return seen;
}

// A new context for each route: no cache and no service worker, so a chunk two routes load is seen by both.
async function visit(browser, url) {
  const context = await browser.newContext({ viewport: request.viewport, serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    const seen = listen(page);
    const response = await page.goto(url, { waitUntil: "networkidle" });
    const status = response.status();
    return status >= 400 ? { status } : { status, html: await response.text(), ...seen };
  } finally {
    await context.close();
  }
}

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
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
