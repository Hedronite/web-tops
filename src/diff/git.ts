import type { Exec } from "../gate/types.ts";

export type GitResult =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: string };

/** Runs git in `cwd`: its trimmed output, or the reason it failed. */
export async function runGit(exec: Exec, cwd: string, args: readonly string[]): Promise<GitResult> {
  const result = await exec("git", args, { cwd, timeoutMs: 60_000 });
  if (result.code === 0) return { ok: true, value: result.stdout.trim() };
  return { ok: false, reason: result.stderr.trim() || `git ${args.join(" ")} failed` };
}

const SHALLOW =
  "this is a shallow clone, so the merge base cannot be found; check out with fetch-depth: 0 (WEB_TOPS.md section 11)";

/** A reason the diff cannot be taken from this checkout, or undefined when it can. */
async function checkout(exec: Exec, cwd: string): Promise<string | undefined> {
  const inside = await runGit(exec, cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok) return `not a git work tree: ${inside.reason}`;
  const shallow = await runGit(exec, cwd, ["rev-parse", "--is-shallow-repository"]);
  return shallow.ok && shallow.value === "true" ? SHALLOW : undefined;
}

async function absent(exec: Exec, cwd: string, base: string): Promise<string | undefined> {
  const known = await runGit(exec, cwd, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  return known.ok ? undefined : `the base ${base} does not exist in this checkout`;
}

function mergeBaseResult(found: GitResult, base: string): GitResult {
  if (found.ok && found.value !== "") return found;
  return { ok: false, reason: `there is no merge base between HEAD and ${base}` };
}

/** The merge base of HEAD and `base`, or the reason there is none: a shallow clone, a missing base, no shared history. */
export async function mergeBaseOf(exec: Exec, cwd: string, base: string): Promise<GitResult> {
  const blocked = (await checkout(exec, cwd)) ?? (await absent(exec, cwd, base));
  if (blocked !== undefined) return { ok: false, reason: blocked };
  return mergeBaseResult(await runGit(exec, cwd, ["merge-base", "HEAD", base]), base);
}

/** The work tree against the merge base, with no context: tracked files, staged or not. */
export function diffText(exec: Exec, cwd: string, mergeBase: string): Promise<GitResult> {
  const args = [
    "-c",
    "core.quotepath=false",
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-renames",
    "-U0",
    mergeBase,
    "--",
  ];
  return runGit(exec, cwd, args);
}

/** The tracked files under `examples/`, NUL separated: by them an example is known to gate itself. */
export function trackedExamples(exec: Exec, cwd: string): Promise<GitResult> {
  return runGit(exec, cwd, ["ls-files", "-z", "--", "examples"]);
}

/** A file as it was at `ref`, or the reason it has none there (a file that was added, for one). */
export function showAt(exec: Exec, cwd: string, ref: string, path: string): Promise<GitResult> {
  return runGit(exec, cwd, ["show", `${ref}:${path}`]);
}
