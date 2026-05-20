import { describe, expect, test } from "vitest";
import "../setup";
import {
  evaluateCompletionEarlyMultiStepPreflight,
  evaluateCompletionGroundingReadPreflight,
  evaluateCompletionListDetailReviewPreflight,
  evaluateCompletionMoneyTableAggregatePreflight,
  evaluateCompletionPendingAutocompletePreflight,
  evaluateCompletionRequiredEvidencePreflight,
  evaluateCompletionSummaryPreflight,
  evaluateCompletionWorkflowContractPreflight,
} from "../../src/background/agent/completion-kernel";
import type { DomSnapshot, TaggedElement } from "../../src/types";

function choice(
  tag: number,
  label: string,
  checked: boolean,
): TaggedElement {
  return {
    tag,
    tagName: "input",
    role: "checkbox",
    text: "on",
    attributes: {
      id: `choice-${tag}`,
      control: `choice-${tag}`,
      name: "answer",
      type: "checkbox",
      checked: String(checked),
      label,
    },
    rect: { x: 0, y: tag * 20, width: 16, height: 16 },
    isVisible: true,
    isDisabled: false,
  };
}

function snapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    title: "Quiz",
    url: "https://example.test/quiz",
    visibleContent:
      "Question 32. Which approaches help adapt a foundation model? (Select two)",
    pageContent:
      "Question 32. Which approaches help adapt a foundation model? (Select two)",
    elements: [
      choice(158, "Domain Adaptation Fine-Tuning", true),
      choice(159, "Continued Pre-Training", true),
      choice(160, "Incremental Learning", false),
    ],
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    ...overrides,
  };
}

function textField(
  tag: number,
  label: string,
  value = "",
  type = "text",
): TaggedElement {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    tag,
    tagName: "input",
    role: "textbox",
    text: value,
    attributes: {
      id: key,
      name: key,
      type,
      value,
      label,
    },
    rect: { x: 0, y: tag * 20, width: 180, height: 24 },
    isVisible: true,
    isDisabled: false,
  };
}

function formSnapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    title: "Profile",
    url: "https://example.test/profile",
    visibleContent: "Profile form",
    pageContent: "Profile form",
    elements: [
      textField(201, "Email Address"),
      textField(202, "Password", "", "password"),
    ],
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    ...overrides,
  };
}

describe("completion kernel preflights", () => {
  test("routes question-shaped done summaries to clarification preflight", () => {
    const decision = evaluateCompletionSummaryPreflight({
      summary: "Which account should I use for this request?",
      taskContext: "Use the requested account to update the form.",
      turnCount: 1,
    });

    expect(decision).toEqual({
      status: "needs_clarification",
      reason: "done_summary_is_question",
    });
  });

  test("rejects incomplete long summaries in summary preflight", () => {
    const decision = evaluateCompletionSummaryPreflight({
      summary:
        "The page summarizes the onboarding process, including account setup, security requirements, approval steps, access review, team ownership, support escalation, audit notes, implementation risks, and",
      taskContext: "Summarize this page and list the key risks.",
      turnCount: 4,
    });

    expect(decision).toMatchObject({
      status: "rejected",
      kind: "incomplete_summary",
      reason: "summary ends with an unfinished phrase",
    });
  });

  test("rejects root multi-return summaries missing a requested result", () => {
    const decision = evaluateCompletionSummaryPreflight({
      summary: "Warehouse Gamma inventory count is 6,412 units.",
      taskContext:
        "From this page, tell me both numbers for Warehouse Gamma and Warehouse Alpha.",
      rootUserRequest:
        "From this page, tell me both numbers for Warehouse Gamma and Warehouse Alpha.",
      turnCount: 4,
    });

    expect(decision).toMatchObject({
      status: "rejected",
      kind: "missing_multi_return_coverage",
      reason: expect.stringContaining("warehouse alpha"),
    });
  });

  test("does not apply root multi-return preflight inside orchestrator nodes", () => {
    const decision = evaluateCompletionSummaryPreflight({
      summary: "Warehouse Gamma inventory count is 6,412 units.",
      taskContext:
        "From this page, tell me both numbers for Warehouse Gamma and Warehouse Alpha.",
      rootUserRequest:
        "From this page, tell me both numbers for Warehouse Gamma and Warehouse Alpha.",
      isOrchestratorNode: true,
      turnCount: 4,
    });

    expect(decision).toEqual({ status: "valid" });
  });

  test("rejects pending autocomplete completion through kernel preflight", () => {
    const snap = formSnapshot({
      visibleContent: "Product autocomplete suggestions Laptop Stand",
      pageContent: "Product autocomplete suggestions Laptop Stand",
      elements: [
        {
          ...textField(201, "Product Search", "Laptop Stand"),
          attributes: {
            id: "product-search",
            name: "product-search",
            value: "Laptop Stand",
            label: "Product Search",
            "aria-autocomplete": "list",
          },
        },
        {
          tag: 202,
          tagName: "li",
          role: "option",
          text: "Laptop Stand",
          attributes: { id: "product-option-laptop-stand" },
          rect: { x: 0, y: 60, width: 180, height: 24 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    });

    const decision = evaluateCompletionPendingAutocompletePreflight({
      snapshot: snap,
      userRequest: "Search for Laptop Stand in the product autocomplete field.",
      summary: "The product search field contains Laptop Stand.",
    });

    expect(decision).toMatchObject({
      status: "rejected",
      kind: "pending_autocomplete_suggestion",
      inputTag: 201,
      suggestionTag: 202,
      value: "laptop stand",
    });
  });

  test("rejects incomplete list-detail review through kernel preflight", () => {
    const decision = evaluateCompletionListDetailReviewPreflight({
      selectedSkillId: "list-detail-review-loop",
      userRequest:
        "Review the job listings and tell me which ones are the best matches for my profile and why.",
      reviewedDetailCount: 2,
      visibleDetailActionCount: 10,
    });

    expect(decision).toMatchObject({
      status: "rejected",
      kind: "incomplete_list_detail_review",
      reason: expect.stringContaining("reviewed 2/10 visible detail pages"),
    });
  });

  test("accepts list-detail review once visible candidates are reviewed", () => {
    const decision = evaluateCompletionListDetailReviewPreflight({
      selectedSkillId: "list-detail-review-loop",
      userRequest:
        "Review the job listings and tell me which ones are the best matches for my profile and why.",
      reviewedDetailCount: 10,
      visibleDetailActionCount: 10,
    });

    expect(decision).toEqual({ status: "valid" });
  });

  test("rejects interim workflow completion through kernel preflight", () => {
    const decision = evaluateCompletionWorkflowContractPreflight({
      userRequest: "Tell me the value shown in the incident chart.",
      summary: "The incident chart page is open and visible.",
      selectedSkillId: "chart-value-extraction",
    });

    expect(decision).toMatchObject({
      blocked: true,
      reason: expect.stringContaining("concrete extracted value"),
    });
  });

  test("accepts completed workflow summaries through kernel preflight", () => {
    const decision = evaluateCompletionWorkflowContractPreflight({
      userRequest: "Tell me the value shown in the incident chart.",
      summary: "The chart value for Critical incidents is 12.",
      selectedSkillId: "chart-value-extraction",
    });

    expect(decision).toEqual({ blocked: false, reason: null });
  });

  test("rejects ungrounded page-read completion through kernel preflight", () => {
    const decision = evaluateCompletionGroundingReadPreflight({
      userRequest: "Summarize this page and report the key points.",
      summary:
        "The page provides a helpful overview with several important points and examples.",
      snapshot: snapshot({
        title: "Transformer Architecture",
        visibleContent:
          "The Transformer architecture uses attention mechanisms, encoder and decoder layers, positional encodings, residual connections, and feed-forward networks to process sequences efficiently.",
        pageContent:
          "The Transformer architecture uses attention mechanisms, encoder and decoder layers, positional encodings, residual connections, and feed-forward networks to process sequences efficiently.",
        elements: [
          choice(201, "Attention", false),
          choice(202, "Encoder", false),
          choice(203, "Decoder", false),
          choice(204, "Residual", false),
          choice(205, "Feed-forward", false),
          choice(206, "Positional", false),
        ],
      }),
      hasReadPage: false,
      hasExplicitPageRead: false,
      hasTaskId: false,
    });

    expect(decision).toMatchObject({
      status: "rejected",
      kind: "missing_grounding_read",
      needsGroundingRead: true,
      elementCount: 6,
    });
  });

  test("allows page-read completion grounded in current snapshot", () => {
    const decision = evaluateCompletionGroundingReadPreflight({
      userRequest: "Summarize this page and report the key points.",
      summary:
        "The page explains Transformer architecture with attention mechanisms, encoder and decoder layers, positional encodings, and feed-forward networks.",
      snapshot: snapshot({
        visibleContent:
          "The Transformer architecture uses attention mechanisms, encoder and decoder layers, positional encodings, residual connections, and feed-forward networks to process sequences efficiently.",
        pageContent:
          "The Transformer architecture uses attention mechanisms, encoder and decoder layers, positional encodings, residual connections, and feed-forward networks to process sequences efficiently.",
        elements: [
          choice(201, "Attention", false),
          choice(202, "Encoder", false),
          choice(203, "Decoder", false),
          choice(204, "Residual", false),
          choice(205, "Feed-forward", false),
          choice(206, "Positional", false),
        ],
      }),
      hasReadPage: false,
      hasExplicitPageRead: false,
      hasTaskId: false,
    });

    expect(decision).toMatchObject({
      status: "grounded_from_snapshot",
      needsGroundingRead: true,
      elementCount: 6,
    });
  });

  test("rejects first early done for explicit multi-step tasks", () => {
    const decision = evaluateCompletionEarlyMultiStepPreflight({
      userRequest:
        "1. Open the account.\n2. Update the status.\n3. Verify the saved result.",
      doneRejections: 0,
      turnCount: 3,
      hasNodeId: false,
    });

    expect(decision).toEqual({
      status: "rejected",
      kind: "early_multi_step",
      stepCount: 3,
    });
  });

  test("allows multi-step done preflight after enough turns or a prior rejection", () => {
    expect(
      evaluateCompletionEarlyMultiStepPreflight({
        userRequest:
          "1. Open the account.\n2. Update the status.\n3. Verify the saved result.",
        doneRejections: 0,
        turnCount: 4,
        hasNodeId: false,
      }),
    ).toEqual({ status: "valid", stepCount: 3 });

    expect(
      evaluateCompletionEarlyMultiStepPreflight({
        userRequest:
          "1. Open the account.\n2. Update the status.\n3. Verify the saved result.",
        doneRejections: 1,
        turnCount: 3,
        hasNodeId: false,
      }),
    ).toEqual({ status: "valid", stepCount: 0 });
  });

  test("rejects incomplete money-table scans before incorrect answer checks", () => {
    const decision = evaluateCompletionMoneyTableAggregatePreflight({
      incompleteScanReason: "The paginated table scan is not exhaustive yet.",
      incorrectAnswerReason: "The final answer conflicts with the aggregate.",
    });

    expect(decision).toEqual({
      status: "rejected",
      kind: "incomplete_money_table_scan",
      reason: "The paginated table scan is not exhaustive yet.",
    });
  });

  test("rejects completed money-table answers that conflict with the aggregate", () => {
    const decision = evaluateCompletionMoneyTableAggregatePreflight({
      incorrectAnswerReason: "The final answer conflicts with the aggregate.",
    });

    expect(decision).toEqual({
      status: "rejected",
      kind: "incorrect_money_table_answer",
      reason: "The final answer conflicts with the aggregate.",
    });
  });

  test("accepts money-table aggregate completion when no rejection reason exists", () => {
    expect(evaluateCompletionMoneyTableAggregatePreflight({})).toEqual({
      status: "valid",
    });
  });

  test("rejects missing required typed evidence through kernel preflight", () => {
    const decision = evaluateCompletionRequiredEvidencePreflight({
      missingRequiredEvidence: [
        "navigation_reached",
        "goal_state_verified",
      ],
    });

    expect(decision).toEqual({
      status: "rejected",
      kind: "missing_required_evidence",
      missingRequiredEvidence: [
        "navigation_reached",
        "goal_state_verified",
      ],
    });
  });

  test("accepts required evidence preflight when no evidence is missing", () => {
    expect(
      evaluateCompletionRequiredEvidencePreflight({
        missingRequiredEvidence: [],
      }),
    ).toEqual({ status: "valid" });
  });
});
