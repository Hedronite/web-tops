import { resolve } from "node:path";
import { readProject } from "../config/project.ts";
import { checkConfigFile } from "../config/validate.ts";
import { toGateConfig } from "./adapter.ts";
import type { LoadedConfig } from "./command.ts";

export const CONFIG_FILE = "web-tops.yaml";

/** Schema first, then the semantic checks (WEB_TOPS.md section 12), as the start of `gate`; problems print as JSON pointers. */
export function loadGateConfig(cwd: string): Promise<LoadedConfig> {
  const result = checkConfigFile(resolve(cwd, CONFIG_FILE));
  if (result.ok) {
    return Promise.resolve({ ok: true, config: toGateConfig(result.value, readProject(cwd)) });
  }
  const errors = result.problems.map(
    (problem) =>
      `${CONFIG_FILE} ${problem.pointer === "" ? "(document)" : problem.pointer}: ${problem.message}`,
  );
  return Promise.resolve({ ok: false, errors });
}
