import { gateCommand } from "../gate/command.ts";
import { realExec } from "../gate/exec.ts";
import { loadGateConfig } from "../gate/load.ts";
import { buildRegistry } from "../gate/registry.ts";
import type { Io } from "./io.ts";

/** Bun's typings say its version is always set; under Node it is not. */
const bunVersion: string | undefined = process.versions.bun;

/** `webtops gate` (WEB_TOPS.md sections 3 and 12): exit 0 pass, 1 failed, 2 config or usage, 3 environment, 4 policy. */
export function runGateCli(argv: readonly string[], io: Io): Promise<number> {
  return gateCommand(argv, io, {
    cwd: io.cwd,
    env: io.env,
    exec: realExec,
    versions: bunVersion === undefined ? {} : { bun: bunVersion },
    loadConfig: loadGateConfig,
    layers: buildRegistry,
    now: Date.now,
  });
}
