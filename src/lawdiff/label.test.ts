import { describe, expect, it } from "vitest";
import { appliedBy, labelAuthority, roleOf, type Answer, type Api } from "./label.ts";

/** R111: only an account with maintain or admin permission may apply the label; asked by permission, never by name. */

const LABEL = "protocol-change";

const events = (...list: [string, string, string][]): Answer => ({
  status: 200,
  body: list.map(([event, name, login]) => ({ event, label: { name }, actor: { login } })),
});

const role = (name: string, legacy = name): Answer => ({
  status: 200,
  body: { role_name: name, permission: legacy },
});

interface Stub {
  readonly api: Api;
  readonly asked: string[];
}

/** An API that answers the events of the pull request and the permission of whoever is asked about. */
function stub(applied: Answer, permission: Answer): Stub {
  const asked: string[] = [];
  const api: Api = (path) => {
    asked.push(path);
    return Promise.resolve(path.includes("/events") ? applied : permission);
  };
  return { api, asked };
}

const input = (api: Api) => ({ labelPresent: true, api, repo: "o/r", pull: "7" });
const BY_A = events(["labeled", LABEL, "labeller-a"]);

describe("the label counts by the permission of the account that applied it", () => {
  it.each([
    ["admin", true],
    ["maintain", true],
    ["write", false],
    ["triage", false],
    ["read", false],
  ])("%s: %s", async (name, expected) => {
    const { api, asked } = stub(BY_A, role(name, name === "maintain" ? "write" : name));
    const found = await labelAuthority(input(api));
    expect(found.authorized).toBe(expected);
    expect(found.reason).toContain(`${name} permission`);
    expect(asked).toEqual([
      "repos/o/r/issues/7/events?per_page=100",
      "repos/o/r/collaborators/labeller-a/permission",
    ]);
  });

  it("says why a write account's label counts as not applied", async () => {
    const found = await labelAuthority(input(stub(BY_A, role("write")).api));
    expect(found).toEqual({
      authorized: false,
      reason:
        "the protocol-change label was applied by an account with write permission, and only maintain or admin may apply it: it counts as not applied",
    });
  });

  it("reads maintain from role_name, not from the legacy permission field that calls it write", async () => {
    const found = await labelAuthority(input(stub(BY_A, role("maintain", "write")).api));
    expect(found.authorized).toBe(true);
  });

  it("asks nothing when the label is absent, and is a plain absence", async () => {
    const { api, asked } = stub(BY_A, role("admin"));
    const found = await labelAuthority({ labelPresent: false, api, repo: "o/r", pull: "7" });
    expect(found).toEqual({ authorized: false, reason: "the protocol-change label is absent" });
    expect(asked).toEqual([]);
  });

  it("trusts the label's presence when there is no API, as a local run does", async () => {
    const found = await labelAuthority({ labelPresent: true });
    expect(found.authorized).toBe(true);
    expect(found.reason).toContain("a local run");
    expect((await labelAuthority({ labelPresent: true, repo: "o/r", pull: "7" })).authorized).toBe(
      true,
    );
  });
});

describe("a label that cannot be traced to an account with the right permission counts as not applied", () => {
  it("when the events cannot be read, naming the status", async () => {
    const found = await labelAuthority(input(stub({ status: 403, body: {} }, role("admin")).api));
    expect(found).toEqual({
      authorized: false,
      reason:
        "who applied the protocol-change label could not be read (status 403): the label counts as not applied",
    });
  });

  it("when the permission cannot be read", async () => {
    const found = await labelAuthority(input(stub(BY_A, { status: 404, body: {} }).api));
    expect(found.authorized).toBe(false);
    expect(found.reason).toContain(
      "the permission of the account that applied it could not be read (status 404)",
    );
  });

  it("when no event shows who applied it, or it was taken off again", async () => {
    const none = await labelAuthority(input(stub(events(), role("admin")).api));
    expect(none.authorized).toBe(false);
    expect(none.reason).toContain("no event shows who applied");
    const off = events(["labeled", LABEL, "labeller-a"], ["unlabeled", LABEL, "labeller-b"]);
    expect((await labelAuthority(input(stub(off, role("admin")).api))).authorized).toBe(false);
  });

  it("when the role is missing from the answer", async () => {
    const found = await labelAuthority(input(stub(BY_A, { status: 200, body: {} }).api));
    expect(found.authorized).toBe(false);
  });
});

describe("who applied the label", () => {
  it("is the account of the last labeled event for this label, whatever other labels did", () => {
    const list = events(
      ["labeled", LABEL, "labeller-a"],
      ["labeled", "other", "labeller-b"],
      ["unlabeled", "other", "labeller-c"],
      ["labeled", LABEL, "labeller-d"],
    );
    expect(appliedBy(list.body)).toBe("labeller-d");
  });

  it("is not moved by an event of another label, nor by an event of this one that neither applies nor removes it", () => {
    const other = events(["labeled", LABEL, "labeller-a"], ["unlabeled", "other", "labeller-b"]);
    expect(appliedBy(other.body)).toBe("labeller-a");
    const quiet = events(["labeled", LABEL, "labeller-a"], ["milestoned", LABEL, "labeller-b"]);
    expect(appliedBy(quiet.body)).toBe("labeller-a");
  });

  it("is none after an unlabeled, and for anything that is not a list of events", () => {
    expect(
      appliedBy(events(["labeled", LABEL, "a"], ["unlabeled", LABEL, "b"]).body),
    ).toBeUndefined();
    expect(appliedBy({})).toBeUndefined();
    expect(appliedBy([null, 3, { event: "labeled" }])).toBeUndefined();
  });

  it("reads the role from role_name only", () => {
    expect(roleOf({ role_name: "maintain" })).toBe("maintain");
    expect(roleOf({ permission: "admin" })).toBeUndefined();
    expect(roleOf(null)).toBeUndefined();
  });
});
