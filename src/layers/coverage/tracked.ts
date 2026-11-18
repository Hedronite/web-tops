import type { RawFinding } from "../../report/findings.ts";
import type { LayerContext } from "../../gate/types.ts";
import { exitFinding, launchFailure } from "../hygiene/tooling.ts";

/** The files git tracks, so a file no test imports cannot leave the denominator. */
export async function trackedFiles(
  ctx: LayerContext,
): Promise<{ readonly files: string[] } | { readonly finding: RawFinding }> {
  const result = await ctx.exec("git", ["ls-files", "-z"], { cwd: ctx.cwd, env: ctx.env });
  const launch = launchFailure("webtops", "git", result);
  if (launch !== undefined) {
    return { finding: launch };
  }
  if (result.code !== 0) {
    return {
      finding: exitFinding("webtops", "git-ls-files-failed", "git ls-files", result, "stderr"),
    };
  }
  return { files: result.stdout.split("\0").filter((file) => file !== "") };
}
