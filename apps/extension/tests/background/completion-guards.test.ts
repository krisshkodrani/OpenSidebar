import { describe, expect, test } from "vitest";
import "../setup";
import type { CompletionGuardContext } from "../../src/background/agent/completion/guards/context";
import { assessSummaryGuard } from "../../src/background/agent/completion/guards/summary-guards";
import {
  assessMissingEvidenceGuard,
  assessTaskContractGuard,
} from "../../src/background/agent/completion/guards/contract-guards";
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
    missingRequiredEvidence: [],
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
