/** What a GitHub API call answered: the status, and the JSON body when there was one. */
export interface Answer {
  readonly status: number;
  readonly body: unknown;
}

/** A GET of the GitHub API by path, such as `repos/<owner>/<repo>/issues/<n>/events`. */
export type Api = (path: string) => Promise<Answer>;

export interface LabelInput {
  /** Whether the `protocol-change` label is on the PR. */
  readonly labelPresent: boolean;
  /** The API to ask who applied the label; none in a local run, which trusts the label's presence. */
  readonly api?: Api;
  /** `<owner>/<repo>` and the pull request number, for the API paths. */
  readonly repo?: string | undefined;
  readonly pull?: string | undefined;
}

export interface Authority {
  readonly authorized: boolean;
  readonly reason: string;
}

const labelName = (): string => "protocol-change";

/** The roles that may apply the label (WEB_TOPS.md O12, ruling R111): maintain and admin, by permission and never by name. */
const mayApply = (role: string | undefined): boolean => role === "admin" || role === "maintain";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const field = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined);

const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/** Who applied the label, after one more event: `labeled` names the account, `unlabeled` takes the label off again. */
function next(who: string | undefined, event: unknown): string | undefined {
  if (text(field(field(event, "label"), "name")) !== labelName()) return who;
  const kind = text(field(event, "event"));
  if (kind === "labeled") return text(field(field(event, "actor"), "login"));
  return kind === "unlabeled" ? undefined : who;
}

/** Who applied the label last, from the events of the pull request. */
export const appliedBy = (events: unknown): string | undefined =>
  Array.isArray(events) ? events.reduce<string | undefined>(next, undefined) : undefined;

/** The role a collaborator has on the repository, from `collaborators/<user>/permission`: `role_name`, not the legacy `permission`, which folds maintain into write. */
export const roleOf = (body: unknown): string | undefined => text(field(body, "role_name"));

const absent = (): Authority => ({
  authorized: false,
  reason: "the protocol-change label is absent",
});

const trusted = (): Authority => ({
  authorized: true,
  reason: "the protocol-change label is present (a local run: who applied it is not checked)",
});

const unread = (what: string, answer: Answer): Authority => ({
  authorized: false,
  reason: `${what} could not be read (status ${String(answer.status)}): the label counts as not applied`,
});

const NO_APPLIER: Authority = {
  authorized: false,
  reason: "no event shows who applied the protocol-change label: it counts as not applied",
};

/** The account that applied the label, or why it cannot be told. */
async function applier(api: Api, repo: string, pull: string): Promise<string | Authority> {
  const events = await api(`repos/${repo}/issues/${pull}/events?per_page=100`);
  if (events.status !== 200) return unread("who applied the protocol-change label", events);
  return appliedBy(events.body) ?? NO_APPLIER;
}

function decide(role: string | undefined): Authority {
  const by = `the protocol-change label was applied by an account with ${String(role)} permission`;
  return mayApply(role)
    ? { authorized: true, reason: by }
    : {
        authorized: false,
        reason: `${by}, and only maintain or admin may apply it: it counts as not applied`,
      };
}

async function judged(api: Api, repo: string, pull: string): Promise<Authority> {
  const who = await applier(api, repo, pull);
  if (typeof who !== "string") return who;
  const permission = await api(`repos/${repo}/collaborators/${who}/permission`);
  return permission.status === 200
    ? decide(roleOf(permission.body))
    : unread("the permission of the account that applied it", permission);
}

interface Target {
  readonly api: Api;
  readonly repo: string;
  readonly pull: string;
}

const targetOf = ({ api, repo, pull }: LabelInput): Target | undefined =>
  api === undefined || repo === undefined || pull === undefined ? undefined : { api, repo, pull };

/**
 * Whether the label counts (WEB_TOPS.md O12, R111): it is on the PR, and the account that applied it has maintain or admin
 * permission on the repository, asked of the API by permission and never by name. A label from any other account, or one
 * whose applier cannot be read, counts as not applied. Without an API (a local run) the label's presence is trusted.
 */
export async function labelAuthority(input: LabelInput): Promise<Authority> {
  if (!input.labelPresent) return absent();
  const target = targetOf(input);
  return target === undefined ? trusted() : judged(target.api, target.repo, target.pull);
}
