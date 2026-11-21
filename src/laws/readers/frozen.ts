import { isRecord, parseJson, readOutput } from "../../layers/hygiene/tooling.ts";
import type { LawEntry, LawReader, LawReading } from "./types.ts";
import { exitCodeOf, notEvaluated, readingOf, webtopsRefusal } from "./reading.ts";

const LOCKFILE = "bun.lock";

/** The exit code of gate 1's `bun install --frozen-lockfile`, or undefined when gate 1 kept none. */
function installCode(text: string | undefined): number | null | undefined {
  const report = parseJson(text);
  return isRecord(report) ? exitCodeOf(report["code"]) : undefined;
}

const MISSING = "gate 1 kept no result of bun install --frozen-lockfile: the install did not run";

/** W-40: `bun.lock` is committed, and a frozen install of it passed. */
export function judgeFrozen(
  law: LawEntry,
  tracked: readonly string[],
  installText: string | undefined,
  held: boolean,
): LawReading {
  if (!tracked.includes(LOCKFILE)) {
    return readingOf(
      law,
      [webtopsRefusal("lockfile-missing", "bun.lock is not committed", LOCKFILE)],
      false,
    );
  }
  const code = installCode(installText);
  if (code === undefined) {
    return notEvaluated(law, MISSING);
  }
  const broken =
    code === 0
      ? []
      : [
          webtopsRefusal(
            "install-failed",
            `bun install --frozen-lockfile exited ${String(code)}`,
            LOCKFILE,
          ),
        ];
  return readingOf(law, broken, held);
}

/** The frozen-install reader (W-40): the committed lockfile and the install result gate 1 kept. */
export const frozenReader: LawReader = (input) => {
  const path = input.ctx.artifacts.get("install-json");
  const text = path === undefined ? undefined : readOutput(path);
  return Promise.resolve(
    input.laws.map((law) => judgeFrozen(law, input.tracked, text, input.held)),
  );
};
