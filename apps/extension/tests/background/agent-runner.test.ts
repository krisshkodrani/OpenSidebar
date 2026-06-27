import { describe, expect, test } from "vitest";
import {
  OrchestratorAgentRunner,
  type AgentTaskDriver,
} from "../../src/background/browser-bridge/agent-runner";
import type { AgentRunOutcome } from "../../src/background/browser-bridge/handler";

/** A driver whose completion we fire manually. */
function controllableDriver() {
  let listener: ((o: AgentRunOutcome) => void) | null = null;
  let started = false;
  return {
    started: () => started,
    fire(outcome: AgentRunOutcome) {
      listener?.(outcome);
    },
    driver: {
      async startTask() {
        started = true;
      },
      onComplete(l: (o: AgentRunOutcome) => void) {
        listener = l;
        return () => {
          listener = null;
        };
      },
    } as AgentTaskDriver,
  };
}

describe("OrchestratorAgentRunner", () => {
  test("starts the task and resolves on the completion event", async () => {
    const ctrl = controllableDriver();
    const runner = new OrchestratorAgentRunner(ctrl.driver);
    const promise = runner.run({ instruction: "do x" });
    expect(ctrl.started()).toBe(true);
    ctrl.fire({ status: "completed", data: { ok: true } });
    expect(await promise).toEqual({ status: "completed", data: { ok: true } });
  });

  test("resolves error when startTask rejects", async () => {
    const driver: AgentTaskDriver = {
      async startTask() {
        throw new Error("no tab");
      },
      onComplete() {
        return () => {};
      },
    };
    const runner = new OrchestratorAgentRunner(driver);
    expect(await runner.run({ instruction: "x" })).toEqual({
      status: "error",
      reason: "no tab",
    });
  });

  test("ignores a late second completion (one-shot)", async () => {
    const ctrl = controllableDriver();
    const runner = new OrchestratorAgentRunner(ctrl.driver);
    const promise = runner.run({ instruction: "x" });
    ctrl.fire({ status: "completed", data: 1 });
    ctrl.fire({ status: "error", reason: "late" });
    expect(await promise).toEqual({ status: "completed", data: 1 });
  });
});
