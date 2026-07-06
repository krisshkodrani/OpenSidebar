import { describe, expect, test, vi } from "vitest";
import "../setup";
import {
  applyCompletionEffects,
  type CompletionEffectHost,
} from "../../src/background/agent/completion/apply-effects";
import type { CompletionEffect } from "../../src/background/agent/completion/pipeline-types";
import type { CompletionEvaluation } from "../../src/background/agent/completion-kernel";

function makeHost(): CompletionEffectHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    incrementDoneRejections: vi.fn(() => calls.push("increment")),
    recordContractRejection: vi.fn((kind: string) =>
      calls.push(`record:${kind}`),
    ),
    setLastCompletionRejection: vi.fn(() => calls.push("setRejection")),
    setRecoveryHint: vi.fn((hint) => calls.push(`hint:${hint}`)),
    postContextMessage: vi.fn((role, content) =>
      calls.push(`msg:${role}:${content}`),
    ),
    emitTrace: vi.fn((event) => calls.push(`trace:${event}`)),
    setGuardAfterDoneRejection: vi.fn(() => calls.push("guardFlag")),
    checkDoneRejectionEscalation: vi.fn(() => calls.push("escalation")),
    forceGroundingRefresh: vi.fn(async () => {
      calls.push("refresh");
    }),
  };
}

describe("applyCompletionEffects", () => {
  test("dispatches each effect variant to its host method", async () => {
    const host = makeHost();
    const decision = { status: "rejected" } as unknown as CompletionEvaluation;
    const effects: CompletionEffect[] = [
      { type: "increment_done_rejections" },
      { type: "record_contract_rejection", kind: "money_table" },
      { type: "set_last_completion_rejection", decision },
      { type: "set_recovery_hint", hint: "try X" },
      { type: "post_context_message", role: "tool", content: "nope" },
      { type: "emit_trace", event: "done_rejected", data: { a: 1 } },
      { type: "set_guard_after_done_rejection" },
      { type: "check_done_rejection_escalation" },
      { type: "force_grounding_refresh" },
    ];

    await applyCompletionEffects(effects, host);

    expect(host.incrementDoneRejections).toHaveBeenCalledOnce();
    expect(host.recordContractRejection).toHaveBeenCalledWith("money_table");
    expect(host.setLastCompletionRejection).toHaveBeenCalledWith(decision);
    expect(host.setRecoveryHint).toHaveBeenCalledWith("try X");
    expect(host.postContextMessage).toHaveBeenCalledWith("tool", "nope");
    expect(host.emitTrace).toHaveBeenCalledWith("done_rejected", { a: 1 });
    expect(host.setGuardAfterDoneRejection).toHaveBeenCalledOnce();
    expect(host.checkDoneRejectionEscalation).toHaveBeenCalledOnce();
    expect(host.forceGroundingRefresh).toHaveBeenCalledOnce();
  });

  test("applies effects strictly in array order", async () => {
    const host = makeHost();
    await applyCompletionEffects(
      [
        { type: "increment_done_rejections" },
        { type: "emit_trace", event: "done_rejected", data: {} },
        { type: "post_context_message", role: "tool", content: "x" },
        { type: "check_done_rejection_escalation" },
      ],
      host,
    );
    expect(host.calls).toEqual([
      "increment",
      "trace:done_rejected",
      "msg:tool:x",
      "escalation",
    ]);
  });

  test("awaits the async grounding refresh before the next effect", async () => {
    const host = makeHost();
    let refreshed = false;
    host.forceGroundingRefresh = vi.fn(async () => {
      await Promise.resolve();
      refreshed = true;
      host.calls.push("refresh");
    });
    await applyCompletionEffects(
      [
        { type: "force_grounding_refresh" },
        { type: "emit_trace", event: "after", data: {} },
      ],
      host,
    );
    expect(refreshed).toBe(true);
    expect(host.calls).toEqual(["refresh", "trace:after"]);
  });

  test("no effects is a no-op", async () => {
    const host = makeHost();
    await applyCompletionEffects([], host);
    expect(host.calls).toEqual([]);
  });
});
