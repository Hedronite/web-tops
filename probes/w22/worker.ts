// Runs under Node (the protocol's R29: Node runs the tools). Usage: node worker.ts <mode> [engine]
//   rules fork|control   every jsx-a11y rule, one config, over fixtures/rules and fixtures/claims
//   astro                the Astro a11y rules on fixtures/claims/*.astro (ESLint 10)
//   stack                typed rules and eslint-comments on fixtures/stack (ESLint 10)
import { ESLint as ESLint10 } from "eslint";
import { ESLint as ESLint9 } from "eslint-9";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import astro from "eslint-plugin-astro";
import forkPlugin from "eslint-plugin-jsx-a11y-x";
import controlPlugin from "jsx-a11y-control";
import tseslint from "typescript-eslint";
import { fireOf, installedVersion, present, ROOT, toKey } from "./support.ts";
import type { Fire, Observation } from "./types.ts";

interface Lintable {
  lintFiles(patterns: string[]): Promise<
    {
      filePath: string;
      messages: { ruleId: string | null; fatal?: boolean | undefined }[];
    }[]
  >;
}

interface Run {
  readonly engine: string;
  readonly version: string;
  readonly prefix: string;
  readonly implemented: readonly string[];
  readonly deprecated: readonly string[];
  readonly replacedBy: Readonly<Record<string, readonly string[]>>;
  readonly patterns: string[];
  readonly lint: Lintable;
}

function levels(prefix: string, names: readonly string[]): Record<string, "error"> {
  return Object.fromEntries(names.map((name) => [`${prefix}${name}`, "error" as const]));
}

interface Named {
  readonly rules?:
    | Readonly<
        Record<
          string,
          {
            readonly meta?:
              { readonly deprecated?: unknown; readonly replacedBy?: unknown } | undefined;
          }
        >
      >
    | undefined;
}

function deprecatedIn(plugin: Named): string[] {
  const rules = plugin.rules ?? {};
  return Object.keys(rules)
    .filter((name) => rules[name]?.meta?.deprecated === true)
    .sort();
}

function replacementsIn(plugin: Named): Record<string, string[]> {
  const rules = plugin.rules ?? {};
  return Object.fromEntries(
    deprecatedIn(plugin).map((name) => {
      const by = rules[name]?.meta?.replacedBy;
      return [name, Array.isArray(by) ? by.filter((r) => typeof r === "string") : []];
    }),
  );
}

const FILES = ["**/*.tsx"];

function forkLint(names: readonly string[]): Lintable {
  return new ESLint10({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: FILES,
        languageOptions: { parser: tseslint.parser },
        plugins: { a11y: forkPlugin },
        rules: levels("a11y/", names),
      },
    ],
    cwd: ROOT,
  });
}

function controlLint(names: readonly string[]): Lintable {
  return new ESLint9({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: FILES,
        languageOptions: { parser: tseslint.parser },
        plugins: { a11y: controlPlugin },
        rules: levels("a11y/", names),
      },
    ],
    cwd: ROOT,
  });
}

function jsxRun(engine: string, plugin: Named, pkg: string, lint: (n: string[]) => Lintable): Run {
  const names = Object.keys(plugin.rules ?? {}).sort();
  return {
    engine,
    version: installedVersion(pkg),
    prefix: "a11y/",
    implemented: names,
    deprecated: deprecatedIn(plugin),
    replacedBy: replacementsIn(plugin),
    patterns: ["fixtures/rules", "fixtures/claims/unlabeled-input.tsx"],
    lint: lint(names),
  };
}

const forkRun = (): Run => jsxRun("fork", forkPlugin, "eslint-plugin-jsx-a11y-x", forkLint);
const controlRun = (): Run => jsxRun("control", controlPlugin, "jsx-a11y-control", controlLint);

function astroRun(): Run {
  const lint = new ESLint10({
    overrideConfigFile: true,
    overrideConfig: [...astro.configs["flat/jsx-a11y-strict"]],
    cwd: ROOT,
  });
  return {
    engine: "astro",
    version: installedVersion("eslint-plugin-astro"),
    prefix: "astro/jsx-a11y/",
    implemented: [],
    deprecated: [],
    replacedBy: {},
    patterns: ["fixtures/claims/astro-claim.astro"],
    lint,
  };
}

function stackRun(): Run {
  const typed = ["no-floating-promises", "no-unnecessary-condition"];
  const comments = ["disable-enable-pair", "no-unlimited-disable", "require-description"];
  const lint = new ESLint10({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.ts"],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { projectService: true, tsconfigRootDir: ROOT },
        },
        linterOptions: { reportUnusedDisableDirectives: "off" },
        plugins: {
          "@typescript-eslint": tseslint.plugin,
          "@eslint-community/eslint-comments": eslintComments,
        },
        rules: {
          ...levels("@typescript-eslint/", typed),
          ...levels("@eslint-community/eslint-comments/", comments),
        },
      },
    ],
    cwd: ROOT,
  });
  return {
    engine: "stack",
    version: installedVersion("typescript-eslint"),
    prefix: "",
    implemented: [
      ...typed.map((n) => `@typescript-eslint/${n}`),
      ...comments.map((n) => `@eslint-community/eslint-comments/${n}`),
    ],
    deprecated: [],
    replacedBy: {},
    patterns: ["fixtures/stack"],
    lint,
  };
}

const RUNS: Record<string, () => Run> = {
  astro: astroRun,
  stack: stackRun,
  "rules fork": forkRun,
  "rules control": controlRun,
};

function pick(args: string): Run {
  const make = RUNS[args];
  if (make === undefined)
    throw new Error("usage: node worker.ts rules fork|control | astro | stack");
  return make();
}

async function observe(run: Run): Promise<Observation> {
  const results = await run.lint.lintFiles(run.patterns);
  const files: Record<string, Fire[]> = {};
  for (const result of results) {
    files[toKey(result.filePath)] = result.messages
      .map((m) => fireOf(run.prefix, m))
      .filter(present);
  }
  return {
    engine: run.engine,
    version: run.version,
    implemented: run.implemented,
    deprecated: run.deprecated,
    replaced_by: run.replacedBy,
    files,
  };
}

process.stdout.write(`${JSON.stringify(await observe(pick(process.argv.slice(2).join(" "))))}\n`);
