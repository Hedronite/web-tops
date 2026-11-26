// Runs html-validate, as the project installed it, over the built pages with exactly the configurations the gate
// passes. The loader is static, so no `.htmlvalidate.*` file, no `html-validate.config.*` and no
// `.htmlvalidateignore` of the project is read: none of them can turn a rule off or skip a page.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import process from "node:process";

const request = JSON.parse(readFileSync(process.argv[2], "utf8"));
// The project's own copy, named by the request: it is a tool the project installs, not a dependency of the kit.
const load = createRequire(join(request.cwd, "package.json"));
const { HtmlValidate, StaticConfigLoader } = load(request.tool);

async function runPass({ law, config }) {
  const validator = new HtmlValidate(new StaticConfigLoader(config));
  const read = [];
  for (const file of request.files) {
    const path = join(request.distDir, file);
    const report = await validator.validateString(readFileSync(path, "utf8"), path);
    read.push({ law, file, messages: report.results.flatMap((result) => result.messages) });
  }
  return read;
}

const results = [];
for (const pass of request.passes) {
  results.push(...(await runPass(pass)));
}
process.stdout.write(JSON.stringify(results));
