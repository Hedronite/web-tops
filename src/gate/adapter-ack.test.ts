import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/validate.ts";
import { ledgerOf } from "../acks/files.ts";
import { toGateConfig } from "./adapter.ts";
import { cfg } from "./testkit.ts";

/** `laws.ack_ledger` reaches the gate's config, and the layers read the ledger from it (WEB_TOPS.md section 8.1). */

const HEAD =
  'protocol: "0.3.0"\nversion: "0.1.0"\npackage: pkg\nclass: ts-library\nenforce: hard\n';

function gateOf(body: string) {
  const parsed = parseConfig(`${HEAD}${body}`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
  return toGateConfig(parsed.value, { dependsOnAstro: false });
}

describe("toGateConfig and the ack ledger", () => {
  it("carries the ledger the config names", () => {
    expect(gateOf("laws:\n  ack_ledger: docs/acks.yaml\n").ackLedger).toBe("docs/acks.yaml");
  });

  it("has no ledger when the config names none", () => {
    expect(gateOf("").ackLedger).toBeUndefined();
    expect("ackLedger" in gateOf("laws:\n  select: all\n")).toBe(false);
  });
});

describe("ledgerOf: the ledger a layer reads", () => {
  it("is the one the config names", () => {
    expect(ledgerOf(cfg({ ackLedger: "docs/acks.yaml" }))).toBe("docs/acks.yaml");
  });

  it("is .web-tops/acks.yaml when the config names none", () => {
    expect(ledgerOf(cfg({}))).toBe(".web-tops/acks.yaml");
  });
});
