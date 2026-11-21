import type { Answer, Api } from "./label.ts";

type Fetch = (url: string, init: { headers: Record<string, string> }) => Promise<Response>;

/** The GitHub API over a token: a GET that answers its status and its JSON body, and never throws. */
export function githubApi(token: string, fetchFn: Fetch = fetch): Api {
  return async (path): Promise<Answer> => {
    try {
      const response = await fetchFn(`https://api.github.com/${path}`, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      const body: unknown = await response.json().catch(() => undefined);
      return { status: response.status, body };
    } catch {
      return { status: 0, body: undefined };
    }
  };
}
