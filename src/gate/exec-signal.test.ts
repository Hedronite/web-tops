import { describe, expect, it } from "vitest";
import { realExec } from "./exec.ts";

/** A process that a signal ends has no exit code; the result names the signal, as the mutation layer's finding needs. */

describe("realExec and the signal that ends a process", () => {
  it("names the signal and gives no exit code when the child is killed", async () => {
    const result = await realExec(process.execPath, ["-e", "process.kill(process.pid, 'SIGKILL')"]);
    expect(result.code).toBeNull();
    expect(result.signal).toBe("SIGKILL");
    expect(result.failure).toBeUndefined();
  });

  it("names no signal for a child that exits, whatever its code", async () => {
    const result = await realExec(process.execPath, ["-e", "process.exit(4)"]);
    expect(result.code).toBe(4);
    expect("signal" in result).toBe(false);
  });
});
