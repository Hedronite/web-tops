import { resolve } from "node:path";
import { configHistoryProblems } from "../baseline/config-history.ts";
import { readProject } from "../config/project.ts";
import { checkConfigFile } from "../config/validate.ts";
import type { Problem } from "../config/types.ts";
import { toGateConfig } from "./adapter.ts";
import type { LoadedConfig } from "./command.ts";

export const CONFIG_FILE = "web-tops.yaml";

function errorsOf(problems: readonly Problem[]): LoadedConfig {
  const errors = problems.map(
    (problem) =>
      `${CONFIG_FILE} ${problem.pointer === "" ? "(document)" : problem.pointer}: ${problem.message}`,
  );
  return { ok: false, errors };
}

/**
 * Schema first, then the semantic checks (WEB_TOPS.md section 12), as the start of `gate`, then, under
 * `ratchet`, the baseline across the change (section 6.7); problems print as JSON pointers.
 */
export async function loadGateConfig(cwd: string): Promise<LoadedConfig> {
  const result = checkConfigFile(resolve(cwd, CONFIG_FILE));
  if (!result.ok) return errorsOf(result.problems);
  const history = await configHistoryProblems(result.value, cwd);
  if (history.length > 0) return errorsOf(history);
  return { ok: true, config: toGateConfig(result.value, readProject(cwd)) };
}
