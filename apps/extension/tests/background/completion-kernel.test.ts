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
  evaluateCompletionSummaryPreflight,
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
