import { describe, expect, test } from "vitest";
import "../setup";
import {
  runCompletionPipeline,
  type CompletionPipelineDeps,
} from "../../src/background/agent/completion/pipeline";
import type { CompletionGuardContext } from "../../src/background/agent/completion/guards/context";
import type { CompletionEvaluation } from "../../src/background/agent/completion-kernel";

function ctx(over: Partial<CompletionGuardContext> = {}): CompletionGuardContext {
  return {
    summary: "Clicked the submit button successfully.",
    userRequest: "click the submit button",
    snapshot: null,
    taskContext: "click the submit button",
    turnCount: 8,
    isOrchestratorNode: false,
    doneRejections: 0,
    maxDoneRejections: 3,
    consecutiveSameKindRejections: 0,
    lastContractRejectionKind: null,
    planSubtaskCount: 0,
    runningSubtaskIndex: -1,
    selectedSkillId: null,
    hasReadPage: true,
    hasExplicitPageRead: true,
    hasTaskId: false,
    missingRequiredEvidence: [],
    listDetailReviewedCount: 0,
    listDetailOpenedCount: 0,
    listDetailVisibleActionCount: 0,
    moneyTableIncompleteScanReason: null,
    moneyTableIncorrectAnswerReason: null,
    ...over,
  };
}

const accepted = { status: "accepted", contract: { kind: "generic" } } as unknown as CompletionEvaluation;
function rejected(kind: string): CompletionEvaluation {
  return {
    status: "rejected",
    contract: { kind },
    reason: `kernel rejected: ${kind}`,
    evidence: [],
  } as unknown as CompletionEvaluation;
}

function deps(over: Partial<CompletionPipelineDeps> = {}): CompletionPipelineDeps {
  return {
    getKernelDecision: () => accepted,
    deterministicAcceptanceEnabled: false,
    isDuplicateTerminal: false,
    validatePlan: async () => null,
    onKernelReject: () => {},
    ...over,
  };
}

describe("runCompletionPipeline", () => {
  test("duplicate terminal short-circuits to accept", async () => {
    const d = await runCompletionPipeline(ctx(), deps({ isDuplicateTerminal: true }));
    expect(d.verdict).toBe("accept");
    expect(d.basis).toBe("duplicate_terminal");
    expect(d.rejectedBy).toBe("idempotency");
  });

  test("clean state falls through to legacy_done_guards accept", async () => {
    const d = await runCompletionPipeline(ctx(), deps());
    expect(d.verdict).toBe("accept");
    expect(d.basis).toBe("legacy_done_guards");
    expect(d.rejectedBy).toBe("fallthrough_accept");
  });

  test("kernel acceptance returns basis kernel", async () => {
    const d = await runCompletionPipeline(
      ctx(),
      deps({ deterministicAcceptanceEnabled: true, getKernelDecision: () => accepted }),
    );
    expect(d.verdict).toBe("accept");
    expect(d.basis).toBe("kernel");
  });

  test("kernel rejection returns basis kernel_reject", async () => {
    const d = await runCompletionPipeline(
      ctx(),
      deps({
        deterministicAcceptanceEnabled: true,
        getKernelDecision: () => rejected("money_table"),
      }),
    );
    expect(d.verdict).toBe("reject");
    expect(d.basis).toBe("kernel_reject");
    expect(d.rejectedBy).toBe("kernel");
  });

  test("same-kind bounce bypasses the kernel and falls through to legacy", async () => {
    const d = await runCompletionPipeline(
      ctx({ lastContractRejectionKind: "money_table", consecutiveSameKindRejections: 2 }),
      deps({
        deterministicAcceptanceEnabled: true,
        getKernelDecision: () => rejected("money_table"),
      }),
    );
    expect(d.verdict).toBe("accept");
    expect(d.basis).toBe("legacy_done_guards");
    // the bypass trace was emitted before falling through
    expect(
      d.effects.some(
        (e) => e.type === "emit_trace" && e.event === "completion_contract_bypassed",
      ),
    ).toBe(true);
  });

  test("max-rejections gate rejects in the legacy bundle", async () => {
    const d = await runCompletionPipeline(
      ctx({ doneRejections: 3, maxDoneRejections: 3 }),
      deps(),
    );
    expect(d.verdict).toBe("reject");
    expect(d.rejectedBy).toBe("max_rejections");
  });

  test("planner rejection returns basis plan_validation", async () => {
    const d = await runCompletionPipeline(
      ctx(),
      deps({ validatePlan: async () => ({ rejected: true, reason: "step incomplete" }) }),
    );
    expect(d.verdict).toBe("reject");
    expect(d.rejectedBy).toBe("plan_validation");
    expect(d.reason).toBe("step incomplete");
  });
});
