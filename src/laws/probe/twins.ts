import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProbeLaw, Twin, TwinKind } from "./types.ts";

/** The files of a twin the tools read. Anything else in a twin directory is copied beside them and left alone. */
function twinFile(): RegExp {
  return /\.(?:[cm]?ts|tsx|css|astro)$/u;
}

/** TypeScript the compiler reads. An Astro file is linted under the project's own config, never compiled here. */
function scriptFile(): RegExp {
  return /\.(?:[cm]?ts|tsx)$/u;
}

export const isCss = (file: string): boolean => file.endsWith(".css");
export const isAstro = (file: string): boolean => file.endsWith(".astro");
export const isScript = (file: string): boolean => scriptFile().test(file);

function twinKinds(): readonly TwinKind[] {
  return ["bad", "clean"];
}

/** An empty ignore file for Stylelint: the project's own ignores may skip `.web-tops/`, where the twins are read. */
export function stylelintIgnore(): string {
  return "stylelint.ignore";
}

/** Every file under a directory, as paths relative to it with `/` separators. */
function filesUnder(directory: string, prefix = ""): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(directory, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

/** The twins of the given laws under `fixtures/<id>/{bad,clean}/`: only a law's own directory is read. */
export function listTwins(fixtures: string, laws: readonly ProbeLaw[]): Twin[] {
  return laws.flatMap((law) =>
    twinKinds().flatMap((kind) =>
      filesUnder(join(fixtures, law.id, kind))
        .filter((name) => twinFile().test(name))
        .map((name) => ({ law: law.id, kind, file: `${law.id}/${kind}/${name}` })),
    ),
  );
}

/**
 * The scratch project: a copy of each probed law's directory, the one tsconfig the compiler and the type-aware lint
 * rules both find, and an empty ignore file for Stylelint. It extends the project's own, so a flag the project turns off is off for the twins too, and it
 * names every file, so no `include` or `exclude` of the project's keeps a twin out.
 */
export function materialize(
  fixtures: string,
  scratch: string,
  laws: readonly ProbeLaw[],
  tsconfig: string,
): void {
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  for (const law of laws) {
    const from = join(fixtures, law.id);
    if (existsSync(from)) {
      cpSync(from, join(scratch, law.id), { recursive: true });
    }
  }
  const config = {
    extends: tsconfig,
    compilerOptions: { noEmit: true },
    include: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    exclude: [],
  };
  writeFileSync(join(scratch, "tsconfig.json"), `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(join(scratch, stylelintIgnore()), "");
}
