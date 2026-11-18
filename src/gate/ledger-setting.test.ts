import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/validate.ts";
import { toGateConfig } from "./adapter.ts";
import type { GateConfig } from "./types.ts";

function adapt(yaml: string): GateConfig {
  const parsed = parseConfig(`protocol: "0.3.0"\nversion: "0.1.0"\npackage: pkg\n${yaml}`);
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.problems));
  }
  return toGateConfig(parsed.value, { dependsOnAstro: false });
}

describe("G8 gates.mutation.ledger reaches the gate", () => {
  it("is the setting the config names", () => {
    const config = adapt(
      "class: ts-library\ngates:\n  mutation: { ledger: ledger/accepted.yaml }\n",
    );
    expect(config.mutation.ledger).toBe("ledger/accepted.yaml");
  });

  it("is not set when the config names none, so the runner's default applies", () => {
    expect(adapt("class: ts-library\n").mutation).not.toHaveProperty("ledger");
  });
});
