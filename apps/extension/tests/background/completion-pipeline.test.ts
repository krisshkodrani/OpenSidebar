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



    moneyTableIncompleteScanReason: null,
    moneyTableIncorrectAnswerReason: null,
    ...over,
  };
}

const accepted = { status: "accepted", contract: { kind: "generic" } } as unknown as CompletionEvaluation;
// Non-deciding kernel outcome: the pipeline falls through to the guard bundle,
// so bundle-stage tests can use it as the default.
const inconclusive = { status: "inconclusive", contract: null } as unknown as CompletionEvaluation;
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
    getKernelDecision: () => inconclusive,
    isDuplicateTerminal: false,
    validatePlan: async () => null,
    buildKernelRejectionEffects: () => [],
    buildPlanRejectionEffects: () => [],
    ...over,
  };
}

describe("runCompletionPipeline", () => {
  test("records snapshot grounding once when the kernel delegates to fallback guards", async () => {
    const page = "The Transformer architecture uses attention mechanisms, encoder and decoder layers, positional encodings, residual connections, and feed-forward networks to process sequences efficiently.";
    const decision = await runCompletionPipeline(ctx({
      userRequest: "Summarize this page and report the key points.",
      taskContext: "Summarize this page and report the key points.",
      summary: "The page explains Transformer architecture with attention mechanisms, encoder and decoder layers, positional encodings, and feed-forward networks.",
      hasReadPage: false, hasExplicitPageRead: false,
      snapshot: {
        url: "https://example.test/guide", title: "Guide", timestamp: 0,
        visibleContent: page, pageContent: page,
        scrollPosition: { top: 0, left: 0, height: 1000, width: 1000 }, viewportHeight: 800,
        elements: ["Attention", "Encoder", "Decoder", "Residual", "Feed-forward", "Positional"].map((text, tag) => ({
          tag, text, tagName: "button", attributes: {}, isVisible: true, isDisabled: false,
          rect: { x: 0, y: 0, width: 100, height: 20 },
        })),
      },
    }), deps());
    expect(decision.verdict).toBe("accept");
    expect(decision.effects.filter((effect) => effect.type === "emit_trace" && effect.event === "done_grounded_from_snapshot")).toHaveLength(1);
  });

  test("visible detail count does not expand a limited comparison request", async () => {
    const decision = await runCompletionPipeline(ctx({
      userRequest: "Compare Alpha and Beta only; ignore the other listings.",
      taskContext: "Compare Alpha and Beta only; ignore the other listings.",
      summary: "Alpha costs $20 and Beta costs $30. Alpha is the cheaper option.",
      selectedSkillId: "list-detail-review-loop",

    }), deps());
    expect(decision.verdict, JSON.stringify(decision)).toBe("accept");
  });

  test("removing visit quotas does not override missing objective evidence", async () => {
    const decision = await runCompletionPipeline(ctx({
      userRequest: "Compare all listings", selectedSkillId: "list-detail-review-loop",

    }), deps({ getKernelDecision: () => rejected("read_answer") }));
    expect(decision.verdict).toBe("reject");
    expect(decision.rejectedBy).toBe("kernel");
  });

  test("duplicate terminal short-circuits to accept", async () => {
    const d = await runCompletionPipeline(ctx(), deps({ isDuplicateTerminal: true }));
    expect(d.verdict).toBe("accept");
    expect(d.basis).toBe("duplicate_terminal");
    expect(d.rejectedBy).toBe("idempotency");
  });

  test("inconclusive kernel falls through to legacy_done_guards accept", async () => {
    const d = await runCompletionPipeline(ctx(), deps());
    expect(d.verdict).toBe("accept");
    expect(d.basis).toBe("legacy_done_guards");
    expect(d.rejectedBy).toBe("fallthrough_accept");
  });

  test("kernel acceptance returns basis kernel", async () => {
    const d = await runCompletionPipeline(
      ctx(),
      deps({ getKernelDecision: () => accepted }),
    );
    expect(d.verdict).toBe("accept");
    expect(d.basis).toBe("kernel");
  });

  test("kernel rejection returns basis kernel_reject", async () => {
    const d = await runCompletionPipeline(
      ctx(),
      deps({
        getKernelDecision: () => rejected("money_table"),
      }),
    );
    expect(d.verdict).toBe("reject");
    expect(d.basis).toBe("kernel_reject");
    expect(d.rejectedBy).toBe("kernel");
  });

  test.each(["rejected", "needs_verification"] as const)(
    "repeated %s decisions retain the missing-evidence rejection and recovery effects",
    async (status) => {
      const recovery = { type: "check_done_rejection_escalation" } as const;
      const d = await runCompletionPipeline(
        ctx({ lastContractRejectionKind: "money_table", consecutiveSameKindRejections: 2, doneRejections: 2 }),
        deps({
          getKernelDecision: () => ({ ...rejected("money_table"), status }),
          buildKernelRejectionEffects: () => [recovery],
          validatePlan: async () => { throw new Error("A rejected contract must not fall through to plan validation"); },
        }),
      );
      expect(d.verdict).toBe("reject");
      expect(d.basis).toBe("kernel_reject");
      expect(d.effects).toContainEqual(recovery);
    },
  );

  test("accepts newly sufficient evidence even after the rejection budget was reached", async () => {
    const d = await runCompletionPipeline(
      ctx({ lastContractRejectionKind: "generic", consecutiveSameKindRejections: 3, doneRejections: 3 }),
      deps({ getKernelDecision: () => accepted }),
    );
    expect(d.verdict).toBe("accept");
    expect(d.basis).toBe("kernel");
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

  test("planner rejection carries the run_done_plan_rejection effect (single authority)", async () => {
    // RFC LP-16 Phase 2: the rejection policy is no longer applied inline inside
    // validatePlan — the pipeline surfaces it as an effect for the loop to apply.
    const d = await runCompletionPipeline(
      ctx(),
      deps({
        validatePlan: async () => ({
          rejected: true,
          reason: "step incomplete",
          effectiveCurrentIdx: 1,
        }),
        buildPlanRejectionEffects: (plan) => [
          {
            type: "run_done_plan_rejection",
            toolCallId: "tc",
            summary: "done",
            rejectReason: plan.reason,
            effectiveCurrentIdx: plan.effectiveCurrentIdx ?? -1,
          },
        ],
      }),
    );
    expect(d.verdict).toBe("reject");
    const effect = d.effects.find((e) => e.type === "run_done_plan_rejection");
    expect(effect).toBeDefined();
    expect(effect).toMatchObject({
      type: "run_done_plan_rejection",
      rejectReason: "step incomplete",
      effectiveCurrentIdx: 1,
    });
  });
});
