/** What a command may touch: its output streams, its working directory and its environment. */
export interface Io {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** The process streams, directory and environment, for the entry point. */
export const stdio: Io = {
  out: (text) => {
    process.stdout.write(text);
  },
  err: (text) => {
    process.stderr.write(text);
  },
  cwd: process.cwd(),
  env: process.env,
};
