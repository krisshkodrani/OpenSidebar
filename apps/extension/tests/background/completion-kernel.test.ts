import { describe, expect, test } from "vitest";
import "../setup";
import {
  CompletionEvidenceLedger,
  buildCompletionEnvelope,
  buildCompletionRecoveryHint,
  buildTrustedReadAnswerCompletionCandidate,
  deriveCompletionEvidenceFromSnapshot,
  deriveCompletionEvidenceFromToolOutcome,
  evaluateCompletionContract,
  evaluateCompletionEarlyMultiStepPreflight,
  evaluateCompletionGroundingReadPreflight,
  evaluateCompletionListDetailReviewPreflight,
  evaluateCompletionMoneyTableAggregatePreflight,
  evaluateCompletionPendingAutocompletePreflight,
  evaluateCompletionRequiredEvidencePreflight,
  evaluateCompletionSummaryPreflight,
  evaluateCompletionWorkflowContractPreflight,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import { ToolName, type DomSnapshot, type TaggedElement } from "../../src/types";

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

function checkboxField(
  tag: number,
  label: string,
  checked: boolean,
): TaggedElement {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    tag,
    tagName: "input",
    role: "checkbox",
    text: "",
    attributes: {
      id: key,
      control: key,
      name: key,
      type: "checkbox",
      checked: String(checked),
      label,
    },
    rect: { x: 0, y: tag * 20, width: 16, height: 16 },
    isVisible: true,
    isDisabled: false,
  };
}

function formSnapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    title: "Profile",
    url: "https://example.test/profile",
    visibleContent: "Profile form Email Address Password Remember me",
    pageContent: "Profile form Email Address Password Remember me",
    elements: [
      textField(201, "Email Address"),
      textField(202, "Password", "", "password"),
      checkboxField(203, "Remember me", false),
    ],
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    ...overrides,
  };
}

function navigationSnapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    title: "Documentation",
    url: "https://docs.example.test/getting-started",
    visibleContent: "Documentation Getting started",
    pageContent: "Documentation Getting started",
    elements: [],
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    ...overrides,
  };
}

function draftSnapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    title: "Email thread",
    url: "https://mail.example.test/thread/123",
    visibleContent: "Email thread Reply message",
    pageContent: "Email thread Reply message",
    elements: [
      {
        ...textField(
          301,
          "Reply message",
          "Hi David, Monday at 2 PM works for me.",
        ),
        tagName: "textarea",
        attributes: {
          id: "reply-message",
          name: "reply-message",
          label: "Reply message",
          value: "Hi David, Monday at 2 PM works for me.",
        },
      },
    ],
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    ...overrides,
  };
}

function workflowSnapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    title: "Account Settings",
    url: "https://example.test/account",
    visibleContent: "Account settings",
    pageContent: "Account settings",
    elements: [],
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    ...overrides,
  };
}

function modalSnapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return workflowSnapshot({
    title: "Newsletter",
    visibleContent: "Newsletter popup Stay updated Close",
    pageContent: "Newsletter popup Stay updated Close",
    elements: [
      {
        tag: 401,
        tagName: "div",
        role: "dialog",
        text: "Newsletter popup Stay updated",
        attributes: {
          id: "newsletter-modal",
          "aria-modal": "true",
          "aria-label": "Newsletter popup",
        },
        rect: { x: 120, y: 80, width: 420, height: 260 },
        isVisible: true,
        isDisabled: false,
      },
      {
        tag: 402,
        tagName: "button",
        role: "button",
        text: "Close",
        attributes: {
          id: "close-newsletter",
          "aria-label": "Close newsletter popup",
        },
        rect: { x: 500, y: 90, width: 32, height: 32 },
        isVisible: true,
        isDisabled: false,
      },
    ],
    ...overrides,
  });
}

function deleteButton(tag: number, target: string): TaggedElement {
  const key = target.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    tag,
    tagName: "button",
    role: "button",
    text: `Delete ${target}`,
    attributes: {
      id: `delete-${key}`,
      "aria-label": `Delete ${target}`,
    },
    rect: { x: 500, y: tag * 20, width: 120, height: 32 },
    isVisible: true,
    isDisabled: false,
  };
}

function actionButton(tag: number, label: string): TaggedElement {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    tag,
    tagName: "button",
    role: "button",
    text: label,
    attributes: {
      id: key,
      "aria-label": label,
    },
    rect: { x: 500, y: tag * 20, width: 120, height: 32 },
    isVisible: true,
    isDisabled: false,
  };
}

function stableActionButton(
  tag: number,
  label: string,
  id: string,
): TaggedElement {
  return {
    ...actionButton(tag, label),
    attributes: {
      id,
      "aria-label": label,
    },
  };
}

function statefulActionButton(
  tag: number,
  label: string,
  pressed: boolean,
  id: string,
): TaggedElement {
  return {
    ...stableActionButton(tag, label, id),
    attributes: {
      id,
      "aria-label": label,
      "aria-pressed": String(pressed),
    },
  };
}

describe("completion kernel", () => {
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

  test("repairs stale planner quiz target to the current visible question", () => {
    const generated = generateCompletionContract({
      userRequest: "Select the correct option/s",
      activeObjective:
        "Read the current quiz question and select the correct answer(s) for Question 31",
      snapshot: snapshot(),
    });

    expect(generated?.contract).toMatchObject({
      kind: "quiz_selection",
      target: { kind: "current_visible_question", questionNumber: 32 },
      requiresSubmit: false,
      requiresCorrectFeedback: false,
      selectionCardinality: 2,
    });
    expect(generated?.notes.join("\n")).toContain("Question 31");
  });

  test("uses embedded original request instead of stale planner verification text", () => {
    const snap = snapshot();
    const generated = generateCompletionContract({
      userRequest: [
        "Objective: Complete the workflow for the original request: Select the correct option/s",
        "Read the current quiz question and select the correct answer(s) for Question 31",
        "Success criteria: The task is fully completed and verified.",
        "",
        "Original user request (reference for specific values - names, emails, codes): Select the correct option/s Stay focused on this goal.",
        "## Page Context",
        "Question 32 / 40",
      ].join("\n"),
      activeObjective:
        "Read the current quiz question and select the correct answer(s) for Question 31",
      successCriteria: "Question 31 has the correct answer options selected",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 3);
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "Selected Domain Adaptation Fine-Tuning and Continued Pre-Training.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "quiz_selection",
      target: { kind: "current_visible_question", questionNumber: 32 },
      requiresSubmit: false,
      requiresCorrectFeedback: false,
    });
    expect(generated?.notes.join("\n")).toContain("Question 31");
    expect(decision.status).toBe("accepted");
    expect(buildCompletionRecoveryHint(decision)).toContain(
      "Completion evidence indicates",
    );
  });

  test("accepts select-only quiz completion from active selected-state evidence", () => {
    const snap = snapshot();
    const generated = generateCompletionContract({
      userRequest: "Select the correct option/s",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 3);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "Selected Domain Adaptation Fine-Tuning and Continued Pre-Training.",
    });

    expect(decision.status).toBe("accepted");
    expect(decision.reason).toContain("select-only");
  });

  test("requires verification when the request asks to check the answer", () => {
    const snap = snapshot();
    const generated = generateCompletionContract({
      userRequest: "Check the answer",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 3),
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "Selected Domain Adaptation Fine-Tuning and Continued Pre-Training.",
    });

    expect(decision.status).toBe("needs_verification");
    expect(buildCompletionRecoveryHint(decision)).toContain("Check answer");
  });

  test("latest selected-state evidence wins when an option is later deselected", () => {
    const ledger = new CompletionEvidenceLedger();
    const selected = deriveCompletionEvidenceFromSnapshot(snapshot(), 5).find(
      (event) =>
        event.type === "selected_state" &&
        event.detail.label.includes("Domain Adaptation"),
    );
    const deselected = {
      ...selected!,
      observedAtTurn: 7,
      detail: { ...selected!.detail, checked: false },
    };

    expect(ledger.add(selected!)).toBe(true);
    expect(ledger.add(deselected)).toBe(true);

    expect(
      ledger
        .toArray()
        .find(
          (event) =>
            event.type === "selected_state" &&
            event.detail.label.includes("Domain Adaptation"),
        ),
    ).toMatchObject({
      observedAtTurn: 7,
      detail: { checked: false },
    });
  });

  test("same-turn stale snapshot evidence does not overwrite high-confidence tool evidence", () => {
    const ledger = new CompletionEvidenceLedger();
    const staleSnapshotEvidence = deriveCompletionEvidenceFromSnapshot(
      snapshot({
        elements: [
          choice(158, "Domain Adaptation Fine-Tuning", false),
          choice(159, "Continued Pre-Training", false),
        ],
      }),
      6,
    ).find(
      (event) =>
        event.type === "selected_state" &&
        event.detail.label.includes("Domain Adaptation"),
    );
    const toolEvidence = {
      ...staleSnapshotEvidence!,
      confidence: "high" as const,
      detail: { ...staleSnapshotEvidence!.detail, checked: true },
    };

    expect(ledger.add(toolEvidence)).toBe(true);
    expect(ledger.add(staleSnapshotEvidence!)).toBe(false);

    expect(
      ledger
        .toArray()
        .find(
          (event) =>
            event.type === "selected_state" &&
            event.detail.label.includes("Domain Adaptation"),
        ),
    ).toMatchObject({
      confidence: "high",
      detail: { checked: true },
    });
  });

  test("generates a form-fill contract from explicit field values", () => {
    const generated = generateCompletionContract({
      userRequest:
        "Fill the profile form with email admin@example.com and password secret123. Check the Remember me box too.",
      snapshot: formSnapshot(),
    });

    expect(generated?.contract).toMatchObject({
      kind: "form_fill",
      requiresSubmit: false,
      requiresConfirmation: false,
      requiredFields: [
        { label: "Email Address", value: "admin@example.com" },
        { label: "Password", value: "secret123" },
        { label: "Remember me", value: "true" },
      ],
    });
  });

  test("accepts form-fill completion from high-confidence tool evidence", () => {
    const snap = formSnapshot();
    const generated = generateCompletionContract({
      userRequest:
        "Fill the profile form with email admin@example.com and password secret123. Check the Remember me box too.",
      snapshot: snap,
    });
    const evidence = [
      ...deriveCompletionEvidenceFromToolOutcome({
        toolName: ToolName.TYPE_TEXT,
        args: { id: 201, text: "admin@example.com" },
        result: "Typed text.",
        preActionSnapshot: snap,
        turn: 4,
      }),
      ...deriveCompletionEvidenceFromToolOutcome({
        toolName: ToolName.TYPE_TEXT,
        args: { id: 202, text: "secret123" },
        result: "Typed text.",
        preActionSnapshot: snap,
        turn: 4,
      }),
      ...deriveCompletionEvidenceFromToolOutcome({
        toolName: ToolName.SET_CHECKBOX,
        args: { id: 203, checked: true },
        result: "Set checkbox.",
        preActionSnapshot: snap,
        turn: 4,
      }),
    ];

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Filled email, password, and Remember me.",
    });

    expect(decision.status).toBe("accepted");
    expect(buildCompletionRecoveryHint(decision)).toContain("form fields");
  });

  test("rejects form-fill completion while a required autocomplete suggestion is still pending", () => {
    const snap = formSnapshot({
      visibleContent: "Caller Type to search suggestions Joe Employee",
      pageContent: "Caller Type to search suggestions Joe Employee",
      elements: [
        {
          ...textField(201, "Caller", "Joe Employee"),
          attributes: {
            id: "caller",
            name: "caller",
            value: "Joe Employee",
            label: "Caller",
            "aria-autocomplete": "list",
          },
        },
        {
          tag: 202,
          tagName: "li",
          role: "option",
          text: "Joe Employee",
          attributes: { id: "caller-option-joe" },
          rect: { x: 0, y: 60, width: 180, height: 24 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    });
    const generated = generateCompletionContract({
      userRequest: 'Caller = "Joe Employee".',
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 5);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Filled Caller with Joe Employee.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "form_fill",
      requiredFields: [{ label: "Caller", value: "Joe Employee" }],
    });
    expect(decision.status).toBe("rejected");
    expect(decision.reason).toContain("autocomplete suggestion");
    expect(decision.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "validation_error",
          logicalKey: "form:autocomplete_pending:joe-employee",
          detail: expect.objectContaining({
            inputElementId: 201,
            suggestionElementId: 202,
            value: "joe employee",
          }),
        }),
      ]),
    );
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

  test("accepts form-fill completion when autocomplete selection confirmation is visible", () => {
    const snap = formSnapshot({
      visibleContent:
        "Caller Type to search suggestions Joe Employee Selected: Joe Employee",
      pageContent:
        "Caller Type to search suggestions Joe Employee Selected: Joe Employee",
      elements: [
        {
          ...textField(201, "Caller", "Joe Employee"),
          attributes: {
            id: "caller",
            name: "caller",
            value: "Joe Employee",
            label: "Caller",
            "aria-autocomplete": "list",
          },
        },
        {
          tag: 202,
          tagName: "li",
          role: "option",
          text: "Joe Employee",
          attributes: { id: "caller-option-joe" },
          rect: { x: 0, y: 60, width: 180, height: 24 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    });
    const generated = generateCompletionContract({
      userRequest: 'Caller = "Joe Employee".',
      snapshot: snap,
    });

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 5),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Selected Joe Employee in the Caller field.",
    });

    expect(decision.status).toBe("accepted");
  });

  test("requires verification when a form request implies submit", () => {
    const snap = formSnapshot();
    const generated = generateCompletionContract({
      userRequest:
        "Log in with email admin@example.com and password secret123. Check the Remember me box too.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(
      formSnapshot({
        elements: [
          textField(201, "Email Address", "admin@example.com"),
          textField(202, "Password", "secret123", "password"),
          checkboxField(203, "Remember me", true),
        ],
      }),
      5,
    );

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Filled email, password, and Remember me.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "form_fill",
      requiresSubmit: true,
    });
    expect(decision.status).toBe("needs_verification");
    expect(buildCompletionRecoveryHint(decision)).toContain("Submit");
  });

  test("accepts submit-required form completion after visible confirmation", () => {
    const snap = formSnapshot();
    const generated = generateCompletionContract({
      userRequest:
        "Log in with email admin@example.com and password secret123. Check the Remember me box too.",
      snapshot: snap,
    });
    const filledEvidence = deriveCompletionEvidenceFromSnapshot(
      formSnapshot({
        elements: [
          textField(201, "Email Address", "admin@example.com"),
          textField(202, "Password", "secret123", "password"),
          checkboxField(203, "Remember me", true),
        ],
      }),
      5,
    );
    const confirmationEvidence = deriveCompletionEvidenceFromSnapshot(
      formSnapshot({
        title: "Submission Complete",
        url: "https://example.test/profile/confirmation",
        visibleContent:
          "Submission Complete! Reference Number REF-20481. Your request has been submitted successfully.",
        pageContent:
          "Submission Complete! Reference Number REF-20481. Your request has been submitted successfully.",
        elements: [],
      }),
      6,
    );

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: [...filledEvidence, ...confirmationEvidence],
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Submitted the profile form and reached confirmation REF-20481.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "form_fill",
      requiresConfirmation: true,
    });
    expect(confirmationEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "form:confirmation",
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("does not treat a reference-number field label as confirmation", () => {
    const evidence = deriveCompletionEvidenceFromSnapshot(
      formSnapshot({
        visibleContent: "Profile form Reference Number",
        pageContent: "Profile form Reference Number",
        elements: [textField(204, "Reference Number", "REF-20481")],
      }),
      6,
    );

    expect(
      evidence.some(
        (event) =>
          event.type === "confirmation_state" &&
          event.logicalKey === "form:confirmation",
      ),
    ).toBe(false);
  });

  test("accepts workflow confirmation after visible delete success", () => {
    const snap = workflowSnapshot({
      visibleContent: "Account deleted successfully.",
      pageContent: "Account deleted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Delete the account and confirm it is gone.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Deleted the account successfully.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "delete",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:delete",
          detail: expect.objectContaining({ action: "delete" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts delete-class workflow confirmation after visible delete completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Delete completed.",
      pageContent: "Delete completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Delete the account.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Delete completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "delete",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:delete",
          detail: expect.objectContaining({ action: "delete" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts archive-class workflow confirmation after visible archive completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Archive completed.",
      pageContent: "Archive completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Archive the report.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Archive completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "archive",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:archive",
          detail: expect.objectContaining({ action: "archive" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts target-aware visible delete confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Warehouse Beta remains visible. Warehouse Alpha deleted successfully.",
      pageContent:
        "Warehouse Beta remains visible. Warehouse Alpha deleted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Delete Warehouse Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Deleted Warehouse Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "delete",
      targetLabel: "Warehouse Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:delete",
          detail: expect.objectContaining({
            action: "delete",
            source: "visible_text",
            text: "Warehouse Alpha deleted successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible delete confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Warehouse Alpha remains visible. Warehouse Beta deleted successfully.",
      pageContent:
        "Warehouse Alpha remains visible. Warehouse Beta deleted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Delete Warehouse Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Deleted Warehouse Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "delete",
      targetLabel: "Warehouse Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:delete",
          detail: expect.objectContaining({
            action: "delete",
            source: "visible_text",
            text: "Warehouse Beta deleted successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("keeps generic visible delete completion valid for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Delete completed.",
      pageContent: "Delete completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Delete Warehouse Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Delete completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "delete",
      targetLabel: "Warehouse Alpha",
    });
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible archive confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Report Alpha remains visible. Report Beta archived successfully.",
      pageContent:
        "Report Alpha remains visible. Report Beta archived successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Archive Report Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Archived Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "archive",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:archive",
          detail: expect.objectContaining({
            action: "archive",
            source: "visible_text",
            text: "Report Beta archived successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts submit-class workflow confirmation after visible submit completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Submit completed.",
      pageContent: "Submit completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Submit the request.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Submit completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "submit",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:submit",
          detail: expect.objectContaining({ action: "submit" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts send-class workflow confirmation after visible send completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Send completed.",
      pageContent: "Send completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Send the message.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Send completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "send",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:send",
          detail: expect.objectContaining({ action: "send" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts post-class workflow confirmation after visible publish completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Publish completed.",
      pageContent: "Publish completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Publish the announcement.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Publish completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "post",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:post",
          detail: expect.objectContaining({ action: "post" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts save-class workflow confirmation after visible save completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Save completed.",
      pageContent: "Save completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Save the settings.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Save completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "save",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:save",
          detail: expect.objectContaining({ action: "save" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts update-class workflow confirmation after visible update completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Update completed.",
      pageContent: "Update completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Update the settings.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Update completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "update",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:update",
          detail: expect.objectContaining({ action: "update" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts restart-class workflow confirmation after visible restart success", () => {
    const snap = workflowSnapshot({
      visibleContent: "Service restarted successfully.",
      pageContent: "Service restarted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Restart the service.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Restarted the service successfully.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "restart",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:restart",
          detail: expect.objectContaining({ action: "restart" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts restart-class workflow confirmation after visible restart completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Restart completed.",
      pageContent: "Restart completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Restart the workflow.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Restart completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "restart",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:restart",
          detail: expect.objectContaining({ action: "restart" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts refresh-class workflow confirmation after visible refresh success", () => {
    const snap = workflowSnapshot({
      visibleContent: "Report refreshed successfully.",
      pageContent: "Report refreshed successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Refresh the report.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Refreshed the report successfully.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "refresh",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:refresh",
          detail: expect.objectContaining({ action: "refresh" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts refresh-class workflow confirmation after visible refresh completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Refresh completed.",
      pageContent: "Refresh completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Refresh the dashboard.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Refresh completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "refresh",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:refresh",
          detail: expect.objectContaining({ action: "refresh" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts reject-class workflow confirmation after visible denial success", () => {
    const snap = workflowSnapshot({
      visibleContent: "Request denied successfully.",
      pageContent: "Request denied successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Deny the request.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Denied the request successfully.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reject",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:reject",
          detail: expect.objectContaining({ action: "reject" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts approve-class workflow confirmation after visible approval completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Approval completed.",
      pageContent: "Approval completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Approve the request.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Approval completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:approve",
          detail: expect.objectContaining({ action: "approve" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts reject-class workflow confirmation after visible rejection completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Rejection completed.",
      pageContent: "Rejection completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Reject the request.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Rejection completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reject",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:reject",
          detail: expect.objectContaining({ action: "reject" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts approve-class workflow confirmation with successful noun summary", () => {
    const snap = workflowSnapshot({
      visibleContent: "Approval successful.",
      pageContent: "Approval successful.",
    });
    const generated = generateCompletionContract({
      userRequest: "Approve the request.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Approval successful.",
    });

    expect(decision.status).toBe("accepted");
  });

  test("accepts reject-class status change with denial successful wording", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request REQ003 Status: Pending Deny request",
      pageContent: "Request REQ003 Status: Pending Deny request",
      elements: [actionButton(604, "Deny request")],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ003 Status: Denial successful",
      pageContent: "Request REQ003 Status: Denial successful",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Deny the request.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 604 },
      result: "Clicked element 604.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 12,
    });

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Denial successful.",
    });

    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        logicalKey: "workflow:confirmation:reject:status:status-denial-successful",
        detail: expect.objectContaining({
          action: "reject",
          source: "status_change",
          text: "Status: Denial successful",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts close-class workflow confirmation after visible resolution success", () => {
    const snap = workflowSnapshot({
      visibleContent: "Incident resolved successfully.",
      pageContent: "Incident resolved successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Resolve the incident.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Resolved the incident successfully.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "close",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:close",
          detail: expect.objectContaining({ action: "close" }),
        }),
      ]),
    );
    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:dismiss",
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts close-class workflow confirmation after visible close completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Close completed.",
      pageContent: "Close completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Close the incident.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Close completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "close",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:close",
          detail: expect.objectContaining({ action: "close" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts target-aware visible close confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Incident Beta remains open. Incident Alpha closed successfully.",
      pageContent:
        "Incident Beta remains open. Incident Alpha closed successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Close Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Closed Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "close",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:close",
          detail: expect.objectContaining({
            action: "close",
            source: "visible_text",
            text: "Incident Alpha closed successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible close confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Incident Alpha remains open. Incident Beta closed successfully.",
      pageContent:
        "Incident Alpha remains open. Incident Beta closed successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Close Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Closed Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "close",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:close",
          detail: expect.objectContaining({
            action: "close",
            source: "visible_text",
            text: "Incident Beta closed successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("keeps generic visible close completion valid for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Close completed.",
      pageContent: "Close completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Close Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Close completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "close",
      targetLabel: "Incident Alpha",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts target-aware visible reopen confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Incident Beta remains closed. Incident Alpha reopened successfully.",
      pageContent:
        "Incident Beta remains closed. Incident Alpha reopened successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Reopen Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Reopened Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reopen",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:reopen",
          detail: expect.objectContaining({
            action: "reopen",
            source: "visible_text",
            text: "Incident Alpha reopened successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible reopen confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Incident Alpha remains closed. Incident Beta reopened successfully.",
      pageContent:
        "Incident Alpha remains closed. Incident Beta reopened successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Reopen Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Reopened Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reopen",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:reopen",
          detail: expect.objectContaining({
            action: "reopen",
            source: "visible_text",
            text: "Incident Beta reopened successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("keeps generic visible reopen completion valid for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Reopen completed.",
      pageContent: "Reopen completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Reopen Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Reopen completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reopen",
      targetLabel: "Incident Alpha",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts cancel-class workflow confirmation after visible cancellation completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Cancellation completed.",
      pageContent: "Cancellation completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Cancel the order.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Cancellation completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "cancel",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:cancel",
          detail: expect.objectContaining({ action: "cancel" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts target-aware visible cancel confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Order Beta remains active. Order Alpha canceled successfully.",
      pageContent: "Order Beta remains active. Order Alpha canceled successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Cancel Order Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Canceled Order Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "cancel",
      targetLabel: "Order Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:cancel",
          detail: expect.objectContaining({
            action: "cancel",
            source: "visible_text",
            text: "Order Alpha canceled successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible cancel confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Order Alpha remains active. Order Beta canceled successfully.",
      pageContent: "Order Alpha remains active. Order Beta canceled successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Cancel Order Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Canceled Order Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "cancel",
      targetLabel: "Order Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:cancel",
          detail: expect.objectContaining({
            action: "cancel",
            source: "visible_text",
            text: "Order Beta canceled successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("keeps generic visible cancellation completion valid for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Cancellation completed.",
      pageContent: "Cancellation completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Cancel Order Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Cancellation completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "cancel",
      targetLabel: "Order Alpha",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts dismiss-class workflow confirmation after visible dismiss completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Dismiss completed.",
      pageContent: "Dismiss completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Dismiss the popup.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Dismiss completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "dismiss",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:dismiss",
          detail: expect.objectContaining({ action: "dismiss" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("requires verification for workflow confirmation without visible success", () => {
    const snap = workflowSnapshot();
    const generated = generateCompletionContract({
      userRequest: "Delete the account and confirm it is gone.",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 7),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Deleted the account successfully.",
    });

    expect(decision.status).toBe("needs_verification");
    expect(buildCompletionRecoveryHint(decision)).toContain("Verify");
  });

  test("does not generate workflow confirmation contracts for browser tab management", () => {
    const generated = generateCompletionContract({
      userRequest: "Close the current tab quickly.",
      snapshot: workflowSnapshot(),
    });

    expect(generated).toBeNull();
  });

  test("does not accept workflow confirmation when summary names the wrong action", () => {
    const snap = workflowSnapshot({
      visibleContent: "Account deleted successfully.",
      pageContent: "Account deleted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Delete the account and confirm it is gone.",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 7),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Saved the account settings.",
    });

    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept workflow confirmation when summary negates the action", () => {
    const snap = workflowSnapshot({
      visibleContent: "Account deleted successfully.",
      pageContent: "Account deleted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Delete the account and confirm it is gone.",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 7),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "The account was not deleted.",
    });

    expect(decision.status).toBe("inconclusive");
  });

  test("does not infer visible workflow confirmation from negated success wording", () => {
    const snap = workflowSnapshot({
      visibleContent: "Account was not deleted successfully.",
      pageContent: "Account was not deleted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Delete the account and confirm it is gone.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Deleted the account successfully.",
    });

    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:delete",
        }),
      ]),
    );
    expect(decision.status).toBe("needs_verification");
  });

  test("does not treat unrelated no wording as workflow negation", () => {
    const snap = workflowSnapshot({
      visibleContent: "No errors. Account deleted successfully.",
      pageContent: "No errors. Account deleted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Delete the account and confirm it is gone.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "No errors. Deleted the account successfully.",
    });

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:delete",
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts modal dismissal from pre/post dialog disappearance evidence", () => {
    const pre = modalSnapshot();
    const current = workflowSnapshot({
      title: "Newsletter",
      visibleContent: "Account settings",
      pageContent: "Account settings",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Close the newsletter popup.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 402 },
      result: "Clicked element 402.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 8,
    });

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Closed the newsletter popup.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "dismiss",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: expect.stringContaining("workflow:confirmation:dismiss"),
        detail: expect.objectContaining({
          action: "dismiss",
          source: "modal_disappearance",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("treats cancel-dialog requests as modal dismissal, not workflow cancellation", () => {
    const pre = modalSnapshot();
    const current = workflowSnapshot({
      title: "Newsletter",
      visibleContent: "Account settings",
      pageContent: "Account settings",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Cancel the newsletter dialog.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 402 },
      result: "Clicked element 402.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 8,
    });

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Canceled the newsletter dialog.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "dismiss",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        detail: expect.objectContaining({
          action: "dismiss",
          source: "modal_disappearance",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not treat modal disappearance during navigation as dismissal evidence", () => {
    const pre = modalSnapshot();
    const current = workflowSnapshot({
      url: "https://example.test/next",
      visibleContent: "Next page",
      pageContent: "Next page",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 402 },
      result: "Clicked element 402.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 8,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer modal dismissal from a standalone close button", () => {
    const pre = workflowSnapshot({
      visibleContent: "Newsletter controls Close popup",
      pageContent: "Newsletter controls Close popup",
      elements: [
        {
          tag: 402,
          tagName: "button",
          role: "button",
          text: "Close",
          attributes: {
            id: "close-newsletter-popup",
            "aria-label": "Close newsletter popup",
          },
          rect: { x: 500, y: 90, width: 32, height: 32 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Newsletter controls",
      pageContent: "Newsletter controls",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 402 },
      result: "Clicked element 402.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 8,
    });

    expect(evidence).toEqual([]);
  });

  test("does not generate modal dismissal contracts for compound follow-up work", () => {
    const generated = generateCompletionContract({
      userRequest:
        "Dismiss the newsletter popup, then fill in the email field.",
      snapshot: modalSnapshot(),
    });

    expect(generated).toBeNull();
  });

  test("does not accept close-record workflows from modal disappearance", () => {
    const pre = modalSnapshot();
    const current = workflowSnapshot({
      title: "Incident",
      visibleContent: "Incident form",
      pageContent: "Incident form",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Close the incident record.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 402 },
      result: "Clicked element 402.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 8,
    });

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Closed the incident record.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "close",
    });
    expect(decision.status).toBe("needs_verification");
  });

  test("accepts delete confirmation from named target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Accounts Warehouse Alpha Delete Warehouse Alpha Warehouse Beta Delete Warehouse Beta",
      pageContent:
        "Accounts Warehouse Alpha Delete Warehouse Alpha Warehouse Beta Delete Warehouse Beta",
      elements: [
        deleteButton(501, "Warehouse Alpha"),
        deleteButton(502, "Warehouse Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Accounts Warehouse Beta Delete Warehouse Beta",
      pageContent: "Accounts Warehouse Beta Delete Warehouse Beta",
      elements: [deleteButton(502, "Warehouse Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Delete Warehouse Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 501 },
      result: "Clicked element 501.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Deleted Warehouse Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "delete",
      targetLabel: "Warehouse Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:delete:warehouse-alpha",
        detail: expect.objectContaining({
          action: "delete",
          source: "target_disappearance",
          text: "Deleted target no longer visible: Warehouse Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects delete target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Accounts Warehouse Alpha Delete Warehouse Alpha Warehouse Beta Delete Warehouse Beta",
      pageContent:
        "Accounts Warehouse Alpha Delete Warehouse Alpha Warehouse Beta Delete Warehouse Beta",
      elements: [
        deleteButton(501, "Warehouse Alpha"),
        deleteButton(502, "Warehouse Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Accounts Warehouse Alpha Delete Warehouse Alpha",
      pageContent: "Accounts Warehouse Alpha Delete Warehouse Alpha",
      elements: [deleteButton(501, "Warehouse Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Delete Warehouse Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 502 },
      result: "Clicked element 502.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Deleted Warehouse Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "delete",
      targetLabel: "Warehouse Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:delete:warehouse-beta",
        detail: expect.objectContaining({
          action: "delete",
          source: "target_disappearance",
          text: "Deleted target no longer visible: Warehouse Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer delete confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Accounts Warehouse Alpha Delete Warehouse Alpha",
      pageContent: "Accounts Warehouse Alpha Delete Warehouse Alpha",
      elements: [deleteButton(501, "Warehouse Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Accounts Warehouse Alpha Delete Warehouse Alpha",
      pageContent: "Accounts Warehouse Alpha Delete Warehouse Alpha",
      elements: [deleteButton(501, "Warehouse Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 501 },
      result: "Clicked element 501.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer delete confirmation from a generic delete button", () => {
    const genericDeleteButton: TaggedElement = {
      tag: 501,
      tagName: "button",
      role: "button",
      text: "Delete",
      attributes: {
        id: "delete",
        "aria-label": "Delete",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Accounts Warehouse Alpha Delete",
      pageContent: "Accounts Warehouse Alpha Delete",
      elements: [genericDeleteButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Accounts",
      pageContent: "Accounts",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 501 },
      result: "Clicked element 501.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts archive confirmation from named target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Reports Report Alpha Archive Report Alpha Report Beta Archive Report Beta",
      pageContent:
        "Reports Report Alpha Archive Report Alpha Report Beta Archive Report Beta",
      elements: [
        actionButton(503, "Archive Report Alpha"),
        actionButton(504, "Archive Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Reports Report Beta Archive Report Beta",
      pageContent: "Reports Report Beta Archive Report Beta",
      elements: [actionButton(504, "Archive Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Archive Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 503 },
      result: "Clicked element 503.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Archived Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "archive",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:archive:report-alpha",
        detail: expect.objectContaining({
          action: "archive",
          source: "target_disappearance",
          text: "Archived target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects archive target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Reports Report Alpha Archive Report Alpha Report Beta Archive Report Beta",
      pageContent:
        "Reports Report Alpha Archive Report Alpha Report Beta Archive Report Beta",
      elements: [
        actionButton(503, "Archive Report Alpha"),
        actionButton(504, "Archive Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Reports Report Alpha Archive Report Alpha",
      pageContent: "Reports Report Alpha Archive Report Alpha",
      elements: [actionButton(503, "Archive Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Archive Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Archived Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "archive",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:archive:report-beta",
        detail: expect.objectContaining({
          action: "archive",
          source: "target_disappearance",
          text: "Archived target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer archive confirmation from a generic archive button", () => {
    const genericArchiveButton: TaggedElement = {
      tag: 503,
      tagName: "button",
      role: "button",
      text: "Archive",
      attributes: {
        id: "archive",
        "aria-label": "Archive",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Reports Report Alpha Archive",
      pageContent: "Reports Report Alpha Archive",
      elements: [genericArchiveButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Reports",
      pageContent: "Reports",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 503 },
      result: "Clicked element 503.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts send confirmation from draft disappearance", () => {
    const pre = draftSnapshot({
      visibleContent: "Email thread Reply message Send reply",
      pageContent: "Email thread Reply message Send reply",
      elements: [
        ...(draftSnapshot().elements ?? []),
        actionButton(302, "Send reply"),
      ],
    });
    const current = draftSnapshot({
      visibleContent: "Email thread",
      pageContent: "Email thread",
      elements: [actionButton(302, "Send reply")],
    });
    const generated = generateCompletionContract({
      userRequest: "Send the reply.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 302 },
      result: "Clicked element 302.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 10,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Sent the reply.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "send",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:send:draft:reply-message",
        detail: expect.objectContaining({
          action: "send",
          source: "draft_disappearance",
          text: "Sent draft no longer visible: Reply message",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer send confirmation while draft text remains visible", () => {
    const pre = draftSnapshot({
      elements: [
        ...(draftSnapshot().elements ?? []),
        actionButton(302, "Send reply"),
      ],
    });
    const current = draftSnapshot({
      elements: [
        ...(draftSnapshot().elements ?? []),
        actionButton(302, "Send reply"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 302 },
      result: "Clicked element 302.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 10,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer draft submission from a generic submit button", () => {
    const pre = draftSnapshot({
      elements: [
        ...(draftSnapshot().elements ?? []),
        actionButton(302, "Submit"),
      ],
    });
    const current = draftSnapshot({
      visibleContent: "Email thread",
      pageContent: "Email thread",
      elements: [actionButton(302, "Submit")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 302 },
      result: "Clicked element 302.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 10,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts approve confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request REQ001 Status: Awaiting approval Approve request",
      pageContent: "Request REQ001 Status: Awaiting approval Approve request",
      elements: [actionButton(601, "Approve request")],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ001 Status: Approved",
      pageContent: "Request REQ001 Status: Approved",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Approve the request.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 601 },
      result: "Clicked element 601.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Approved the request.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:approve:status:status-approved",
        detail: expect.objectContaining({
          action: "approve",
          source: "status_change",
          text: "Status: Approved",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer status-change confirmation when status was already final", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request REQ001 Status: Approved Approve request",
      pageContent: "Request REQ001 Status: Approved Approve request",
      elements: [actionButton(601, "Approve request")],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ001 Status: Approved",
      pageContent: "Request REQ001 Status: Approved",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 601 },
      result: "Clicked element 601.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts approve confirmation from same-control label change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request REQ001 Awaiting approval Approve request",
      pageContent: "Request REQ001 Awaiting approval Approve request",
      elements: [
        stableActionButton(607, "Approve request", "request-approval-action"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ001 Approved",
      pageContent: "Request REQ001 Approved",
      elements: [
        stableActionButton(607, "Approved", "request-approval-action"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Approve the request.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 607 },
      result: "Clicked element 607.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Approved the request.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:approve:control:request-approval-action",
        detail: expect.objectContaining({
          action: "approve",
          source: "control_label_change",
          text: "Control label changed to confirmed state: Approved",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer control-label confirmation when label was already final", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request REQ001 Approved",
      pageContent: "Request REQ001 Approved",
      elements: [
        stableActionButton(607, "Approved", "request-approval-action"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ001 Approved",
      pageContent: "Request REQ001 Approved",
      elements: [
        stableActionButton(607, "Approved", "request-approval-action"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 607 },
      result: "Clicked element 607.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer control-label confirmation without stable identity", () => {
    const preButton = actionButton(607, "Approve request");
    const currentButton = actionButton(607, "Approved");
    const pre = workflowSnapshot({
      visibleContent: "Request REQ001 Awaiting approval Approve request",
      pageContent: "Request REQ001 Awaiting approval Approve request",
      elements: [
        {
          ...preButton,
          attributes: { "aria-label": "Approve request" },
        },
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ001 Approved",
      pageContent: "Request REQ001 Approved",
      elements: [
        {
          ...currentButton,
          attributes: { "aria-label": "Approved" },
        },
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 607 },
      result: "Clicked element 607.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts update confirmation from same-control up-to-date label change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Settings Edit mode Apply changes",
      pageContent: "Settings Edit mode Apply changes",
      elements: [stableActionButton(608, "Apply changes", "settings-apply")],
    });
    const current = workflowSnapshot({
      visibleContent: "Settings Up to date",
      pageContent: "Settings Up to date",
      elements: [stableActionButton(608, "Up to date", "settings-apply")],
    });
    const generated = generateCompletionContract({
      userRequest: "Apply changes.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 608 },
      result: "Clicked element 608.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Applied changes.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "update",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:update:control:settings-apply",
        detail: expect.objectContaining({
          action: "update",
          source: "control_label_change",
          text: "Control label changed to confirmed state: Up to date",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer up-to-date update confirmation when label was already final", () => {
    const pre = workflowSnapshot({
      visibleContent: "Settings Up to date",
      pageContent: "Settings Up to date",
      elements: [stableActionButton(608, "Up to date", "settings-apply")],
    });
    const current = workflowSnapshot({
      visibleContent: "Settings Up to date",
      pageContent: "Settings Up to date",
      elements: [stableActionButton(608, "Up to date", "settings-apply")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 608 },
      result: "Clicked element 608.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts approval-complete summary for approve status-change evidence", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request REQ001 Status: Awaiting approval Approve request",
      pageContent: "Request REQ001 Status: Awaiting approval Approve request",
      elements: [actionButton(601, "Approve request")],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ001 Status: Approved",
      pageContent: "Request REQ001 Status: Approved",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Approve the request.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 601 },
      result: "Clicked element 601.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Approval completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts deny confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request REQ002 Status: Pending Deny request",
      pageContent: "Request REQ002 Status: Pending Deny request",
      elements: [actionButton(603, "Deny request")],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ002 Status: Denied",
      pageContent: "Request REQ002 Status: Denied",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Deny the request.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 603 },
      result: "Clicked element 603.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Denied the request.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reject",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:reject:status:status-denied",
        detail: expect.objectContaining({
          action: "reject",
          source: "status_change",
          text: "Status: Denied",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts resolve confirmation from same-page state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Incident INC001 State: In Progress Resolve incident",
      pageContent: "Incident INC001 State: In Progress Resolve incident",
      elements: [actionButton(602, "Resolve incident")],
    });
    const current = workflowSnapshot({
      visibleContent: "Incident INC001 State: Resolved",
      pageContent: "Incident INC001 State: Resolved",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Resolve the incident.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 602 },
      result: "Clicked element 602.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Resolved the incident.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "close",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:close:status:state-resolved",
        detail: expect.objectContaining({
          action: "close",
          source: "status_change",
          text: "State: Resolved",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts reopen confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Incident INC003 Status: Closed Reopen incident",
      pageContent: "Incident INC003 Status: Closed Reopen incident",
      elements: [actionButton(604, "Reopen incident")],
    });
    const current = workflowSnapshot({
      visibleContent: "Incident INC003 Status: Open",
      pageContent: "Incident INC003 Status: Open",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Reopen the incident.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 604 },
      result: "Clicked element 604.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Reopened the incident.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reopen",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:reopen:status:status-open",
        detail: expect.objectContaining({
          action: "reopen",
          source: "status_change",
          text: "Status: Open",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer reopen confirmation when status was already open", () => {
    const pre = workflowSnapshot({
      visibleContent: "Incident INC003 Status: Open Reopen incident",
      pageContent: "Incident INC003 Status: Open Reopen incident",
      elements: [actionButton(604, "Reopen incident")],
    });
    const current = workflowSnapshot({
      visibleContent: "Incident INC003 Status: Open",
      pageContent: "Incident INC003 Status: Open",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 604 },
      result: "Clicked element 604.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts cancel confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Order ORD004 Status: Active Cancel order",
      pageContent: "Order ORD004 Status: Active Cancel order",
      elements: [actionButton(607, "Cancel order")],
    });
    const current = workflowSnapshot({
      visibleContent: "Order ORD004 Status: Cancelled",
      pageContent: "Order ORD004 Status: Cancelled",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Cancel the order.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 607 },
      result: "Clicked element 607.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Cancelled the order.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "cancel",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:cancel:status:status-cancelled",
        detail: expect.objectContaining({
          action: "cancel",
          source: "status_change",
          text: "Status: Cancelled",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer cancel confirmation when status was already canceled", () => {
    const pre = workflowSnapshot({
      visibleContent: "Order ORD004 Status: Canceled Cancel order",
      pageContent: "Order ORD004 Status: Canceled Cancel order",
      elements: [actionButton(607, "Cancel order")],
    });
    const current = workflowSnapshot({
      visibleContent: "Order ORD004 Status: Canceled",
      pageContent: "Order ORD004 Status: Canceled",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 607 },
      result: "Clicked element 607.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts enable confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security MFA Status: Disabled Enable MFA",
      pageContent: "Security MFA Status: Disabled Enable MFA",
      elements: [actionButton(608, "Enable MFA")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security MFA Status: Enabled",
      pageContent: "Security MFA Status: Enabled",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Enable MFA.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 608 },
      result: "Clicked element 608.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Enabled MFA.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:enable:status:status-enabled",
        detail: expect.objectContaining({
          action: "enable",
          source: "status_change",
          text: "Status: Enabled",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts disable confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security MFA Status: Enabled Disable MFA",
      pageContent: "Security MFA Status: Enabled Disable MFA",
      elements: [actionButton(609, "Disable MFA")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security MFA Status: Disabled",
      pageContent: "Security MFA Status: Disabled",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Disable MFA.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 609 },
      result: "Clicked element 609.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Disabled MFA.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "disable",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:disable:status:status-disabled",
        detail: expect.objectContaining({
          action: "disable",
          source: "status_change",
          text: "Status: Disabled",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer enable confirmation when status was already enabled", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security MFA Status: Enabled Enable MFA",
      pageContent: "Security MFA Status: Enabled Enable MFA",
      elements: [actionButton(608, "Enable MFA")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security MFA Status: Enabled",
      pageContent: "Security MFA Status: Enabled",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 608 },
      result: "Clicked element 608.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer disable confirmation when status was already disabled", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security MFA Status: Disabled Disable MFA",
      pageContent: "Security MFA Status: Disabled Disable MFA",
      elements: [actionButton(609, "Disable MFA")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security MFA Status: Disabled",
      pageContent: "Security MFA Status: Disabled",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 609 },
      result: "Clicked element 609.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts enable confirmation from control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security settings Enable MFA",
      pageContent: "Security settings Enable MFA",
      elements: [statefulActionButton(620, "Enable MFA", false, "mfa-toggle")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security settings Enable MFA",
      pageContent: "Security settings Enable MFA",
      elements: [statefulActionButton(621, "Enable MFA", true, "mfa-toggle")],
    });
    const generated = generateCompletionContract({
      userRequest: "Enable MFA.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 620 },
      result: "Clicked element 620.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Enabled MFA.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:enable:control-state:mfa-toggle",
        detail: expect.objectContaining({
          action: "enable",
          source: "control_state_change",
          text: "Control state changed to enabled: Enable MFA",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts disable confirmation from control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security settings Disable MFA",
      pageContent: "Security settings Disable MFA",
      elements: [statefulActionButton(622, "Disable MFA", true, "mfa-toggle")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security settings Disable MFA",
      pageContent: "Security settings Disable MFA",
      elements: [statefulActionButton(623, "Disable MFA", false, "mfa-toggle")],
    });
    const generated = generateCompletionContract({
      userRequest: "Disable MFA.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 622 },
      result: "Clicked element 622.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Disabled MFA.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "disable",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:disable:control-state:mfa-toggle",
        detail: expect.objectContaining({
          action: "disable",
          source: "control_state_change",
          text: "Control state changed to disabled: Disable MFA",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer enable confirmation when control state was already enabled", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security settings Enable MFA",
      pageContent: "Security settings Enable MFA",
      elements: [statefulActionButton(620, "Enable MFA", true, "mfa-toggle")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security settings Enable MFA",
      pageContent: "Security settings Enable MFA",
      elements: [statefulActionButton(621, "Enable MFA", true, "mfa-toggle")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 620 },
      result: "Clicked element 620.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer enable confirmation when control state flips the wrong direction", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security settings Enable MFA",
      pageContent: "Security settings Enable MFA",
      elements: [statefulActionButton(620, "Enable MFA", true, "mfa-toggle")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security settings Enable MFA",
      pageContent: "Security settings Enable MFA",
      elements: [statefulActionButton(621, "Enable MFA", false, "mfa-toggle")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 620 },
      result: "Clicked element 620.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer enable confirmation from generic toggled control text", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security settings MFA",
      pageContent: "Security settings MFA",
      elements: [statefulActionButton(620, "MFA", false, "mfa-toggle")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security settings MFA",
      pageContent: "Security settings MFA",
      elements: [statefulActionButton(621, "MFA", true, "mfa-toggle")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 620 },
      result: "Clicked element 620.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts lock confirmation from control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security settings Lock account",
      pageContent: "Security settings Lock account",
      elements: [statefulActionButton(624, "Lock account", false, "account-lock")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security settings Lock account",
      pageContent: "Security settings Lock account",
      elements: [statefulActionButton(625, "Lock account", true, "account-lock")],
    });
    const generated = generateCompletionContract({
      userRequest: "Lock the account.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 624 },
      result: "Clicked element 624.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Locked the account.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "lock",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:lock:control-state:account-lock",
        detail: expect.objectContaining({
          action: "lock",
          source: "control_state_change",
          text: "Control state changed to locked: Lock account",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts unlock confirmation from control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security settings Unlock account",
      pageContent: "Security settings Unlock account",
      elements: [statefulActionButton(626, "Unlock account", true, "account-lock")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security settings Unlock account",
      pageContent: "Security settings Unlock account",
      elements: [statefulActionButton(627, "Unlock account", false, "account-lock")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unlock the account.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 626 },
      result: "Clicked element 626.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unlocked the account.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unlock",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unlock:control-state:account-lock",
        detail: expect.objectContaining({
          action: "unlock",
          source: "control_state_change",
          text: "Control state changed to unlocked: Unlock account",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer lock confirmation when control state flips the wrong direction", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security settings Lock account",
      pageContent: "Security settings Lock account",
      elements: [statefulActionButton(624, "Lock account", true, "account-lock")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security settings Lock account",
      pageContent: "Security settings Lock account",
      elements: [statefulActionButton(625, "Lock account", false, "account-lock")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 624 },
      result: "Clicked element 624.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts assign confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Ticket INC005 Status: Open Assign ticket",
      pageContent: "Ticket INC005 Status: Open Assign ticket",
      elements: [actionButton(610, "Assign ticket")],
    });
    const current = workflowSnapshot({
      visibleContent: "Ticket INC005 Status: Assigned",
      pageContent: "Ticket INC005 Status: Assigned",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Assign the ticket.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 610 },
      result: "Clicked element 610.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Assigned the ticket.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "assign",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:assign:status:status-assigned",
        detail: expect.objectContaining({
          action: "assign",
          source: "status_change",
          text: "Status: Assigned",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts unassign confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Ticket INC005 Status: Assigned Unassign ticket",
      pageContent: "Ticket INC005 Status: Assigned Unassign ticket",
      elements: [actionButton(611, "Unassign ticket")],
    });
    const current = workflowSnapshot({
      visibleContent: "Ticket INC005 Status: Unassigned",
      pageContent: "Ticket INC005 Status: Unassigned",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Unassign the ticket.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 611 },
      result: "Clicked element 611.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unassigned the ticket.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unassign",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unassign:status:status-unassigned",
        detail: expect.objectContaining({
          action: "unassign",
          source: "status_change",
          text: "Status: Unassigned",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer assign confirmation when status was already assigned", () => {
    const pre = workflowSnapshot({
      visibleContent: "Ticket INC005 Status: Assigned Assign ticket",
      pageContent: "Ticket INC005 Status: Assigned Assign ticket",
      elements: [actionButton(610, "Assign ticket")],
    });
    const current = workflowSnapshot({
      visibleContent: "Ticket INC005 Status: Assigned",
      pageContent: "Ticket INC005 Status: Assigned",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 610 },
      result: "Clicked element 610.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unassign confirmation when status was already unassigned", () => {
    const pre = workflowSnapshot({
      visibleContent: "Ticket INC005 Status: Unassigned Unassign ticket",
      pageContent: "Ticket INC005 Status: Unassigned Unassign ticket",
      elements: [actionButton(611, "Unassign ticket")],
    });
    const current = workflowSnapshot({
      visibleContent: "Ticket INC005 Status: Unassigned",
      pageContent: "Ticket INC005 Status: Unassigned",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 611 },
      result: "Clicked element 611.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("keeps assigned status questions as read-answer contracts", () => {
    const snap = workflowSnapshot({
      title: "Ticket Matrix",
      url: "https://example.test/tickets",
      visibleContent: "Ticket Matrix Assigned: Priya Shah Priority: High",
      pageContent:
        "Ticket Matrix Assigned: Priya Shah. Priority: High. The page explains assignment coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer ticket questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is assigned?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Priya Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "assigned",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts escalate confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Incident INC006 Status: Open Escalate incident",
      pageContent: "Incident INC006 Status: Open Escalate incident",
      elements: [actionButton(612, "Escalate incident")],
    });
    const current = workflowSnapshot({
      visibleContent: "Incident INC006 Status: Escalated",
      pageContent: "Incident INC006 Status: Escalated",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Escalate the incident.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 612 },
      result: "Clicked element 612.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Escalated the incident.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "escalate",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:escalate:status:status-escalated",
        detail: expect.objectContaining({
          action: "escalate",
          source: "status_change",
          text: "Status: Escalated",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts deescalate confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Incident INC006 Status: Escalated De-escalate incident",
      pageContent: "Incident INC006 Status: Escalated De-escalate incident",
      elements: [actionButton(613, "De-escalate incident")],
    });
    const current = workflowSnapshot({
      visibleContent: "Incident INC006 Status: De-escalated",
      pageContent: "Incident INC006 Status: De-escalated",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "De-escalate the incident.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 613 },
      result: "Clicked element 613.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "De-escalated the incident.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "deescalate",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:deescalate:status:status-de-escalated",
        detail: expect.objectContaining({
          action: "deescalate",
          source: "status_change",
          text: "Status: De-escalated",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer escalate confirmation when status was already escalated", () => {
    const pre = workflowSnapshot({
      visibleContent: "Incident INC006 Status: Escalated Escalate incident",
      pageContent: "Incident INC006 Status: Escalated Escalate incident",
      elements: [actionButton(612, "Escalate incident")],
    });
    const current = workflowSnapshot({
      visibleContent: "Incident INC006 Status: Escalated",
      pageContent: "Incident INC006 Status: Escalated",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 612 },
      result: "Clicked element 612.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer deescalate confirmation when status was already deescalated", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Incident INC006 Status: De-escalated De-escalate incident",
      pageContent:
        "Incident INC006 Status: De-escalated De-escalate incident",
      elements: [actionButton(613, "De-escalate incident")],
    });
    const current = workflowSnapshot({
      visibleContent: "Incident INC006 Status: De-escalated",
      pageContent: "Incident INC006 Status: De-escalated",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 613 },
      result: "Clicked element 613.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("keeps escalation owner questions as read-answer contracts", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Escalation owner: platform operations Priority: High",
      pageContent:
        "Support Matrix Escalation owner: platform operations. Priority: High. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the escalation owner?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "platform operations",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "escalation owner",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts lock confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Active Lock account",
      pageContent: "Account ACCT001 Status: Active Lock account",
      elements: [actionButton(614, "Lock account")],
    });
    const current = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Locked",
      pageContent: "Account ACCT001 Status: Locked",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Lock the account.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 614 },
      result: "Clicked element 614.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Locked the account.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "lock",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:lock:status:status-locked",
        detail: expect.objectContaining({
          action: "lock",
          source: "status_change",
          text: "Status: Locked",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts unlock confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Locked Unlock account",
      pageContent: "Account ACCT001 Status: Locked Unlock account",
      elements: [actionButton(615, "Unlock account")],
    });
    const current = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Unlocked",
      pageContent: "Account ACCT001 Status: Unlocked",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Unlock the account.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 615 },
      result: "Clicked element 615.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unlocked the account.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unlock",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unlock:status:status-unlocked",
        detail: expect.objectContaining({
          action: "unlock",
          source: "status_change",
          text: "Status: Unlocked",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer lock confirmation when status was already locked", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Locked Lock account",
      pageContent: "Account ACCT001 Status: Locked Lock account",
      elements: [actionButton(614, "Lock account")],
    });
    const current = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Locked",
      pageContent: "Account ACCT001 Status: Locked",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 614 },
      result: "Clicked element 614.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unlock confirmation when status was already unlocked", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Unlocked Unlock account",
      pageContent: "Account ACCT001 Status: Unlocked Unlock account",
      elements: [actionButton(615, "Unlock account")],
    });
    const current = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Unlocked",
      pageContent: "Account ACCT001 Status: Unlocked",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 615 },
      result: "Clicked element 615.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("keeps locked status questions as read-answer contracts", () => {
    const snap = workflowSnapshot({
      title: "Account Matrix",
      url: "https://example.test/accounts",
      visibleContent: "Account Matrix Account locked: Yes Priority: High",
      pageContent:
        "Account Matrix Account locked: Yes. Priority: High. The page explains access coverage, account policy, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer account questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is the account locked?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "account locked",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts pause confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Sync job SYNC001 Status: Running Pause job",
      pageContent: "Sync job SYNC001 Status: Running Pause job",
      elements: [actionButton(624, "Pause job")],
    });
    const current = workflowSnapshot({
      visibleContent: "Sync job SYNC001 Status: Paused",
      pageContent: "Sync job SYNC001 Status: Paused",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Pause the job.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 624 },
      result: "Clicked element 624.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Paused the job.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "pause",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:pause:status:status-paused",
        detail: expect.objectContaining({
          action: "pause",
          source: "status_change",
          text: "Status: Paused",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts resume confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Sync job SYNC001 Status: Paused Resume job",
      pageContent: "Sync job SYNC001 Status: Paused Resume job",
      elements: [actionButton(625, "Resume job")],
    });
    const current = workflowSnapshot({
      visibleContent: "Sync job SYNC001 Status: Running",
      pageContent: "Sync job SYNC001 Status: Running",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Resume the job.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 625 },
      result: "Clicked element 625.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Resumed the job.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "resume",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:resume:status:status-running",
        detail: expect.objectContaining({
          action: "resume",
          source: "status_change",
          text: "Status: Running",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer pause confirmation when status was already paused", () => {
    const pre = workflowSnapshot({
      visibleContent: "Sync job SYNC001 Status: Paused Pause job",
      pageContent: "Sync job SYNC001 Status: Paused Pause job",
      elements: [actionButton(624, "Pause job")],
    });
    const current = workflowSnapshot({
      visibleContent: "Sync job SYNC001 Status: Paused",
      pageContent: "Sync job SYNC001 Status: Paused",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 624 },
      result: "Clicked element 624.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("keeps paused status questions as read-answer contracts", () => {
    const snap = workflowSnapshot({
      title: "Sync Matrix",
      url: "https://example.test/sync",
      visibleContent: "Sync Matrix Sync paused: Yes Owner: platform operations",
      pageContent:
        "Sync Matrix Sync paused: Yes. Owner: platform operations. The page explains job coverage, sync policy, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer sync questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is the sync paused?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "sync paused",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts start confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Worker service SVC001 Status: Stopped Start service",
      pageContent: "Worker service SVC001 Status: Stopped Start service",
      elements: [actionButton(626, "Start service")],
    });
    const current = workflowSnapshot({
      visibleContent: "Worker service SVC001 Status: Running",
      pageContent: "Worker service SVC001 Status: Running",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Start the service.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 626 },
      result: "Clicked element 626.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Started the service.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "start",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:start:status:status-running",
        detail: expect.objectContaining({
          action: "start",
          source: "status_change",
          text: "Status: Running",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts stop confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Worker service SVC001 Status: Running Stop service",
      pageContent: "Worker service SVC001 Status: Running Stop service",
      elements: [actionButton(627, "Stop service")],
    });
    const current = workflowSnapshot({
      visibleContent: "Worker service SVC001 Status: Stopped",
      pageContent: "Worker service SVC001 Status: Stopped",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Stop the service.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 627 },
      result: "Clicked element 627.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Stopped the service.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "stop",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:stop:status:status-stopped",
        detail: expect.objectContaining({
          action: "stop",
          source: "status_change",
          text: "Status: Stopped",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer stop confirmation when status was already stopped", () => {
    const pre = workflowSnapshot({
      visibleContent: "Worker service SVC001 Status: Stopped Stop service",
      pageContent: "Worker service SVC001 Status: Stopped Stop service",
      elements: [actionButton(627, "Stop service")],
    });
    const current = workflowSnapshot({
      visibleContent: "Worker service SVC001 Status: Stopped",
      pageContent: "Worker service SVC001 Status: Stopped",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 627 },
      result: "Clicked element 627.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("keeps stopped status questions as read-answer contracts", () => {
    const snap = workflowSnapshot({
      title: "Service Matrix",
      url: "https://example.test/service",
      visibleContent: "Service Matrix Service stopped: Yes Owner: platform operations",
      pageContent:
        "Service Matrix Service stopped: Yes. Owner: platform operations. The page explains service coverage, service policy, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer service questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is the service stopped?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "service stopped",
    });
    expect(decision.status).toBe("accepted");
  });

  test("keeps restart requirement questions as read-answer contracts", () => {
    const snap = workflowSnapshot({
      title: "Service Matrix",
      url: "https://example.test/service",
      visibleContent:
        "Service Matrix Restart required: No Owner: platform operations",
      pageContent:
        "Service Matrix Restart required: No. Owner: platform operations. The page explains service coverage, restart policy, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer service questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is restart required?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "No",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "restart required",
    });
    expect(decision.status).toBe("accepted");
  });

  test("keeps refresh rate questions as read-answer contracts", () => {
    const snap = workflowSnapshot({
      title: "Monitor Matrix",
      url: "https://example.test/monitor",
      visibleContent:
        "Monitor Matrix Refresh rate: 60Hz Owner: platform operations",
      pageContent:
        "Monitor Matrix Refresh rate: 60Hz. Owner: platform operations. The page explains monitor coverage, refresh policy, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer monitor questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the refresh rate?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "60Hz",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "refresh rate",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts publish confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Article ART001 Status: Draft Publish article",
      pageContent: "Article ART001 Status: Draft Publish article",
      elements: [actionButton(616, "Publish article")],
    });
    const current = workflowSnapshot({
      visibleContent: "Article ART001 Status: Published",
      pageContent: "Article ART001 Status: Published",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Publish the article.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 616 },
      result: "Clicked element 616.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Published the article.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "post",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:post:status:status-published",
        detail: expect.objectContaining({
          action: "post",
          source: "status_change",
          text: "Status: Published",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer publish confirmation when status was already published", () => {
    const pre = workflowSnapshot({
      visibleContent: "Article ART001 Status: Published Publish article",
      pageContent: "Article ART001 Status: Published Publish article",
      elements: [actionButton(616, "Publish article")],
    });
    const current = workflowSnapshot({
      visibleContent: "Article ART001 Status: Published",
      pageContent: "Article ART001 Status: Published",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 616 },
      result: "Clicked element 616.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("keeps published status questions as read-answer contracts", () => {
    const snap = workflowSnapshot({
      title: "Article Matrix",
      url: "https://example.test/articles",
      visibleContent: "Article Matrix Article published: Yes Priority: High",
      pageContent:
        "Article Matrix Article published: Yes. Priority: High. The page explains article status, review policy, customer impact, response timing, audit notes, routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer article questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is the article published?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "article published",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts submit confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request REQ004 Status: Draft Submit request",
      pageContent: "Request REQ004 Status: Draft Submit request",
      elements: [actionButton(605, "Submit request")],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ004 Status: Submitted",
      pageContent: "Request REQ004 Status: Submitted",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Submit the request.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 605 },
      result: "Clicked element 605.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Submitted the request.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "submit",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:submit:status:status-submitted",
        detail: expect.objectContaining({
          action: "submit",
          source: "status_change",
          text: "Status: Submitted",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer submit status-change confirmation when status was already submitted", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request REQ004 Status: Submitted Submit request",
      pageContent: "Request REQ004 Status: Submitted Submit request",
      elements: [actionButton(605, "Submit request")],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ004 Status: Submitted",
      pageContent: "Request REQ004 Status: Submitted",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 605 },
      result: "Clicked element 605.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts mark-complete confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Task TASK001 Status: In Progress Mark task complete",
      pageContent: "Task TASK001 Status: In Progress Mark task complete",
      elements: [actionButton(606, "Mark task complete")],
    });
    const current = workflowSnapshot({
      visibleContent: "Task TASK001 Status: Completed",
      pageContent: "Task TASK001 Status: Completed",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Mark TASK001 complete.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 606 },
      result: "Clicked element 606.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Marked TASK001 complete.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "complete",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:complete:status:status-completed",
        detail: expect.objectContaining({
          action: "complete",
          source: "status_change",
          text: "Status: Completed",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer mark-complete confirmation when status was already complete", () => {
    const pre = workflowSnapshot({
      visibleContent: "Task TASK001 Status: Completed Mark task complete",
      pageContent: "Task TASK001 Status: Completed Mark task complete",
      elements: [actionButton(606, "Mark task complete")],
    });
    const current = workflowSnapshot({
      visibleContent: "Task TASK001 Status: Completed",
      pageContent: "Task TASK001 Status: Completed",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 606 },
      result: "Clicked element 606.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not generate complete workflow contract for generic form-completion wording", () => {
    const generated = generateCompletionContract({
      userRequest: "Complete the profile form.",
      snapshot: workflowSnapshot(),
    });

    expect(generated).toBeNull();
  });

  test("does not generate complete workflow contract for reporting a complete state", () => {
    const generated = generateCompletionContract({
      userRequest: "Report that the task is complete.",
      snapshot: workflowSnapshot(),
    });

    expect(generated).toBeNull();
  });

  test("accepts save confirmation from cleared dirty-state indicator", () => {
    const pre = workflowSnapshot({
      visibleContent: "Settings Unsaved changes Save changes",
      pageContent: "Settings Unsaved changes Save changes",
      elements: [actionButton(701, "Save changes")],
    });
    const current = workflowSnapshot({
      visibleContent: "Settings Save changes",
      pageContent: "Settings Save changes",
      elements: [actionButton(701, "Save changes")],
    });
    const generated = generateCompletionContract({
      userRequest: "Save changes.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 701 },
      result: "Clicked element 701.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 12,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Saved changes.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "save",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:save:dirty-indicator-cleared",
        detail: expect.objectContaining({
          action: "save",
          source: "dirty_indicator_cleared",
          text: "Unsaved-changes indicator is no longer visible.",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer save confirmation while dirty-state indicator remains", () => {
    const pre = workflowSnapshot({
      visibleContent: "Settings Unsaved changes Save changes",
      pageContent: "Settings Unsaved changes Save changes",
      elements: [actionButton(701, "Save changes")],
    });
    const current = workflowSnapshot({
      visibleContent: "Settings Unsaved changes Save changes",
      pageContent: "Settings Unsaved changes Save changes",
      elements: [actionButton(701, "Save changes")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 701 },
      result: "Clicked element 701.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 12,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts update confirmation from cleared standalone unsaved indicator", () => {
    const pre = workflowSnapshot({
      visibleContent: "Settings Unsaved Apply changes",
      pageContent: "Settings Unsaved Apply changes",
      elements: [actionButton(702, "Apply changes")],
    });
    const current = workflowSnapshot({
      visibleContent: "Settings Apply changes",
      pageContent: "Settings Apply changes",
      elements: [actionButton(702, "Apply changes")],
    });
    const generated = generateCompletionContract({
      userRequest: "Apply changes.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 702 },
      result: "Clicked element 702.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 13,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Applied changes.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "update",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:update:dirty-indicator-cleared",
        detail: expect.objectContaining({
          action: "update",
          source: "dirty_indicator_cleared",
          text: "Unsaved-changes indicator is no longer visible.",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer update confirmation while standalone unsaved indicator remains", () => {
    const pre = workflowSnapshot({
      visibleContent: "Settings Unsaved Apply changes",
      pageContent: "Settings Unsaved Apply changes",
      elements: [actionButton(702, "Apply changes")],
    });
    const current = workflowSnapshot({
      visibleContent: "Settings Unsaved Apply changes",
      pageContent: "Settings Unsaved Apply changes",
      elements: [actionButton(702, "Apply changes")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 702 },
      result: "Clicked element 702.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 13,
    });

    expect(evidence).toEqual([]);
  });

  test("rejects form completion when visible validation is active", () => {
    const snap = formSnapshot();
    const generated = generateCompletionContract({
      userRequest:
        "Fill the profile form with email admin@example.com and password secret123.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(
      formSnapshot({
        visibleContent:
          "Profile form Email Address Password Error: Password is required",
        pageContent:
          "Profile form Email Address Password Error: Password is required",
        elements: [
          textField(201, "Email Address", "admin@example.com"),
          textField(202, "Password", "", "password"),
          checkboxField(203, "Remember me", false),
        ],
      }),
      6,
    );

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Filled the form.",
    });

    expect(decision.status).toBe("rejected");
    expect(decision.reason).toContain("validation");
  });

  test("accepts draft-only completion when an unsent draft is visible", () => {
    const snap = draftSnapshot();
    const generated = generateCompletionContract({
      userRequest:
        "Read David's email and draft a short reply in the reply box. Don't click send.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Drafted the reply and left it unsent in the editor.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "draft_only",
      requiresUnsent: true,
    });
    expect(decision.status).toBe("accepted");
    expect(decision.evidence).toEqual([
      expect.objectContaining({
        type: "draft_state",
        logicalKey: expect.stringContaining("draft:reply-message"),
      }),
    ]);
    expect(buildCompletionRecoveryHint(decision)).toContain("draft remains");
  });

  test("rejects draft-only completion when sent evidence is visible", () => {
    const snap = draftSnapshot({
      visibleContent: "Email thread Message sent",
      pageContent: "Email thread Message sent",
    });
    const generated = generateCompletionContract({
      userRequest:
        "Read David's email, draft a short reply, and leave it unsent.",
      snapshot: snap,
    });

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "The reply was sent.",
    });

    expect(generated?.contract).toMatchObject({ kind: "draft_only" });
    expect(decision.status).toBe("rejected");
    expect(decision.reason).toContain("sent");
  });

  test("generates draft-only contracts without a snapshot", () => {
    const generated = generateCompletionContract({
      userRequest: "Draft a reply to David and do not send it.",
      snapshot: null,
    });

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: [],
      snapshot: null,
      candidateSource: "model_done",
      summary: "The reply was sent.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "draft_only",
      requiresUnsent: true,
    });
    expect(decision.status).toBe("rejected");
    expect(decision.reason).toContain("sent");
  });

  test("does not treat unrelated draft wording as a draft-only contract", () => {
    const generated = generateCompletionContract({
      userRequest:
        "Read the project-updates channel to identify who should draft the changelog.",
      snapshot: draftSnapshot(),
    });

    expect(generated?.contract.kind).not.toBe("draft_only");
  });

  test("accepts explicit-url navigation completion from current URL evidence", () => {
    const snap = navigationSnapshot();
    const generated = generateCompletionContract({
      userRequest: "Open https://docs.example.test/getting-started",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Opened https://docs.example.test/getting-started.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "navigation",
      targetUrl: "https://docs.example.test/getting-started",
      targetHost: "docs.example.test",
    });
    expect(decision.status).toBe("accepted");
    expect(decision.reason).toContain("current URL");
    expect(buildCompletionRecoveryHint(decision)).toContain(
      "requested page is already open",
    );
  });

  test("rejects explicit-url navigation completion on the wrong host", () => {
    const snap = navigationSnapshot({
      url: "https://other.example.test/getting-started",
      title: "Other docs",
    });
    const generated = generateCompletionContract({
      userRequest: "Navigate to docs.example.test/getting-started",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Opened the docs page.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "navigation",
      targetHost: "docs.example.test",
    });
    expect(decision.status).toBe("rejected");
    expect(decision.reason).toContain("does not match requested host");
  });

  test("accepts read-answer completion from grounded snapshot evidence", () => {
    const snap = workflowSnapshot({
      title: "Onboarding Guide",
      url: "https://example.test/onboarding",
      visibleContent:
        "The onboarding guide says new employees must set up accounts, enroll in security training, review access policies, and meet their manager before requesting production access.",
      pageContent:
        "The onboarding guide says new employees must set up accounts, enroll in security training, review access policies, and meet their manager before requesting production access. The guide also explains that access requests are audited every quarter and that support tickets should include the employee department and manager approval.",
    });
    const generated = generateCompletionContract({
      userRequest: "Summarize this page and mention the key onboarding steps.",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "The page says employees set up accounts, enroll in security training, review access policies, and meet their manager before production access.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      requiresGroundedPageEvidence: true,
    });
    expect(decision.status).toBe("accepted");
    expect(decision.evidence[0]).toMatchObject({
      type: "answer_state",
      detail: {
        source: "page_read",
        url: "https://example.test/onboarding",
      },
    });
  });

  test("accepts page-scoped factual question as grounded read-answer completion", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Beta inventory count is 7,318 units. Warehouse Delta inventory count is 2,184 units.",
      pageContent:
        "Warehouse Beta inventory count is 7,318 units. Warehouse Delta inventory count is 2,184 units. The page compares inventory counts, receiving backlog, audit timing, and replenishment notes so operators can answer factual warehouse questions from the page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the Warehouse Beta inventory count on this page?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Warehouse Beta inventory count is 7,318 units.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      requiresGroundedPageEvidence: true,
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts grounded direct factual question without explicit page wording", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Beta inventory count is 7,318 units. Warehouse Delta inventory count is 2,184 units.",
      pageContent:
        "Warehouse Beta inventory count is 7,318 units. Warehouse Delta inventory count is 2,184 units. The page compares inventory counts, receiving backlog, audit timing, and replenishment notes so operators can answer factual warehouse questions from the page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the Warehouse Beta inventory count?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Warehouse Beta inventory count is 7,318 units.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      requiresGroundedPageEvidence: true,
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts grounded label-value question without explicit page wording", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix SLA: four hours Escalation owner: platform operations",
      pageContent:
        "Support Matrix SLA: four hours for urgent incidents. Escalation owner: platform operations. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the SLA?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "The SLA is four hours for urgent incidents.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      requiresGroundedPageEvidence: true,
      expectedAnswerLabel: "sla",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts grounded label-value question with common label modifiers", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix SLA: four hours Escalation owner: platform operations",
      pageContent:
        "Support Matrix SLA: four hours for urgent incidents. Escalation owner: platform operations. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the current SLA?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "SLA: four hours",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "sla",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts concise grounded who-when-where label-value answer summaries", () => {
    const cases = [
      {
        request: "Who is the escalation owner?",
        visible: "Escalation owner: platform operations",
        label: "escalation owner",
        summary: "platform operations",
      },
      {
        request: "When is the maintenance window?",
        visible: "Maintenance window: Friday morning",
        label: "maintenance window",
        summary: "Friday morning",
      },
      {
        request: "Where is the data center?",
        visible: "Data center: Berlin Germany",
        label: "data center",
        summary: "Berlin Germany",
      },
    ];

    for (const scenario of cases) {
      const snap = workflowSnapshot({
        title: "Support Matrix",
        url: "https://example.test/support",
        visibleContent: `Support Matrix ${scenario.visible}`,
        pageContent:
          `Support Matrix ${scenario.visible}. ` +
          "The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
      });
      const generated = generateCompletionContract({
        userRequest: scenario.request,
        snapshot: snap,
      });
      const decision = evaluateCompletionContract({
        contract: generated?.contract,
        evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
        snapshot: snap,
        candidateSource: "model_done",
        summary: scenario.summary,
      });

      expect(generated?.contract).toMatchObject({
        kind: "read_answer",
        expectedAnswerLabel: scenario.label,
      });
      expect(decision.status).toBe("accepted");
    }
  });

  test("does not accept concise who label-value answer for explanatory boilerplate", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Escalation owner is documented in this policy and related routing notes.",
      pageContent:
        "Support Matrix Escalation owner is documented in this policy and related routing notes. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, escalation routing, and manager review, but it does not state a final escalation owner value.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the escalation owner?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "platform operations",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerLabel
        : undefined,
    ).toBeUndefined();
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts exact short multi-word label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Primary region: North America East Backup region: North America West",
      pageContent:
        "Support Matrix Primary region: North America East. Backup region: North America West. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Where is the primary region?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "North America East",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary region",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling multi-word label-value answer with same prefix", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Primary region: North America East Backup region: North America West",
      pageContent:
        "Support Matrix Primary region: North America East. Backup region: North America West. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Where is the primary region?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "North America West",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary region",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept multi-word label-value answer inside a longer phrase", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Primary region: North America East Backup region: North America West",
      pageContent:
        "Support Matrix Primary region: North America East. Backup region: North America West. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Where is the primary region?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "North America East Coast",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary region",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded email label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Owner email: support@example.com Backup email: help@example.com",
      pageContent:
        "Support Matrix Owner email: support@example.com. Backup email: help@example.com. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the owner email?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "support@example.com",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "owner email",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling email label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Owner email: support@example.com Backup email: help@example.com",
      pageContent:
        "Support Matrix Owner email: support@example.com. Backup email: help@example.com. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the owner email?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "help@example.com",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "owner email",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded url label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Portal URL: https://portal.example.com/login Backup URL: https://backup.example.com/login",
      pageContent:
        "Support Matrix Portal URL: https://portal.example.com/login. Backup URL: https://backup.example.com/login. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the portal URL?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "https://portal.example.com/login",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "portal url",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling url label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Portal URL: https://portal.example.com/login Backup URL: https://backup.example.com/login",
      pageContent:
        "Support Matrix Portal URL: https://portal.example.com/login. Backup URL: https://backup.example.com/login. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the portal URL?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "https://backup.example.com/login",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "portal url",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded path label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent:
        "Runtime Matrix Config path: /etc/open-sidebar/config.yaml Backup path: /etc/open-sidebar/config.bak",
      pageContent:
        "Runtime Matrix Config path: /etc/open-sidebar/config.yaml. Backup path: /etc/open-sidebar/config.bak. The page explains runtime ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the config path?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "/etc/open-sidebar/config.yaml",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "config path",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling path label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent:
        "Runtime Matrix Config path: /etc/open-sidebar/config.yaml Backup path: /etc/open-sidebar/config.bak",
      pageContent:
        "Runtime Matrix Config path: /etc/open-sidebar/config.yaml. Backup path: /etc/open-sidebar/config.bak. The page explains runtime ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the config path?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "/etc/open-sidebar/config.bak",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "config path",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept path prefix inside a longer path", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent:
        "Runtime Matrix Config path: /etc/open-sidebar/config.yaml Archive path: /etc/open-sidebar/config.yaml.bak",
      pageContent:
        "Runtime Matrix Config path: /etc/open-sidebar/config.yaml. Archive path: /etc/open-sidebar/config.yaml.bak. The page explains runtime ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the config path?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "/etc/open-sidebar/config.yaml.bak",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "config path",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded Windows path label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent:
        "Runtime Matrix Config file: C:\\OpenSidebar\\config.yaml Backup file: C:\\OpenSidebar\\config.bak",
      pageContent:
        "Runtime Matrix Config file: C:\\OpenSidebar\\config.yaml. Backup file: C:\\OpenSidebar\\config.bak. The page explains runtime ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the config file?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "C:\\OpenSidebar\\config.yaml",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "config file",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling Windows path label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent:
        "Runtime Matrix Config file: C:\\OpenSidebar\\config.yaml Backup file: C:\\OpenSidebar\\config.bak",
      pageContent:
        "Runtime Matrix Config file: C:\\OpenSidebar\\config.yaml. Backup file: C:\\OpenSidebar\\config.bak. The page explains runtime ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the config file?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "C:\\OpenSidebar\\config.bak",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "config file",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept Windows path prefix inside a longer path", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent:
        "Runtime Matrix Config file: C:\\OpenSidebar\\config.yaml Archive file: C:\\OpenSidebar\\config.yaml.bak",
      pageContent:
        "Runtime Matrix Config file: C:\\OpenSidebar\\config.yaml. Archive file: C:\\OpenSidebar\\config.yaml.bak. The page explains runtime ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the config file?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "C:\\OpenSidebar\\config.yaml.bak",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "config file",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded UNC path label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent:
        "Runtime Matrix Shared config file: \\\\fileserver\\share\\config.yaml Backup file: \\\\fileserver\\share\\config.bak",
      pageContent:
        "Runtime Matrix Shared config file: \\\\fileserver\\share\\config.yaml. Backup file: \\\\fileserver\\share\\config.bak. The page explains runtime ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the shared config file?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "\\\\fileserver\\share\\config.yaml",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "shared config file",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling UNC path label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent:
        "Runtime Matrix Shared config file: \\\\fileserver\\share\\config.yaml Backup file: \\\\fileserver\\share\\config.bak",
      pageContent:
        "Runtime Matrix Shared config file: \\\\fileserver\\share\\config.yaml. Backup file: \\\\fileserver\\share\\config.bak. The page explains runtime ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the shared config file?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "\\\\fileserver\\share\\config.bak",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "shared config file",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept UNC path prefix inside a longer path", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent:
        "Runtime Matrix Shared config file: \\\\fileserver\\share\\config.yaml Archive file: \\\\fileserver\\share\\config.yaml.bak",
      pageContent:
        "Runtime Matrix Shared config file: \\\\fileserver\\share\\config.yaml. Archive file: \\\\fileserver\\share\\config.yaml.bak. The page explains runtime ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the shared config file?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "\\\\fileserver\\share\\config.yaml.bak",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "shared config file",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded domain label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix API host: api.example.com Backup host: backup.example.com",
      pageContent:
        "Network Matrix API host: api.example.com. Backup host: backup.example.com. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the API host?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "api.example.com",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "api host",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling domain label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix API host: api.example.com Backup host: backup.example.com",
      pageContent:
        "Network Matrix API host: api.example.com. Backup host: backup.example.com. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the API host?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "backup.example.com",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "api host",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept domain suffix inside a longer hostname", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Base domain: example.com Full host: api.example.com",
      pageContent:
        "Network Matrix Base domain: example.com. Full host: api.example.com. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the base domain?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "api.example.com",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "base domain",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded MAC address label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Device MAC address: 00:1A:2B:3C:4D:5E Backup MAC address: 00:1A:2B:3C:4D:5F",
      pageContent:
        "Network Matrix Device MAC address: 00:1A:2B:3C:4D:5E. Backup MAC address: 00:1A:2B:3C:4D:5F. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the device MAC address?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "00:1A:2B:3C:4D:5E",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "device mac address",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling MAC address label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Device MAC address: 00:1A:2B:3C:4D:5E Backup MAC address: 00:1A:2B:3C:4D:5F",
      pageContent:
        "Network Matrix Device MAC address: 00:1A:2B:3C:4D:5E. Backup MAC address: 00:1A:2B:3C:4D:5F. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the device MAC address?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "00:1A:2B:3C:4D:5F",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "device mac address",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept MAC address prefix inside a longer address", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Device MAC address: 00:1A:2B:3C:4D:5E Backup MAC address: 00:1A:2B:3C:4D:5F",
      pageContent:
        "Network Matrix Device MAC address: 00:1A:2B:3C:4D:5E. Backup MAC address: 00:1A:2B:3C:4D:5F. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the device MAC address?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "00:1A:2B:3C:4D:5E:FF",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "device mac address",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded IPv6 label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary IPv6 address: 2001:db8::42 Backup IPv6 address: 2001:db8::43",
      pageContent:
        "Network Matrix Primary IPv6 address: 2001:db8::42. Backup IPv6 address: 2001:db8::43. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary IPv6 address?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2001:db8::42",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary ipv6 address",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling IPv6 label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary IPv6 address: 2001:db8::42 Backup IPv6 address: 2001:db8::43",
      pageContent:
        "Network Matrix Primary IPv6 address: 2001:db8::42. Backup IPv6 address: 2001:db8::43. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary IPv6 address?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2001:db8::43",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary ipv6 address",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept IPv6 prefix inside a longer address", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary IPv6 address: 2001:db8::42 Backup IPv6 address: 2001:db8::43",
      pageContent:
        "Network Matrix Primary IPv6 address: 2001:db8::42. Backup IPv6 address: 2001:db8::43. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary IPv6 address?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2001:db8::42:99",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary ipv6 address",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded CIDR label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary subnet: 10.42.0.0/24 Backup subnet: 10.43.0.0/24",
      pageContent:
        "Network Matrix Primary subnet: 10.42.0.0/24. Backup subnet: 10.43.0.0/24. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary subnet?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "10.42.0.0/24",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary subnet",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept truncated base address for CIDR label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary subnet: 10.42.0.0/24 Backup subnet: 10.43.0.0/24",
      pageContent:
        "Network Matrix Primary subnet: 10.42.0.0/24. Backup subnet: 10.43.0.0/24. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary subnet?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "10.42.0.0",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary subnet",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept truncated CIDR base address for generic address label", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary address: 10.42.0.0/24 Backup address: 10.43.0.0/24",
      pageContent:
        "Network Matrix Primary address: 10.42.0.0/24. Backup address: 10.43.0.0/24. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary address?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "10.42.0.0",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary address",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept sibling CIDR label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary subnet: 10.42.0.0/24 Backup subnet: 10.43.0.0/24",
      pageContent:
        "Network Matrix Primary subnet: 10.42.0.0/24. Backup subnet: 10.43.0.0/24. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary subnet?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "10.43.0.0/24",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary subnet",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept CIDR prefix inside a longer value", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary subnet: 10.42.0.0/24 Backup subnet: 10.43.0.0/24",
      pageContent:
        "Network Matrix Primary subnet: 10.42.0.0/24. Backup subnet: 10.43.0.0/24. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary subnet?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "10.42.0.0/24-backup",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary subnet",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded IPv6 CIDR label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary IPv6 prefix: 2001:db8::/64 Backup IPv6 prefix: 2001:db8:1::/64",
      pageContent:
        "Network Matrix Primary IPv6 prefix: 2001:db8::/64. Backup IPv6 prefix: 2001:db8:1::/64. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary IPv6 prefix?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2001:db8::/64",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary ipv6 prefix",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept truncated base address for IPv6 CIDR label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary IPv6 prefix: 2001:db8::/64 Backup IPv6 prefix: 2001:db8:1::/64",
      pageContent:
        "Network Matrix Primary IPv6 prefix: 2001:db8::/64. Backup IPv6 prefix: 2001:db8:1::/64. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary IPv6 prefix?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2001:db8::",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary ipv6 prefix",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts IPv6 CIDR value for generic prefix label", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary prefix: 2001:db8::/64 Backup prefix: 2001:db8:1::/64",
      pageContent:
        "Network Matrix Primary prefix: 2001:db8::/64. Backup prefix: 2001:db8:1::/64. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary prefix?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2001:db8::/64",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary prefix",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling IPv6 CIDR label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary IPv6 prefix: 2001:db8::/64 Backup IPv6 prefix: 2001:db8:1::/64",
      pageContent:
        "Network Matrix Primary IPv6 prefix: 2001:db8::/64. Backup IPv6 prefix: 2001:db8:1::/64. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary IPv6 prefix?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2001:db8:1::/64",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary ipv6 prefix",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept IPv6 CIDR prefix inside a longer value", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary IPv6 prefix: 2001:db8::/64 Backup IPv6 prefix: 2001:db8:1::/64",
      pageContent:
        "Network Matrix Primary IPv6 prefix: 2001:db8::/64. Backup IPv6 prefix: 2001:db8:1::/64. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary IPv6 prefix?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2001:db8::/64-backup",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary ipv6 prefix",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded phone label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Support phone: +1 (415) 555-0134 Backup phone: +1 (650) 555-0199",
      pageContent:
        "Support Matrix Support phone: +1 (415) 555-0134. Backup phone: +1 (650) 555-0199. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the support phone?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "+1 (415) 555-0134",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "support phone",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling phone label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Support phone: +1 (415) 555-0134 Backup phone: +1 (650) 555-0199",
      pageContent:
        "Support Matrix Support phone: +1 (415) 555-0134. Backup phone: +1 (650) 555-0199. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the support phone?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "+1 (650) 555-0199",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "support phone",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded ip address label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Server address: 10.42.0.8 Backup address: 10.42.0.9",
      pageContent:
        "Network Matrix Server address: 10.42.0.8. Backup address: 10.42.0.9. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the server address?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "10.42.0.8",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "server address",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling ip address with same prefix", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Server address: 10.42.0.8 Backup address: 10.42.0.9",
      pageContent:
        "Network Matrix Server address: 10.42.0.8. Backup address: 10.42.0.9. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the server address?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "10.42.0.9",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "server address",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded numeric label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent: "Support Matrix Open tickets: 14 Closed tickets: 9",
      pageContent:
        "Support Matrix Open tickets: 14. Closed tickets: 9. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open tickets?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "14",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open tickets",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept the wrong concise numeric label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent: "Support Matrix Open tickets: 9 Closed tickets: 14",
      pageContent:
        "Support Matrix Open tickets: 9. Closed tickets: 14. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open tickets?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "14",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open tickets",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded decimal percent label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Reliability Matrix",
      url: "https://example.test/reliability",
      visibleContent:
        "Reliability Matrix Uptime percentage: 99.9% Target uptime: 99%",
      pageContent:
        "Reliability Matrix Uptime percentage: 99.9%. Target uptime: 99%. The page explains reliability ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer reliability questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the uptime percentage?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "99.9%",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "uptime percentage",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept truncated decimal percent label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Reliability Matrix",
      url: "https://example.test/reliability",
      visibleContent:
        "Reliability Matrix Uptime percentage: 99.9% Target uptime: 99%",
      pageContent:
        "Reliability Matrix Uptime percentage: 99.9%. Target uptime: 99%. The page explains reliability ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer reliability questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the uptime percentage?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "99%",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "uptime percentage",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept truncated decimal currency label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Budget Matrix",
      url: "https://example.test/budget",
      visibleContent:
        "Budget Matrix Monthly budget: $1,250.50 Monthly spend: $1,250.00",
      pageContent:
        "Budget Matrix Monthly budget: $1,250.50. Monthly spend: $1,250.00. The page explains budget ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer budget questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the monthly budget?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "$1,250",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "monthly budget",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded decimal currency label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Budget Matrix",
      url: "https://example.test/budget",
      visibleContent:
        "Budget Matrix Monthly budget: $1,250.50 Monthly spend: $1,250.00",
      pageContent:
        "Budget Matrix Monthly budget: $1,250.50. Monthly spend: $1,250.00. The page explains budget ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer budget questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the monthly budget?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "$1,250.50",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "monthly budget",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts concise numeric label-value answer with existential count wording", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent: "Support Matrix Open tickets: 14 Closed tickets: 9",
      pageContent:
        "Support Matrix Open tickets: 14. Closed tickets: 9. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open tickets are there?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "14",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open tickets",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept the wrong existential count label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent: "Support Matrix Open tickets: 9 Closed tickets: 14",
      pageContent:
        "Support Matrix Open tickets: 9. Closed tickets: 14. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open tickets are there?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "14",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open tickets",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise numeric label-value answer with number-of count wording", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent: "Support Matrix Open tickets: 14 Closed tickets: 9",
      pageContent:
        "Support Matrix Open tickets: 14. Closed tickets: 9. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the number of open tickets?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "14",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open tickets",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept the wrong number-of count label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent: "Support Matrix Open tickets: 9 Closed tickets: 14",
      pageContent:
        "Support Matrix Open tickets: 9. Closed tickets: 14. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the number of open tickets?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "14",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open tickets",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded identifier label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Incident Matrix",
      url: "https://example.test/incidents",
      visibleContent:
        "Incident Matrix Incident number: INC0012345 Change number: CHG0099",
      pageContent:
        "Incident Matrix Incident number: INC0012345. Change number: CHG0099. The page explains service coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer incident questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the incident number?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "INC0012345",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "incident number",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept the wrong concise identifier label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Incident Matrix",
      url: "https://example.test/incidents",
      visibleContent:
        "Incident Matrix Incident number: INC0012345 Change number: CHG0099",
      pageContent:
        "Incident Matrix Incident number: INC0012345. Change number: CHG0099. The page explains service coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer incident questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the incident number?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "CHG0099",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "incident number",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded hyphenated identifier label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Incident Matrix",
      url: "https://example.test/incidents",
      visibleContent:
        "Incident Matrix Case number: CASE-1234 Related case: CASE-1234-B",
      pageContent:
        "Incident Matrix Case number: CASE-1234. Related case: CASE-1234-B. The page explains service coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer incident questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the case number?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "CASE-1234",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "case number",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept identifier prefix inside a longer identifier", () => {
    const snap = workflowSnapshot({
      title: "Incident Matrix",
      url: "https://example.test/incidents",
      visibleContent:
        "Incident Matrix Case number: CASE-1234 Related case: CASE-1234-B",
      pageContent:
        "Incident Matrix Case number: CASE-1234. Related case: CASE-1234-B. The page explains service coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer incident questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the case number?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "CASE-1234-B",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "case number",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded uuid label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Session Matrix",
      url: "https://example.test/sessions",
      visibleContent:
        "Session Matrix Session ID: 4a0402d6-ad57-435e-8db0-6bf179f30366 Request ID: 7d9dcf6e-b399-4d33-a8f2-9a60f0217a2a",
      pageContent:
        "Session Matrix Session ID: 4a0402d6-ad57-435e-8db0-6bf179f30366. Request ID: 7d9dcf6e-b399-4d33-a8f2-9a60f0217a2a. The page explains session ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer session questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the session ID?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "4a0402d6-ad57-435e-8db0-6bf179f30366",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "session id",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling uuid label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Session Matrix",
      url: "https://example.test/sessions",
      visibleContent:
        "Session Matrix Session ID: 4a0402d6-ad57-435e-8db0-6bf179f30366 Request ID: 7d9dcf6e-b399-4d33-a8f2-9a60f0217a2a",
      pageContent:
        "Session Matrix Session ID: 4a0402d6-ad57-435e-8db0-6bf179f30366. Request ID: 7d9dcf6e-b399-4d33-a8f2-9a60f0217a2a. The page explains session ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer session questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the session ID?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "7d9dcf6e-b399-4d33-a8f2-9a60f0217a2a",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "session id",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded hash label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix Release SHA256 hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 Backup hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      pageContent:
        "Release Matrix Release SHA256 hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08. Backup hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855. The page explains release ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the release SHA256 hash?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "release sha256 hash",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling hash label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix Release SHA256 hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 Backup hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      pageContent:
        "Release Matrix Release SHA256 hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08. Backup hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855. The page explains release ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the release SHA256 hash?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "release sha256 hash",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept hash prefix inside a longer value", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix Release SHA256 hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 Backup hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      pageContent:
        "Release Matrix Release SHA256 hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08. Backup hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855. The page explains release ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the release SHA256 hash?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08-backup",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "release sha256 hash",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded version label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix App version: v2.4.1 API version: v2.4.0",
      pageContent:
        "Release Matrix App version: v2.4.1. API version: v2.4.0. The page explains release ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the app version?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "v2.4.1",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "app version",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling version label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix App version: v2.4.1 API version: v2.4.0",
      pageContent:
        "Release Matrix App version: v2.4.1. API version: v2.4.0. The page explains release ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the app version?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "v2.4.0",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "app version",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept same-prefix longer version label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix App version: v2.4.1 API version: v2.4.10",
      pageContent:
        "Release Matrix App version: v2.4.1. API version: v2.4.10. The page explains release ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the app version?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "v2.4.10",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "app version",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept arbitrary single-word label-value answer summaries", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent: "Support Matrix Escalation owner: Alice Team: Bob",
      pageContent:
        "Support Matrix Escalation owner: Alice. Team: Bob. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the escalation owner?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Alice",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "escalation owner",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded date label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Schedule Matrix",
      url: "https://example.test/schedule",
      visibleContent:
        "Schedule Matrix Due date: 2026-05-18 Review date: 2026-06-01",
      pageContent:
        "Schedule Matrix Due date: 2026-05-18. Review date: 2026-06-01. The page explains schedule ownership, release priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer schedule questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "When is the due date?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-05-18",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "due date",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept the wrong concise date label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Schedule Matrix",
      url: "https://example.test/schedule",
      visibleContent:
        "Schedule Matrix Due date: 2026-05-18 Review date: 2026-06-01",
      pageContent:
        "Schedule Matrix Due date: 2026-05-18. Review date: 2026-06-01. The page explains schedule ownership, release priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer schedule questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "When is the due date?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-06-01",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "due date",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise date-range label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix Deployment window: 2026-05-18 - 2026-05-20 Backup window: 2026-06-01 - 2026-06-03",
      pageContent:
        "Release Matrix Deployment window: 2026-05-18 - 2026-05-20. Backup window: 2026-06-01 - 2026-06-03. The page explains release ownership, deployment policy, schedule windows, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the deployment window?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-05-18-2026-05-20",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-06-01-2026-06-03",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "deployment window",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("accepts date-range label-value answer with to separator", () => {
    const snap = workflowSnapshot({
      title: "Freeze Matrix",
      url: "https://example.test/freezes",
      visibleContent:
        "Freeze Matrix Freeze period: 2026-11-01 to 2026-11-15 Backup period: 2026-12-01 to 2026-12-15",
      pageContent:
        "Freeze Matrix Freeze period: 2026-11-01 to 2026-11-15. Backup period: 2026-12-01 to 2026-12-15. The page explains freeze ownership, release policy, schedule windows, audit notes, incident routing, maintenance coordination, environment ownership, escalation routing, and manager review so operators can answer freeze questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the freeze period?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-11-01 to 2026-11-15",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "freeze period",
    });
    expect(accepted.status).toBe("accepted");
  });

  test("does not accept date-range concise answers without a date-range label", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix Team code: 2026-05-18 - 2026-05-20 Backup code: 2026-06-01 - 2026-06-03",
      pageContent:
        "Release Matrix Team code: 2026-05-18 - 2026-05-20. Backup code: 2026-06-01 - 2026-06-03. The page explains release ownership, deployment policy, schedule windows, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-05-18 - 2026-05-20",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded time label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Schedule Matrix",
      url: "https://example.test/schedule",
      visibleContent:
        "Schedule Matrix Maintenance time: 14:30 Review time: 15:30",
      pageContent:
        "Schedule Matrix Maintenance time: 14:30. Review time: 15:30. The page explains schedule ownership, release priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer schedule questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "When is the maintenance time?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "14:30",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "maintenance time",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts only the expected concise duration label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent:
        "Runtime Matrix Request timeout: 30s Retry timeout: 60s",
      pageContent:
        "Runtime Matrix Request timeout: 30s. Retry timeout: 60s. The page explains runtime ownership, service coverage, queue behavior, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the request timeout?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "30s",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "60s",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "request timeout",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept unit-like concise answers without a duration label", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent: "Runtime Matrix Team code: 30s Backup code: 60s",
      pageContent:
        "Runtime Matrix Team code: 30s. Backup code: 60s. The page explains runtime ownership, service coverage, queue behavior, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "30s",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise data-size label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Storage Matrix",
      url: "https://example.test/storage",
      visibleContent:
        "Storage Matrix Artifact size: 512 MB Backup size: 1 GB",
      pageContent:
        "Storage Matrix Artifact size: 512 MB. Backup size: 1 GB. The page explains storage ownership, capacity planning, quota behavior, upload limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer storage questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the artifact size?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "512MB",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "1GB",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "artifact size",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept data-size concise answers without a size label", () => {
    const snap = workflowSnapshot({
      title: "Storage Matrix",
      url: "https://example.test/storage",
      visibleContent: "Storage Matrix Team code: 512MB Backup code: 1GB",
      pageContent:
        "Storage Matrix Team code: 512MB. Backup code: 1GB. The page explains storage ownership, capacity planning, quota behavior, upload limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer storage questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "512MB",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise data-rate label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Download speed: 50 Mbps Upload speed: 10 Mbps",
      pageContent:
        "Network Matrix Download speed: 50 Mbps. Upload speed: 10 Mbps. The page explains network ownership, bandwidth planning, throughput behavior, service limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the download speed?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "50Mbps",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "10Mbps",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "download speed",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept data-rate concise answers without a rate label", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent: "Network Matrix Team code: 50Mbps Backup code: 10Mbps",
      pageContent:
        "Network Matrix Team code: 50Mbps. Backup code: 10Mbps. The page explains network ownership, bandwidth planning, throughput behavior, service limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "50Mbps",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise temperature label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Environment Matrix",
      url: "https://example.test/environment",
      visibleContent:
        "Environment Matrix Server temperature: 72 F Backup temperature: 68 F",
      pageContent:
        "Environment Matrix Server temperature: 72 F. Backup temperature: 68 F. The page explains environment monitoring, thermal policy, service limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer environment questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the server temperature?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "72F",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "68F",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "server temperature",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept temperature concise answers without a temperature label", () => {
    const snap = workflowSnapshot({
      title: "Environment Matrix",
      url: "https://example.test/environment",
      visibleContent: "Environment Matrix Team code: 72F Backup code: 68F",
      pageContent:
        "Environment Matrix Team code: 72F. Backup code: 68F. The page explains environment monitoring, thermal policy, service limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer environment questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "72F",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise electrical label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Power Matrix",
      url: "https://example.test/power",
      visibleContent:
        "Power Matrix Output voltage: 12 V Backup voltage: 24 V",
      pageContent:
        "Power Matrix Output voltage: 12 V. Backup voltage: 24 V. The page explains power monitoring, electrical policy, service limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer power questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the output voltage?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "12V",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "24V",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "output voltage",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept electrical concise answers without an electrical label", () => {
    const snap = workflowSnapshot({
      title: "Power Matrix",
      url: "https://example.test/power",
      visibleContent: "Power Matrix Team code: 12V Backup code: 24V",
      pageContent:
        "Power Matrix Team code: 12V. Backup code: 24V. The page explains power monitoring, electrical policy, service limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer power questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "12V",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise mass label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Shipping Matrix",
      url: "https://example.test/shipping",
      visibleContent:
        "Shipping Matrix Package weight: 12 kg Backup weight: 15 kg",
      pageContent:
        "Shipping Matrix Package weight: 12 kg. Backup weight: 15 kg. The page explains shipping policy, payload handling, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer shipping questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the package weight?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "12kg",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "15kg",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "package weight",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept mass concise answers without a mass label", () => {
    const snap = workflowSnapshot({
      title: "Shipping Matrix",
      url: "https://example.test/shipping",
      visibleContent: "Shipping Matrix Team code: 12kg Backup code: 15kg",
      pageContent:
        "Shipping Matrix Team code: 12kg. Backup code: 15kg. The page explains shipping policy, payload handling, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer shipping questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "12kg",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise length label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Dimension Matrix",
      url: "https://example.test/dimensions",
      visibleContent:
        "Dimension Matrix Package width: 12 cm Backup width: 15 cm",
      pageContent:
        "Dimension Matrix Package width: 12 cm. Backup width: 15 cm. The page explains package dimensions, clearance policy, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer dimension questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the package width?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "12cm",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "15cm",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "package width",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept length concise answers without a length label", () => {
    const snap = workflowSnapshot({
      title: "Dimension Matrix",
      url: "https://example.test/dimensions",
      visibleContent: "Dimension Matrix Team code: 12cm Backup code: 15cm",
      pageContent:
        "Dimension Matrix Team code: 12cm. Backup code: 15cm. The page explains package dimensions, clearance policy, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer dimension questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "12cm",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise volume label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Fluid Matrix",
      url: "https://example.test/fluids",
      visibleContent: "Fluid Matrix Tank volume: 12 L Backup volume: 15 L",
      pageContent:
        "Fluid Matrix Tank volume: 12 L. Backup volume: 15 L. The page explains fluid handling, reservoir policy, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer fluid questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the tank volume?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "12L",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "15L",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "tank volume",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept volume concise answers without a volume label", () => {
    const snap = workflowSnapshot({
      title: "Fluid Matrix",
      url: "https://example.test/fluids",
      visibleContent: "Fluid Matrix Team code: 12L Backup code: 15L",
      pageContent:
        "Fluid Matrix Team code: 12L. Backup code: 15L. The page explains fluid handling, reservoir policy, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer fluid questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "12L",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise pressure label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Pressure Matrix",
      url: "https://example.test/pressure",
      visibleContent:
        "Pressure Matrix Tank pressure: 35 psi Backup pressure: 40 psi",
      pageContent:
        "Pressure Matrix Tank pressure: 35 psi. Backup pressure: 40 psi. The page explains hydraulic monitoring, pneumatic policy, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer pressure questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the tank pressure?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "35psi",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "40psi",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "tank pressure",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept pressure concise answers without a pressure label", () => {
    const snap = workflowSnapshot({
      title: "Pressure Matrix",
      url: "https://example.test/pressure",
      visibleContent: "Pressure Matrix Team code: 35psi Backup code: 40psi",
      pageContent:
        "Pressure Matrix Team code: 35psi. Backup code: 40psi. The page explains hydraulic monitoring, pneumatic policy, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer pressure questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "35psi",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise frequency label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Display Matrix",
      url: "https://example.test/display",
      visibleContent:
        "Display Matrix Refresh frequency: 60 Hz Backup frequency: 75 Hz",
      pageContent:
        "Display Matrix Refresh frequency: 60 Hz. Backup frequency: 75 Hz. The page explains display timing, refresh policy, service limits, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer display questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the refresh frequency?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "60Hz",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "75Hz",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "refresh frequency",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept frequency concise answers without a frequency label", () => {
    const snap = workflowSnapshot({
      title: "Display Matrix",
      url: "https://example.test/display",
      visibleContent: "Display Matrix Team code: 60Hz Backup code: 75Hz",
      pageContent:
        "Display Matrix Team code: 60Hz. Backup code: 75Hz. The page explains display timing, refresh policy, service limits, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer display questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "60Hz",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise UTC timezone label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Schedule Matrix",
      url: "https://example.test/schedule",
      visibleContent:
        "Schedule Matrix Time zone: UTC+02:00 Backup time zone: UTC-05:00",
      pageContent:
        "Schedule Matrix Time zone: UTC+02:00. Backup time zone: UTC-05:00. The page explains schedule ownership, time zone policy, service windows, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer schedule questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the time zone?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "UTC+02:00",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "UTC-05:00",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "time zone",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("accepts only the expected concise IANA timezone label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Deployment Matrix",
      url: "https://example.test/deployments",
      visibleContent:
        "Deployment Matrix Deployment timezone: Europe/Berlin Backup timezone: America/New_York",
      pageContent:
        "Deployment Matrix Deployment timezone: Europe/Berlin. Backup timezone: America/New_York. The page explains deployment ownership, time zone policy, service windows, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer deployment questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the deployment timezone?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Europe/Berlin",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "America/New_York",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "deployment timezone",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept timezone concise answers without a timezone label", () => {
    const snap = workflowSnapshot({
      title: "Schedule Matrix",
      url: "https://example.test/schedule",
      visibleContent:
        "Schedule Matrix Team code: UTC+02:00 Backup code: UTC-05:00",
      pageContent:
        "Schedule Matrix Team code: UTC+02:00. Backup code: UTC-05:00. The page explains schedule ownership, time zone policy, service windows, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer schedule questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "UTC+02:00",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise locale label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Localization Matrix",
      url: "https://example.test/localization",
      visibleContent:
        "Localization Matrix Language locale: en-US Backup locale: fr-FR",
      pageContent:
        "Localization Matrix Language locale: en-US. Backup locale: fr-FR. The page explains localization ownership, language policy, regional formatting, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer localization questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the language locale?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "en-US",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "fr-FR",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "language locale",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("accepts only the expected concise extended locale label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Localization Matrix",
      url: "https://example.test/localization",
      visibleContent:
        "Localization Matrix Preferred locale: zh-Hans-CN Backup locale: en-US",
      pageContent:
        "Localization Matrix Preferred locale: zh-Hans-CN. Backup locale: en-US. The page explains localization ownership, language policy, regional formatting, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer localization questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the preferred locale?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "zh-Hans-CN",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "en-US",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "preferred locale",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept locale concise answers without a locale label", () => {
    const snap = workflowSnapshot({
      title: "Localization Matrix",
      url: "https://example.test/localization",
      visibleContent:
        "Localization Matrix Team code: en-US Backup code: fr-FR",
      pageContent:
        "Localization Matrix Team code: en-US. Backup code: fr-FR. The page explains localization ownership, language policy, regional formatting, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer localization questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "en-US",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise coordinate label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Location Matrix",
      url: "https://example.test/locations",
      visibleContent:
        "Location Matrix GPS coordinates: 37.7749, -122.4194 Backup coordinates: 40.7128, -74.0060",
      pageContent:
        "Location Matrix GPS coordinates: 37.7749, -122.4194. Backup coordinates: 40.7128, -74.0060. The page explains location ownership, geolocation policy, routing notes, audit timing, incident routing, maintenance coordination, site ownership, escalation routing, and manager review so operators can answer location questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What are the GPS coordinates?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "37.7749,-122.4194",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "40.7128,-74.0060",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "gps coordinates",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("accepts parenthesized coordinate label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Location Matrix",
      url: "https://example.test/locations",
      visibleContent:
        "Location Matrix Location coordinates: (51.5074, -0.1278) Backup coordinates: (48.8566, 2.3522)",
      pageContent:
        "Location Matrix Location coordinates: (51.5074, -0.1278). Backup coordinates: (48.8566, 2.3522). The page explains location ownership, geolocation policy, routing notes, audit timing, incident routing, maintenance coordination, site ownership, escalation routing, and manager review so operators can answer location questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What are the location coordinates?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "51.5074,-0.1278",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "location coordinates",
    });
    expect(accepted.status).toBe("accepted");
  });

  test("does not accept coordinate concise answers without a coordinate label", () => {
    const snap = workflowSnapshot({
      title: "Location Matrix",
      url: "https://example.test/locations",
      visibleContent:
        "Location Matrix Team code: 37.7749, -122.4194 Backup code: 40.7128, -74.0060",
      pageContent:
        "Location Matrix Team code: 37.7749, -122.4194. Backup code: 40.7128, -74.0060. The page explains location ownership, geolocation policy, routing notes, audit timing, incident routing, maintenance coordination, site ownership, escalation routing, and manager review so operators can answer location questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "37.7749, -122.4194",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise time-window label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Maintenance Matrix",
      url: "https://example.test/maintenance",
      visibleContent:
        "Maintenance Matrix Maintenance window: 02:00-04:00 Backup window: 05:00-07:00",
      pageContent:
        "Maintenance Matrix Maintenance window: 02:00-04:00. Backup window: 05:00-07:00. The page explains maintenance ownership, schedule policy, service windows, audit notes, incident routing, coordination plans, device ownership, escalation routing, and manager review so operators can answer maintenance questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the maintenance window?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "02:00-04:00",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "05:00-07:00",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "maintenance window",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("accepts spaced time-window label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Service window: 09:00 - 17:30 Backup window: 18:00 - 20:00",
      pageContent:
        "Support Matrix Service window: 09:00 - 17:30. Backup window: 18:00 - 20:00. The page explains support ownership, service hours, schedule policy, audit notes, incident routing, coordination plans, queue ownership, escalation routing, and manager review so operators can answer support questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the service window?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "09:00-17:30",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "service window",
    });
    expect(accepted.status).toBe("accepted");
  });

  test("does not accept time-window concise answers without a time-window label", () => {
    const snap = workflowSnapshot({
      title: "Maintenance Matrix",
      url: "https://example.test/maintenance",
      visibleContent:
        "Maintenance Matrix Team code: 02:00-04:00 Backup code: 05:00-07:00",
      pageContent:
        "Maintenance Matrix Team code: 02:00-04:00. Backup code: 05:00-07:00. The page explains maintenance ownership, schedule policy, service windows, audit notes, incident routing, coordination plans, device ownership, escalation routing, and manager review so operators can answer maintenance questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "02:00-04:00",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise physical speed label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Route Matrix",
      url: "https://example.test/routes",
      visibleContent: "Route Matrix Cruise speed: 55 mph Backup speed: 60 mph",
      pageContent:
        "Route Matrix Cruise speed: 55 mph. Backup speed: 60 mph. The page explains route timing, travel policy, service limits, audit notes, incident routing, maintenance coordination, fleet ownership, escalation routing, and manager review so operators can answer route questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the cruise speed?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "55mph",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "60mph",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "cruise speed",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept physical speed concise answers without a speed label", () => {
    const snap = workflowSnapshot({
      title: "Route Matrix",
      url: "https://example.test/routes",
      visibleContent: "Route Matrix Team code: 55mph Backup code: 60mph",
      pageContent:
        "Route Matrix Team code: 55mph. Backup code: 60mph. The page explains route timing, travel policy, service limits, audit notes, incident routing, maintenance coordination, fleet ownership, escalation routing, and manager review so operators can answer route questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "55mph",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise area label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Facility Matrix",
      url: "https://example.test/facility",
      visibleContent:
        "Facility Matrix Room area: 250 sq ft Backup area: 300 sq ft",
      pageContent:
        "Facility Matrix Room area: 250 sq ft. Backup area: 300 sq ft. The page explains facility planning, floor space policy, service limits, audit notes, incident routing, maintenance coordination, site ownership, escalation routing, and manager review so operators can answer facility questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the room area?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "250sqft",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "300sqft",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "room area",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept area concise answers without an area label", () => {
    const snap = workflowSnapshot({
      title: "Facility Matrix",
      url: "https://example.test/facility",
      visibleContent: "Facility Matrix Team code: 250sqft Backup code: 300sqft",
      pageContent:
        "Facility Matrix Team code: 250sqft. Backup code: 300sqft. The page explains facility planning, floor space policy, service limits, audit notes, incident routing, maintenance coordination, site ownership, escalation routing, and manager review so operators can answer facility questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "250sqft",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise hex color label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Primary color: #1A2B3C Backup color: #00FF00",
      pageContent:
        "Theme Matrix Primary color: #1A2B3C. Backup color: #00FF00. The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary color?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "#1A2B3C",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "#00FF00",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary color",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept hex color concise answers without a color label", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Team code: #1A2B3C Backup code: #00FF00",
      pageContent:
        "Theme Matrix Team code: #1A2B3C. Backup code: #00FF00. The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "#1A2B3C",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise rgb color label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Primary color: rgb(12, 34, 56) Backup color: rgb(90, 80, 70)",
      pageContent:
        "Theme Matrix Primary color: rgb(12, 34, 56). Backup color: rgb(90, 80, 70). The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary color?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rgb(12,34,56)",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rgb(90,80,70)",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary color",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept rgb color concise answers without a color label", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Team code: rgb(12, 34, 56) Backup code: rgb(90, 80, 70)",
      pageContent:
        "Theme Matrix Team code: rgb(12, 34, 56). Backup code: rgb(90, 80, 70). The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rgb(12,34,56)",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise hsl color label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Primary color: hsl(210, 50%, 40%) Backup color: hsl(120, 60%, 50%)",
      pageContent:
        "Theme Matrix Primary color: hsl(210, 50%, 40%). Backup color: hsl(120, 60%, 50%). The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary color?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "hsl(210,50%,40%)",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "hsl(120,60%,50%)",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary color",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept hsl color concise answers without a color label", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Team code: hsl(210, 50%, 40%) Backup code: hsl(120, 60%, 50%)",
      pageContent:
        "Theme Matrix Team code: hsl(210, 50%, 40%). Backup code: hsl(120, 60%, 50%). The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "hsl(210,50%,40%)",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise modern rgb color label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Primary color: rgb(12 34 56 / 0.5) Backup color: rgb(90 80 70 / 75%)",
      pageContent:
        "Theme Matrix Primary color: rgb(12 34 56 / 0.5). Backup color: rgb(90 80 70 / 75%). The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary color?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rgb(12 34 56/0.5)",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rgb(90 80 70/75%)",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary color",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("accepts only the expected concise modern hsl color label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Primary color: hsl(210 50% 40% / 0.75) Backup color: hsl(120 60% 50% / 75%)",
      pageContent:
        "Theme Matrix Primary color: hsl(210 50% 40% / 0.75). Backup color: hsl(120 60% 50% / 75%). The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary color?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "hsl(210 50% 40%/0.75)",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "hsl(120 60% 50%/75%)",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary color",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept modern slash color concise answers without a color label", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Team code: rgb(12 34 56 / 0.5) Backup code: hsl(120 60% 50% / 75%)",
      pageContent:
        "Theme Matrix Team code: rgb(12 34 56 / 0.5). Backup code: hsl(120 60% 50% / 75%). The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rgb(12 34 56/0.5)",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise named color label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Primary color: rebeccapurple Backup color: steelblue",
      pageContent:
        "Theme Matrix Primary color: rebeccapurple. Backup color: steelblue. The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary color?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rebeccapurple",
    });
    const rejectedSibling = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "steelblue",
    });
    const rejectedCompound = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rebeccapurple-blue",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary color",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejectedSibling.status).toBe("inconclusive");
    expect(rejectedCompound.status).toBe("inconclusive");
  });

  test("does not accept named color concise answers without a color label", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Team code: rebeccapurple Backup code: steelblue",
      pageContent:
        "Theme Matrix Team code: rebeccapurple. Backup code: steelblue. The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rebeccapurple",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded boolean label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Security Matrix",
      url: "https://example.test/security",
      visibleContent: "Security Matrix MFA enabled: Yes Password rotation: No",
      pageContent:
        "Security Matrix MFA enabled: Yes. Password rotation: No. The page explains access controls, session policy, device posture, authentication coverage, audit cadence, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer security policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is MFA enabled?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "mfa enabled",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept the wrong concise boolean label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Security Matrix",
      url: "https://example.test/security",
      visibleContent: "Security Matrix MFA enabled: No Password rotation: Yes",
      pageContent:
        "Security Matrix MFA enabled: No. Password rotation: Yes. The page explains access controls, session policy, device posture, authentication coverage, audit cadence, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer security policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is MFA enabled?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "mfa enabled",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not use boolean read-answer without visible label-value evidence", () => {
    const generated = generateCompletionContract({
      userRequest: "Is MFA enabled?",
      snapshot: workflowSnapshot({
        title: "Security Matrix",
        url: "https://example.test/security",
        visibleContent:
          "Security Matrix The access control policy describes multi-factor authentication and password rotation.",
        pageContent:
          "Security Matrix The access control policy describes multi-factor authentication and password rotation. The page explains access controls, session policy, device posture, authentication coverage, audit cadence, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review, but it does not state a final MFA enabled value.",
      }),
    });

    expect(generated).toBeNull();
  });

  test("accepts only the expected concise status label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Incident Matrix",
      url: "https://example.test/incidents",
      visibleContent:
        "Incident Matrix Incident status: Closed Approval state: Open",
      pageContent:
        "Incident Matrix Incident status: Closed. Approval state: Open. The page explains service coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer incident status questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the incident status?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Closed.",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Open",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "incident status",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("accepts only the expected concise priority label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Incident Matrix",
      url: "https://example.test/incidents",
      visibleContent:
        "Incident Matrix Incident priority: High Approval priority: Low",
      pageContent:
        "Incident Matrix Incident priority: High. Approval priority: Low. The page explains service coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer incident priority questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the incident priority?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "High.",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Low",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "incident priority",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("accepts concise grounded label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix SLA: four hours Escalation owner: platform operations",
      pageContent:
        "Support Matrix SLA: four hours for urgent incidents. Escalation owner: platform operations. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the SLA?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "SLA: four hours",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "sla",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts concise grounded label-is-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix SLA is four hours Escalation owner is platform operations",
      pageContent:
        "Support Matrix SLA is four hours for urgent incidents. Escalation owner is platform operations. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the SLA?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "SLA: four hours",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "sla",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts concise grounded label-dash-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix SLA - four hours Escalation owner - platform operations",
      pageContent:
        "Support Matrix SLA - four hours for urgent incidents. Escalation owner - platform operations. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the SLA?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "SLA: four hours",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "sla",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept another page value for a label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix SLA: four hours Escalation owner: platform operations",
      pageContent:
        "Support Matrix SLA: four hours for urgent incidents. Escalation owner: platform operations. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the SLA?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "platform operations",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "sla",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not use label-is-value read-answer for explanatory boilerplate", () => {
    const generated = generateCompletionContract({
      userRequest: "What is the SLA?",
      snapshot: workflowSnapshot({
        title: "Support Matrix",
        url: "https://example.test/support",
        visibleContent:
          "Support Matrix The SLA is described in this policy and related escalation notes.",
        pageContent:
          "Support Matrix The SLA is described in this policy and related escalation notes. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, and manager review, but it does not state a final SLA value.",
      }),
    });

    expect(generated).toBeNull();
  });

  test("does not use label-dash-value read-answer for explanatory boilerplate", () => {
    const generated = generateCompletionContract({
      userRequest: "What is the SLA?",
      snapshot: workflowSnapshot({
        title: "Support Matrix",
        url: "https://example.test/support",
        visibleContent:
          "Support Matrix SLA - described in this policy and related escalation notes.",
        pageContent:
          "Support Matrix SLA - described in this policy and related escalation notes. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, and manager review, but it does not state a final SLA value.",
      }),
    });

    expect(generated).toBeNull();
  });

  test("does not use label-value read-answer for modifier-only questions", () => {
    const generated = generateCompletionContract({
      userRequest: "What is the current?",
      snapshot: workflowSnapshot({
        title: "Support Matrix",
        url: "https://example.test/support",
        visibleContent:
          "Support Matrix SLA: four hours Escalation owner: platform operations",
        pageContent:
          "Support Matrix SLA: four hours for urgent incidents. Escalation owner: platform operations. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, and manager review so operators can answer support policy questions from visible page evidence.",
      }),
    });

    expect(generated).toBeNull();
  });

  test("does not use label-value read-answer when the page has no value-like label", () => {
    const generated = generateCompletionContract({
      userRequest: "What is the SLA?",
      snapshot: workflowSnapshot({
        title: "Support Matrix",
        url: "https://example.test/support",
        visibleContent:
          "Support Matrix The SLA applies to urgent incidents and escalation policies.",
        pageContent:
          "Support Matrix The SLA applies to urgent incidents and escalation policies, but this page has no final target value. It explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, and manager review.",
      }),
    });

    expect(generated).toBeNull();
  });

  test("does not use read-answer for ungrounded direct factual question", () => {
    const generated = generateCompletionContract({
      userRequest: "What is the refund policy?",
      snapshot: workflowSnapshot({
        title: "Warehouse Counts",
        url: "https://example.test/warehouses",
        visibleContent:
          "Warehouse Beta inventory count is 7,318 units. Warehouse Delta inventory count is 2,184 units.",
        pageContent:
          "Warehouse Beta inventory count is 7,318 units. Warehouse Delta inventory count is 2,184 units. The page compares inventory counts, receiving backlog, audit timing, and replenishment notes so operators can answer factual warehouse questions from the page evidence.",
      }),
    });

    expect(generated).toBeNull();
  });

  test("does not use read-answer for dashboard chart value extraction", () => {
    const generated = generateCompletionContract({
      userRequest: "What is the highest value on this dashboard chart?",
      snapshot: workflowSnapshot({
        title: "Revenue Dashboard",
        visibleContent: "Revenue dashboard with a line chart",
        pageContent: "Revenue dashboard with a line chart",
      }),
    });

    expect(generated).toBeNull();
  });

  test("requires page evidence before read-answer completion", () => {
    const snap = workflowSnapshot({
      title: "Sparse",
      visibleContent: "Loading...",
      pageContent: "Loading...",
    });
    const generated = generateCompletionContract({
      userRequest: "Summarize this page.",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: [],
      snapshot: snap,
      candidateSource: "model_done",
      summary: "The page has a useful overview.",
    });

    expect(generated?.contract).toMatchObject({ kind: "read_answer" });
    expect(decision.status).toBe("needs_verification");
    expect(decision.reason).toContain("no grounded page-read evidence");
  });

  test("rejects read-answer completion missing required multi-return coverage", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Gamma inventory count is 6,412 units. Warehouse Alpha inventory count is 4,827 units.",
      pageContent:
        "Warehouse Gamma inventory count is 6,412 units. Warehouse Alpha inventory count is 4,827 units. The page compares current stock levels, receiving backlog, audit status, and replenishment timing for both warehouses so operators can report both requested inventory numbers from the page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest:
        "From this page, tell me both numbers for Warehouse Gamma and Warehouse Alpha.",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Warehouse Gamma inventory count is 6,412 units.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      taskContract: {
        multiReturnCount: 2,
        requiredEntities: expect.arrayContaining([
          "warehouse gamma",
          "warehouse alpha",
        ]),
      },
    });
    expect(decision.status).toBe("rejected");
    expect(decision.reason).toContain("multi-return");
    expect(decision.reason).toContain("warehouse alpha");
  });

  test("accepts read-answer completion with required multi-return coverage", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Gamma inventory count is 6,412 units. Warehouse Alpha inventory count is 4,827 units.",
      pageContent:
        "Warehouse Gamma inventory count is 6,412 units. Warehouse Alpha inventory count is 4,827 units. The page compares current stock levels, receiving backlog, audit status, and replenishment timing for both warehouses so operators can report both requested inventory numbers from the page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest:
        "From this page, tell me both numbers for Warehouse Gamma and Warehouse Alpha.",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "Warehouse Gamma inventory count is 6,412 units. Warehouse Alpha inventory count is 4,827 units.",
    });

    expect(generated?.source).toBe("task_contract");
    expect(decision.status).toBe("accepted");
  });

  test("derives read-answer evidence from read_page results", () => {
    const snap = workflowSnapshot({
      title: "Release Notes",
      url: "https://example.test/releases",
      visibleContent: "Release notes",
      pageContent: "Release notes",
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content: Release notes explain that version 2.4 adds audit exports, improves dashboard load time, updates permission checks, and fixes the account settings save flow for administrators.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "answer_state",
          confidence: "high",
          logicalKey: expect.stringContaining("read_answer:page:"),
          observedAtTurn: 9,
          detail: expect.objectContaining({
            source: "page_read",
            url: "https://example.test/releases",
          }),
        }),
      ]),
    );
  });

  test("builds stable completion envelope metadata from accepted evidence", () => {
    const snap = snapshot();
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 8);

    const envelope = buildCompletionEnvelope({
      source: "model_done",
      contractKind: "quiz_selection",
      decisionReason: "Quiz select-only contract is satisfied.",
      evidence,
      turn: 8,
      summary:
        "Selected Domain Adaptation Fine-Tuning and Continued Pre-Training.",
    });
    const duplicate = buildCompletionEnvelope({
      source: "model_done",
      contractKind: "quiz_selection",
      decisionReason: "Quiz select-only contract is satisfied.",
      evidence,
      turn: 8,
      summary:
        "Selected Domain Adaptation Fine-Tuning and Continued Pre-Training.",
    });

    expect(envelope).toMatchObject({
      status: "completed",
      source: "model_done",
      contractKind: "quiz_selection",
      decisionReason: "Quiz select-only contract is satisfied.",
      evidenceKeys: expect.arrayContaining([
        expect.stringContaining("domain-adaptation-fine-tuning"),
      ]),
    });
    expect(envelope.resultId).toBe(duplicate.resultId);
    expect(envelope.evidenceEpoch).toBe(duplicate.evidenceEpoch);
  });

  test("builds typed trusted read-answer completion evidence", () => {
    const candidate = buildTrustedReadAnswerCompletionCandidate({
      workflow: "search-answer-extraction",
      answer: "100",
      source: "knowledge_base_search",
      turn: 9,
      question:
        "Each year, how many new hires does the company typically make?",
      evidenceText:
        "The average number of yearly hires is 100, reflecting sustained growth.",
      url: "https://example.service-now.test/kb",
    });

    expect(candidate).toMatchObject({
      contractKind: "read_answer",
      decisionReason: expect.stringContaining(
        "grounded knowledge base search evidence",
      ),
      evidence: [
        expect.objectContaining({
          type: "answer_state",
          confidence: "high",
          logicalKey: expect.stringContaining(
            "trusted:search-answer-extraction:answer",
          ),
          observedAtTurn: 9,
          detail: expect.objectContaining({
            answer: "100",
            source: "knowledge_base_search",
            url: "https://example.service-now.test/kb",
          }),
        }),
      ],
    });
  });
});
