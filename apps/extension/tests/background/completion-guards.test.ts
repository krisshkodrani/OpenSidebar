import { describe, expect, test } from "vitest";
import "../setup";
import type { CompletionGuardContext } from "../../src/background/agent/completion/guards/context";
import { assessSummaryGuard } from "../../src/background/agent/completion/guards/summary-guards";
import {
  assessMissingEvidenceGuard,
  assessTaskContractGuard,
} from "../../src/background/agent/completion/guards/contract-guards";
import {
  assessEarlyMultiStepGuard,
  assessMoneyTableGuard,
} from "../../src/background/agent/completion/guards/domain-guards";
import { assessMaxRejectionsGuard } from "../../src/background/agent/completion/guards/budget-guards";
import type {
  CompletionEffect,
  GuardOutcome,
} from "../../src/background/agent/completion/pipeline-types";

function ctx(over: Partial<CompletionGuardContext> = {}): CompletionGuardContext {
  return {
    summary: "Task completed successfully.",
    userRequest: "do the thing",
    snapshot: null,
    taskContext: "do the thing",
    turnCount: 8,
    isOrchestratorNode: false,
    doneRejections: 0,
    maxDoneRejections: 3,
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

function effectTypes(outcome: GuardOutcome): CompletionEffect["type"][] {
  return outcome.kind === "pass" ? [] : outcome.effects.map((e) => e.type);
}

describe("summary guard", () => {
  test("a question summary on turn 1 redirects to clarify (no counter bump)", () => {
    const outcome = assessSummaryGuard(
      ctx({ summary: "Should I continue with the next step?", turnCount: 1 }),
    );
    expect(outcome.kind).toBe("reject");
    if (outcome.kind !== "reject") return;
    expect(outcome.guardId).toBe("summary_preflight");
    // clarify redirect — a plain message, NOT a counter-bumping reject
    expect(effectTypes(outcome)).toEqual(["post_context_message"]);
  });

  test("a complete summary passes", () => {
    expect(assessSummaryGuard(ctx()).kind).toBe("pass");
  });
});

describe("task-contract guard", () => {
  test("skips entirely for orchestrator sub-nodes", () => {
    expect(assessTaskContractGuard(ctx({ isOrchestratorNode: true })).kind).toBe(
      "pass",
    );
  });

  test("skips intermediate root plan steps", () => {
    // running step 0 of 3 (index < count-1) → intermediate → skip
    const outcome = assessTaskContractGuard(
      ctx({ planSubtaskCount: 3, runningSubtaskIndex: 0 }),
    );
    expect(outcome.kind).toBe("pass");
  });
});

describe("missing-evidence guard", () => {
  test("passes when nothing is missing", () => {
    expect(assessMissingEvidenceGuard(ctx({ missingRequiredEvidence: [] })).kind).toBe(
      "pass",
    );
  });

  test("rejects with a counter-bumping effect set when evidence is missing", () => {
    const outcome = assessMissingEvidenceGuard(
      ctx({ missingRequiredEvidence: ["record_created", "field_set"] }),
    );
    expect(outcome.kind).toBe("reject");
    if (outcome.kind !== "reject") return;
    expect(outcome.guardId).toBe("missing_evidence");
    expect(outcome.reason).toContain("record_created");
    expect(effectTypes(outcome)).toEqual([
      "increment_done_rejections",
      "check_done_rejection_escalation",
      "emit_trace",
      "post_rejection_diagnostic",
    ]);
  });
});

describe("money-table guard", () => {
  test("passes when neither aggregate reason is set", () => {
    expect(assessMoneyTableGuard(ctx()).kind).toBe("pass");
  });

  test("rejects an incomplete scan with the scan trace event", () => {
    const outcome = assessMoneyTableGuard(
      ctx({ moneyTableIncompleteScanReason: "3 of 5 pages scanned" }),
    );
    expect(outcome.kind).toBe("reject");
    if (outcome.kind !== "reject") return;
    expect(outcome.guardId).toBe("money_table");
    const trace = outcome.effects.find((e) => e.type === "emit_trace");
    expect(trace && trace.type === "emit_trace" && trace.event).toBe(
      "done_rejected_incomplete_money_table_scan",
    );
  });
});

describe("early-multistep guard", () => {
  test("passes a single-step request", () => {
    expect(
      assessEarlyMultiStepGuard(ctx({ userRequest: "click the login button" }))
        .kind,
    ).toBe("pass");
  });
});

describe("max-rejections guard", () => {
  test("passes below the cap", () => {
    expect(
      assessMaxRejectionsGuard(ctx({ doneRejections: 2, maxDoneRejections: 3 }))
        .kind,
    ).toBe("pass");
  });

  test("hard-blocks at the cap without bumping the counter", () => {
    const outcome = assessMaxRejectionsGuard(
      ctx({ doneRejections: 3, maxDoneRejections: 3 }),
    );
    expect(outcome.kind).toBe("reject");
    if (outcome.kind !== "reject") return;
    expect(outcome.guardId).toBe("max_rejections");
    // hard gate: only a message, no increment
    expect(effectTypes(outcome)).toEqual(["post_context_message"]);
  });
});
