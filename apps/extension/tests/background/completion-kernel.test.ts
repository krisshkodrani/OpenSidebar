import { describe, expect, test } from "vitest";
import "../setup";
import {
  CompletionEvidenceLedger,
  buildCompletionRecoveryHint,
  deriveCompletionEvidenceFromSnapshot,
  deriveCompletionEvidenceFromToolOutcome,
  evaluateCompletionContract,
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

function rowElement(tag: number, text: string): TaggedElement {
  const key = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    tag,
    tagName: "tr",
    role: "row",
    text,
    attributes: {
      id: `row-${key}`,
    },
    rect: { x: 0, y: tag * 20, width: 600, height: 32 },
    isVisible: true,
    isDisabled: false,
  };
}

describe("completion kernel", () => {
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

  test("rejects targetless visible delete completion for a named target", () => {
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
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
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

  test("rejects targetless visible archive completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Archive completed.",
      pageContent: "Archive completed.",
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
      summary: "Archive completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "archive",
      targetLabel: "Report Alpha",
    });
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

  for (const scenario of [
    {
      action: "save",
      request: "Save Draft Alpha.",
      summary: "Saved Draft Alpha.",
      targetLabel: "Draft Alpha",
      requestedVisible:
        "Draft Beta remains unsaved. Draft Alpha saved successfully.",
      requestedEvidenceText: "Draft Alpha saved successfully.",
      otherVisible: "Draft Alpha remains unsaved. Draft Beta saved successfully.",
      otherEvidenceText: "Draft Beta saved successfully.",
      genericVisible: "Save completed.",
      genericSummary: "Save completed.",
    },
    {
      action: "send",
      request: "Send Message Alpha.",
      summary: "Sent Message Alpha.",
      targetLabel: "Message Alpha",
      requestedVisible:
        "Message Beta remains draft. Message Alpha sent successfully.",
      requestedEvidenceText: "Message Alpha sent successfully.",
      otherVisible:
        "Message Alpha remains draft. Message Beta sent successfully.",
      otherEvidenceText: "Message Beta sent successfully.",
      genericVisible: "Send completed.",
      genericSummary: "Send completed.",
    },
    {
      action: "export",
      request: "Export Report Alpha.",
      summary: "Exported Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains available. Report Alpha exported successfully.",
      requestedEvidenceText: "Report Alpha exported successfully.",
      otherVisible:
        "Report Alpha remains available. Report Beta exported successfully.",
      otherEvidenceText: "Report Beta exported successfully.",
      genericVisible: "Export completed.",
      genericSummary: "Export completed.",
    },
    {
      action: "download",
      request: "Download File Alpha.",
      summary: "Downloaded File Alpha.",
      targetLabel: "File Alpha",
      requestedVisible:
        "File Beta remains available. File Alpha downloaded successfully.",
      requestedEvidenceText: "File Alpha downloaded successfully.",
      otherVisible:
        "File Alpha remains available. File Beta downloaded successfully.",
      otherEvidenceText: "File Beta downloaded successfully.",
      genericVisible: "Download completed.",
      genericSummary: "Download completed.",
    },
    {
      action: "upload",
      request: "Upload Attachment Alpha.",
      summary: "Uploaded Attachment Alpha.",
      targetLabel: "Attachment Alpha",
      requestedVisible:
        "Attachment Beta remains pending. Attachment Alpha uploaded successfully.",
      requestedEvidenceText: "Attachment Alpha uploaded successfully.",
      otherVisible:
        "Attachment Alpha remains pending. Attachment Beta uploaded successfully.",
      otherEvidenceText: "Attachment Beta uploaded successfully.",
      genericVisible: "Upload completed.",
      genericSummary: "Upload completed.",
    },
    {
      action: "import",
      request: "Import Contacts Alpha.",
      summary: "Imported Contacts Alpha.",
      targetLabel: "Contacts Alpha",
      requestedVisible:
        "Contacts Beta remains pending. Contacts Alpha imported successfully.",
      requestedEvidenceText: "Contacts Alpha imported successfully.",
      otherVisible:
        "Contacts Alpha remains pending. Contacts Beta imported successfully.",
      otherEvidenceText: "Contacts Beta imported successfully.",
      genericVisible: "Import completed.",
      genericSummary: "Import completed.",
    },
    {
      action: "copy",
      request: "Copy Link Alpha.",
      summary: "Copied Link Alpha.",
      targetLabel: "Link Alpha",
      requestedVisible:
        "Link Beta remains available. Link Alpha copied successfully.",
      requestedEvidenceText: "Link Alpha copied successfully.",
      otherVisible:
        "Link Alpha remains available. Link Beta copied successfully.",
      otherEvidenceText: "Link Beta copied successfully.",
      genericVisible: "Copied to clipboard.",
      genericSummary: "Copy completed.",
    },
    {
      action: "transfer",
      request: "Transfer Ticket Alpha.",
      summary: "Transferred Ticket Alpha.",
      targetLabel: "Ticket Alpha",
      requestedVisible:
        "Ticket Beta remains in the queue. Ticket Alpha transferred successfully.",
      requestedEvidenceText: "Ticket Alpha transferred successfully.",
      otherVisible:
        "Ticket Alpha remains in the queue. Ticket Beta transferred successfully.",
      otherEvidenceText: "Ticket Beta transferred successfully.",
      genericVisible: "Transfer completed.",
      genericSummary: "Transfer completed.",
    },
    {
      action: "move",
      request: "Move Card Alpha.",
      summary: "Moved Card Alpha.",
      targetLabel: "Card Alpha",
      requestedVisible:
        "Card Beta remains in Backlog. Card Alpha moved successfully.",
      requestedEvidenceText: "Card Alpha moved successfully.",
      otherVisible:
        "Card Alpha remains in Backlog. Card Beta moved successfully.",
      otherEvidenceText: "Card Beta moved successfully.",
      genericVisible: "Move completed.",
      genericSummary: "Move completed.",
    },
    {
      action: "rename",
      request: "Rename File Alpha.",
      summary: "Renamed File Alpha.",
      targetLabel: "File Alpha",
      requestedVisible:
        "File Beta keeps its name. File Alpha renamed successfully.",
      requestedEvidenceText: "File Alpha renamed successfully.",
      otherVisible:
        "File Alpha keeps its name. File Beta renamed successfully.",
      otherEvidenceText: "File Beta renamed successfully.",
      genericVisible: "Rename completed.",
      genericSummary: "Rename completed.",
    },
    {
      action: "merge",
      request: "Merge Pull Request Alpha.",
      summary: "Merged Pull Request Alpha.",
      targetLabel: "Pull Request Alpha",
      requestedVisible:
        "Pull Request Beta remains open. Pull Request Alpha merged successfully.",
      requestedEvidenceText: "Pull Request Alpha merged successfully.",
      otherVisible:
        "Pull Request Alpha remains open. Pull Request Beta merged successfully.",
      otherEvidenceText: "Pull Request Beta merged successfully.",
      genericVisible: "Merge completed.",
      genericSummary: "Merge completed.",
    },
    {
      action: "schedule",
      request: "Schedule Report Alpha.",
      summary: "Scheduled Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains unscheduled. Report Alpha scheduled successfully.",
      requestedEvidenceText: "Report Alpha scheduled successfully.",
      otherVisible:
        "Report Alpha remains unscheduled. Report Beta scheduled successfully.",
      otherEvidenceText: "Report Beta scheduled successfully.",
      genericVisible: "Schedule completed.",
      genericSummary: "Schedule completed.",
    },
    {
      action: "unschedule",
      request: "Unschedule Report Alpha.",
      summary: "Unscheduled Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains scheduled. Report Alpha unscheduled successfully.",
      requestedEvidenceText: "Report Alpha unscheduled successfully.",
      otherVisible:
        "Report Alpha remains scheduled. Report Beta unscheduled successfully.",
      otherEvidenceText: "Report Beta unscheduled successfully.",
      genericVisible: "Unschedule completed.",
      genericSummary: "Unschedule completed.",
    },
    {
      action: "deploy",
      request: "Deploy Release Alpha.",
      summary: "Deployed Release Alpha.",
      targetLabel: "Release Alpha",
      requestedVisible:
        "Release Beta remains staged. Release Alpha deployed successfully.",
      requestedEvidenceText: "Release Alpha deployed successfully.",
      otherVisible:
        "Release Alpha remains staged. Release Beta deployed successfully.",
      otherEvidenceText: "Release Beta deployed successfully.",
      genericVisible: "Deployment completed.",
      genericSummary: "Deployment completed.",
    },
    {
      action: "rollback",
      request: "Rollback Release Alpha.",
      summary: "Rolled back Release Alpha.",
      targetLabel: "Release Alpha",
      requestedVisible:
        "Release Beta remains active. Release Alpha rolled back successfully.",
      requestedEvidenceText: "Release Alpha rolled back successfully.",
      otherVisible:
        "Release Alpha remains active. Release Beta rolled back successfully.",
      otherEvidenceText: "Release Beta rolled back successfully.",
      genericVisible: "Rollback completed.",
      genericSummary: "Rollback completed.",
    },
    {
      action: "backup",
      request: "Back up Database Alpha.",
      summary: "Backed up Database Alpha.",
      targetLabel: "Database Alpha",
      requestedVisible:
        "Database Beta remains unbacked. Database Alpha backed up successfully.",
      requestedEvidenceText: "Database Alpha backed up successfully.",
      otherVisible:
        "Database Alpha remains unbacked. Database Beta backed up successfully.",
      otherEvidenceText: "Database Beta backed up successfully.",
      genericVisible: "Backup completed.",
      genericSummary: "Backup completed.",
    },
    {
      action: "reset",
      request: "Reset Password Alpha.",
      summary: "Reset Password Alpha.",
      targetLabel: "Password Alpha",
      requestedVisible:
        "Password Beta remains unchanged. Password Alpha reset successfully.",
      requestedEvidenceText: "Password Alpha reset successfully.",
      otherVisible:
        "Password Alpha remains unchanged. Password Beta reset successfully.",
      otherEvidenceText: "Password Beta reset successfully.",
      genericVisible: "Reset completed.",
      genericSummary: "Reset completed.",
    },
    {
      action: "suspend",
      request: "Suspend Account Alpha.",
      summary: "Suspended Account Alpha.",
      targetLabel: "Account Alpha",
      requestedVisible:
        "Account Beta remains active. Account Alpha suspended successfully.",
      requestedEvidenceText: "Account Alpha suspended successfully.",
      otherVisible:
        "Account Alpha remains active. Account Beta suspended successfully.",
      otherEvidenceText: "Account Beta suspended successfully.",
      genericVisible: "Suspension completed.",
      genericSummary: "Suspension completed.",
    },
    {
      action: "unsuspend",
      request: "Unsuspend Account Alpha.",
      summary: "Unsuspended Account Alpha.",
      targetLabel: "Account Alpha",
      requestedVisible:
        "Account Beta remains suspended. Account Alpha unsuspended successfully.",
      requestedEvidenceText: "Account Alpha unsuspended successfully.",
      otherVisible:
        "Account Alpha remains suspended. Account Beta unsuspended successfully.",
      otherEvidenceText: "Account Beta unsuspended successfully.",
      genericVisible: "Unsuspend completed.",
      genericSummary: "Unsuspend completed.",
    },
    {
      action: "block",
      request: "Block User Alpha.",
      summary: "Blocked User Alpha.",
      targetLabel: "User Alpha",
      requestedVisible:
        "User Beta remains allowed. User Alpha blocked successfully.",
      requestedEvidenceText: "User Alpha blocked successfully.",
      otherVisible:
        "User Alpha remains allowed. User Beta blocked successfully.",
      otherEvidenceText: "User Beta blocked successfully.",
      genericVisible: "Block completed.",
      genericSummary: "Block completed.",
    },
    {
      action: "unblock",
      request: "Unblock User Alpha.",
      summary: "Unblocked User Alpha.",
      targetLabel: "User Alpha",
      requestedVisible:
        "User Beta remains blocked. User Alpha unblocked successfully.",
      requestedEvidenceText: "User Alpha unblocked successfully.",
      otherVisible:
        "User Alpha remains blocked. User Beta unblocked successfully.",
      otherEvidenceText: "User Beta unblocked successfully.",
      genericVisible: "Unblock completed.",
      genericSummary: "Unblock completed.",
    },
    {
      action: "link",
      request: "Link Account Alpha.",
      summary: "Linked Account Alpha.",
      targetLabel: "Account Alpha",
      requestedVisible:
        "Account Beta remains separate. Account Alpha linked successfully.",
      requestedEvidenceText: "Account Alpha linked successfully.",
      otherVisible:
        "Account Alpha remains separate. Account Beta linked successfully.",
      otherEvidenceText: "Account Beta linked successfully.",
      genericVisible: "Link completed.",
      genericSummary: "Link completed.",
    },
    {
      action: "unlink",
      request: "Unlink Account Alpha.",
      summary: "Unlinked Account Alpha.",
      targetLabel: "Account Alpha",
      requestedVisible:
        "Account Beta remains linked. Account Alpha unlinked successfully.",
      requestedEvidenceText: "Account Alpha unlinked successfully.",
      otherVisible:
        "Account Alpha remains linked. Account Beta unlinked successfully.",
      otherEvidenceText: "Account Beta unlinked successfully.",
      genericVisible: "Unlink completed.",
      genericSummary: "Unlink completed.",
    },
    {
      action: "tag",
      request: "Tag Issue Alpha.",
      summary: "Tagged Issue Alpha.",
      targetLabel: "Issue Alpha",
      requestedVisible:
        "Issue Beta remains untagged. Issue Alpha tagged successfully.",
      requestedEvidenceText: "Issue Alpha tagged successfully.",
      otherVisible:
        "Issue Alpha remains untagged. Issue Beta tagged successfully.",
      otherEvidenceText: "Issue Beta tagged successfully.",
      genericVisible: "Tag completed.",
      genericSummary: "Tag completed.",
    },
    {
      action: "untag",
      request: "Untag Issue Alpha.",
      summary: "Untagged Issue Alpha.",
      targetLabel: "Issue Alpha",
      requestedVisible:
        "Issue Beta remains tagged. Issue Alpha untagged successfully.",
      requestedEvidenceText: "Issue Alpha untagged successfully.",
      otherVisible:
        "Issue Alpha remains tagged. Issue Beta untagged successfully.",
      otherEvidenceText: "Issue Beta untagged successfully.",
      genericVisible: "Untag completed.",
      genericSummary: "Untag completed.",
    },
    {
      action: "flag",
      request: "Flag Message Alpha.",
      summary: "Flagged Message Alpha.",
      targetLabel: "Message Alpha",
      requestedVisible:
        "Message Beta remains normal. Message Alpha flagged successfully.",
      requestedEvidenceText: "Message Alpha flagged successfully.",
      otherVisible:
        "Message Alpha remains normal. Message Beta flagged successfully.",
      otherEvidenceText: "Message Beta flagged successfully.",
      genericVisible: "Flag completed.",
      genericSummary: "Flag completed.",
    },
    {
      action: "unflag",
      request: "Unflag Message Alpha.",
      summary: "Unflagged Message Alpha.",
      targetLabel: "Message Alpha",
      requestedVisible:
        "Message Beta remains flagged. Message Alpha unflagged successfully.",
      requestedEvidenceText: "Message Alpha unflagged successfully.",
      otherVisible:
        "Message Alpha remains flagged. Message Beta unflagged successfully.",
      otherEvidenceText: "Message Beta unflagged successfully.",
      genericVisible: "Unflag completed.",
      genericSummary: "Unflag completed.",
    },
    {
      action: "duplicate",
      request: "Duplicate Record Alpha.",
      summary: "Duplicated Record Alpha.",
      targetLabel: "Record Alpha",
      requestedVisible:
        "Record Beta remains original. Record Alpha duplicated successfully.",
      requestedEvidenceText: "Record Alpha duplicated successfully.",
      otherVisible:
        "Record Alpha remains original. Record Beta duplicated successfully.",
      otherEvidenceText: "Record Beta duplicated successfully.",
      genericVisible: "Duplicate completed.",
      genericSummary: "Duplicate completed.",
    },
    {
      action: "restore",
      request: "Restore Record Alpha.",
      summary: "Restored Record Alpha.",
      targetLabel: "Record Alpha",
      requestedVisible:
        "Record Beta remains archived. Record Alpha restored successfully.",
      requestedEvidenceText: "Record Alpha restored successfully.",
      otherVisible:
        "Record Alpha remains archived. Record Beta restored successfully.",
      otherEvidenceText: "Record Beta restored successfully.",
      genericVisible: "Restore completed.",
      genericSummary: "Restore completed.",
    },
    {
      action: "create",
      request: "Create Record Alpha.",
      summary: "Created Record Alpha.",
      targetLabel: "Record Alpha",
      requestedVisible:
        "Record Beta remains absent. Record Alpha created successfully.",
      requestedEvidenceText: "Record Alpha created successfully.",
      otherVisible:
        "Record Alpha remains absent. Record Beta created successfully.",
      otherEvidenceText: "Record Beta created successfully.",
      genericVisible: "Create completed.",
      genericSummary: "Create completed.",
    },
    {
      action: "share",
      request: "Share Report Alpha.",
      summary: "Shared Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains private. Report Alpha shared successfully.",
      requestedEvidenceText: "Report Alpha shared successfully.",
      otherVisible:
        "Report Alpha remains private. Report Beta shared successfully.",
      otherEvidenceText: "Report Beta shared successfully.",
      genericVisible: "Share completed.",
      genericSummary: "Share completed.",
    },
    {
      action: "grant",
      request: "Grant Role Alpha.",
      summary: "Granted Role Alpha.",
      targetLabel: "Role Alpha",
      requestedVisible:
        "Role Beta remains unavailable. Role Alpha granted successfully.",
      requestedEvidenceText: "Role Alpha granted successfully.",
      otherVisible:
        "Role Alpha remains unavailable. Role Beta granted successfully.",
      otherEvidenceText: "Role Beta granted successfully.",
      genericVisible: "Grant completed.",
      genericSummary: "Grant completed.",
    },
    {
      action: "revoke",
      request: "Revoke Role Alpha.",
      summary: "Revoked Role Alpha.",
      targetLabel: "Role Alpha",
      requestedVisible:
        "Role Beta remains available. Role Alpha revoked successfully.",
      requestedEvidenceText: "Role Alpha revoked successfully.",
      otherVisible:
        "Role Alpha remains available. Role Beta revoked successfully.",
      otherEvidenceText: "Role Beta revoked successfully.",
      genericVisible: "Revocation completed.",
      genericSummary: "Revocation completed.",
    },
    {
      action: "install",
      request: "Install Package Alpha.",
      summary: "Installed Package Alpha.",
      targetLabel: "Package Alpha",
      requestedVisible:
        "Package Beta remains unavailable. Package Alpha installed successfully.",
      requestedEvidenceText: "Package Alpha installed successfully.",
      otherVisible:
        "Package Alpha remains unavailable. Package Beta installed successfully.",
      otherEvidenceText: "Package Beta installed successfully.",
      genericVisible: "Installation completed.",
      genericSummary: "Installation completed.",
    },
    {
      action: "uninstall",
      request: "Uninstall Package Alpha.",
      summary: "Uninstalled Package Alpha.",
      targetLabel: "Package Alpha",
      requestedVisible:
        "Package Beta remains installed. Package Alpha uninstalled successfully.",
      requestedEvidenceText: "Package Alpha uninstalled successfully.",
      otherVisible:
        "Package Alpha remains installed. Package Beta uninstalled successfully.",
      otherEvidenceText: "Package Beta uninstalled successfully.",
      genericVisible: "Uninstallation completed.",
      genericSummary: "Uninstallation completed.",
    },
    {
      action: "connect",
      request: "Connect Integration Alpha.",
      summary: "Connected Integration Alpha.",
      targetLabel: "Integration Alpha",
      requestedVisible:
        "Integration Beta remains disconnected. Integration Alpha connected successfully.",
      requestedEvidenceText: "Integration Alpha connected successfully.",
      otherVisible:
        "Integration Alpha remains disconnected. Integration Beta connected successfully.",
      otherEvidenceText: "Integration Beta connected successfully.",
      genericVisible: "Connection completed.",
      genericSummary: "Connection completed.",
    },
    {
      action: "disconnect",
      request: "Disconnect Integration Alpha.",
      summary: "Disconnected Integration Alpha.",
      targetLabel: "Integration Alpha",
      requestedVisible:
        "Integration Beta remains connected. Integration Alpha disconnected successfully.",
      requestedEvidenceText: "Integration Alpha disconnected successfully.",
      otherVisible:
        "Integration Alpha remains connected. Integration Beta disconnected successfully.",
      otherEvidenceText: "Integration Beta disconnected successfully.",
      genericVisible: "Disconnection completed.",
      genericSummary: "Disconnection completed.",
    },
    {
      action: "sync",
      request: "Sync Integration Alpha.",
      summary: "Synced Integration Alpha.",
      targetLabel: "Integration Alpha",
      requestedVisible:
        "Integration Beta remains stale. Integration Alpha synced successfully.",
      requestedEvidenceText: "Integration Alpha synced successfully.",
      otherVisible:
        "Integration Alpha remains stale. Integration Beta synced successfully.",
      otherEvidenceText: "Integration Beta synced successfully.",
      genericVisible: "Sync completed.",
      genericSummary: "Sync completed.",
    },
    {
      action: "attach",
      request: "Attach File Alpha.",
      summary: "Attached File Alpha.",
      targetLabel: "File Alpha",
      requestedVisible:
        "File Beta remains unattached. File Alpha attached successfully.",
      requestedEvidenceText: "File Alpha attached successfully.",
      otherVisible:
        "File Alpha remains unattached. File Beta attached successfully.",
      otherEvidenceText: "File Beta attached successfully.",
      genericVisible: "Attachment completed.",
      genericSummary: "Attachment completed.",
    },
    {
      action: "detach",
      request: "Detach File Alpha.",
      summary: "Detached File Alpha.",
      targetLabel: "File Alpha",
      requestedVisible:
        "File Beta remains attached. File Alpha detached successfully.",
      requestedEvidenceText: "File Alpha detached successfully.",
      otherVisible:
        "File Alpha remains attached. File Beta detached successfully.",
      otherEvidenceText: "File Beta detached successfully.",
      genericVisible: "Detachment completed.",
      genericSummary: "Detachment completed.",
    },
    {
      action: "invite",
      request: "Invite Member Alpha.",
      summary: "Invited Member Alpha.",
      targetLabel: "Member Alpha",
      requestedVisible:
        "Member Beta remains uninvited. Member Alpha invited successfully.",
      requestedEvidenceText: "Member Alpha invited successfully.",
      otherVisible:
        "Member Alpha remains uninvited. Member Beta invited successfully.",
      otherEvidenceText: "Member Beta invited successfully.",
      genericVisible: "Invitation completed.",
      genericSummary: "Invitation completed.",
    },
    {
      action: "subscribe",
      request: "Subscribe to Channel Alpha.",
      summary: "Subscribed to Channel Alpha.",
      targetLabel: "Channel Alpha",
      requestedVisible:
        "Channel Beta remains inactive. Channel Alpha subscribed successfully.",
      requestedEvidenceText: "Channel Alpha subscribed successfully.",
      otherVisible:
        "Channel Alpha remains inactive. Channel Beta subscribed successfully.",
      otherEvidenceText: "Channel Beta subscribed successfully.",
      genericVisible: "Subscription completed.",
      genericSummary: "Subscription completed.",
    },
    {
      action: "unsubscribe",
      request: "Unsubscribe from Channel Alpha.",
      summary: "Unsubscribed from Channel Alpha.",
      targetLabel: "Channel Alpha",
      requestedVisible:
        "Channel Beta remains active. Channel Alpha unsubscribed successfully.",
      requestedEvidenceText: "Channel Alpha unsubscribed successfully.",
      otherVisible:
        "Channel Alpha remains active. Channel Beta unsubscribed successfully.",
      otherEvidenceText: "Channel Beta unsubscribed successfully.",
      genericVisible: "Unsubscription completed.",
      genericSummary: "Unsubscription completed.",
    },
    {
      action: "pin",
      request: "Pin Report Alpha.",
      summary: "Pinned Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains unpinned. Report Alpha pinned successfully.",
      requestedEvidenceText: "Report Alpha pinned successfully.",
      otherVisible:
        "Report Alpha remains unpinned. Report Beta pinned successfully.",
      otherEvidenceText: "Report Beta pinned successfully.",
      genericVisible: "Pin completed.",
      genericSummary: "Pin completed.",
    },
    {
      action: "unpin",
      request: "Unpin Report Alpha.",
      summary: "Unpinned Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains pinned. Report Alpha unpinned successfully.",
      requestedEvidenceText: "Report Alpha unpinned successfully.",
      otherVisible:
        "Report Alpha remains pinned. Report Beta unpinned successfully.",
      otherEvidenceText: "Report Beta unpinned successfully.",
      genericVisible: "Unpin completed.",
      genericSummary: "Unpin completed.",
    },
    {
      action: "mute",
      request: "Mute Channel Alpha.",
      summary: "Muted Channel Alpha.",
      targetLabel: "Channel Alpha",
      requestedVisible:
        "Channel Beta remains audible. Channel Alpha muted successfully.",
      requestedEvidenceText: "Channel Alpha muted successfully.",
      otherVisible:
        "Channel Alpha remains audible. Channel Beta muted successfully.",
      otherEvidenceText: "Channel Beta muted successfully.",
      genericVisible: "Mute completed.",
      genericSummary: "Mute completed.",
    },
    {
      action: "unmute",
      request: "Unmute Channel Alpha.",
      summary: "Unmuted Channel Alpha.",
      targetLabel: "Channel Alpha",
      requestedVisible:
        "Channel Beta remains muted. Channel Alpha unmuted successfully.",
      requestedEvidenceText: "Channel Alpha unmuted successfully.",
      otherVisible:
        "Channel Alpha remains muted. Channel Beta unmuted successfully.",
      otherEvidenceText: "Channel Beta unmuted successfully.",
      genericVisible: "Unmute completed.",
      genericSummary: "Unmute completed.",
    },
    {
      action: "follow",
      request: "Follow Topic Alpha.",
      summary: "Followed Topic Alpha.",
      targetLabel: "Topic Alpha",
      requestedVisible:
        "Topic Beta remains unfollowed. Topic Alpha followed successfully.",
      requestedEvidenceText: "Topic Alpha followed successfully.",
      otherVisible:
        "Topic Alpha remains unfollowed. Topic Beta followed successfully.",
      otherEvidenceText: "Topic Beta followed successfully.",
      genericVisible: "Follow completed.",
      genericSummary: "Follow completed.",
    },
    {
      action: "unfollow",
      request: "Unfollow Topic Alpha.",
      summary: "Unfollowed Topic Alpha.",
      targetLabel: "Topic Alpha",
      requestedVisible:
        "Topic Beta remains followed. Topic Alpha unfollowed successfully.",
      requestedEvidenceText: "Topic Alpha unfollowed successfully.",
      otherVisible:
        "Topic Alpha remains followed. Topic Beta unfollowed successfully.",
      otherEvidenceText: "Topic Beta unfollowed successfully.",
      genericVisible: "Unfollow completed.",
      genericSummary: "Unfollow completed.",
    },
    {
      action: "bookmark",
      request: "Bookmark Page Alpha.",
      summary: "Bookmarked Page Alpha.",
      targetLabel: "Page Alpha",
      requestedVisible:
        "Page Beta remains unbookmarked. Page Alpha bookmarked successfully.",
      requestedEvidenceText: "Page Alpha bookmarked successfully.",
      otherVisible:
        "Page Alpha remains unbookmarked. Page Beta bookmarked successfully.",
      otherEvidenceText: "Page Beta bookmarked successfully.",
      genericVisible: "Bookmark completed.",
      genericSummary: "Bookmark completed.",
    },
    {
      action: "unbookmark",
      request: "Unbookmark Page Alpha.",
      summary: "Unbookmarked Page Alpha.",
      targetLabel: "Page Alpha",
      requestedVisible:
        "Page Beta remains bookmarked. Page Alpha unbookmarked successfully.",
      requestedEvidenceText: "Page Alpha unbookmarked successfully.",
      otherVisible:
        "Page Alpha remains bookmarked. Page Beta unbookmarked successfully.",
      otherEvidenceText: "Page Beta unbookmarked successfully.",
      genericVisible: "Unbookmark completed.",
      genericSummary: "Unbookmark completed.",
    },
    {
      action: "favorite",
      request: "Favorite Report Alpha.",
      summary: "Favorited Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains unfavorited. Report Alpha favorited successfully.",
      requestedEvidenceText: "Report Alpha favorited successfully.",
      otherVisible:
        "Report Alpha remains unfavorited. Report Beta favorited successfully.",
      otherEvidenceText: "Report Beta favorited successfully.",
      genericVisible: "Favorite completed.",
      genericSummary: "Favorite completed.",
    },
    {
      action: "unfavorite",
      request: "Unfavorite Report Alpha.",
      summary: "Unfavorited Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains favorited. Report Alpha unfavorited successfully.",
      requestedEvidenceText: "Report Alpha unfavorited successfully.",
      otherVisible:
        "Report Alpha remains favorited. Report Beta unfavorited successfully.",
      otherEvidenceText: "Report Beta unfavorited successfully.",
      genericVisible: "Unfavorite completed.",
      genericSummary: "Unfavorite completed.",
    },
    {
      action: "watch",
      request: "Watch Repository Alpha.",
      summary: "Watched Repository Alpha.",
      targetLabel: "Repository Alpha",
      requestedVisible:
        "Repository Beta remains unwatched. Repository Alpha watched successfully.",
      requestedEvidenceText: "Repository Alpha watched successfully.",
      otherVisible:
        "Repository Alpha remains unwatched. Repository Beta watched successfully.",
      otherEvidenceText: "Repository Beta watched successfully.",
      genericVisible: "Watch completed.",
      genericSummary: "Watch completed.",
    },
    {
      action: "unwatch",
      request: "Unwatch Repository Alpha.",
      summary: "Unwatched Repository Alpha.",
      targetLabel: "Repository Alpha",
      requestedVisible:
        "Repository Beta remains watched. Repository Alpha unwatched successfully.",
      requestedEvidenceText: "Repository Alpha unwatched successfully.",
      otherVisible:
        "Repository Alpha remains watched. Repository Beta unwatched successfully.",
      otherEvidenceText: "Repository Beta unwatched successfully.",
      genericVisible: "Unwatch completed.",
      genericSummary: "Unwatch completed.",
    },
    {
      action: "star",
      request: "Star Repository Alpha.",
      summary: "Starred Repository Alpha.",
      targetLabel: "Repository Alpha",
      requestedVisible:
        "Repository Beta remains unstarred. Repository Alpha starred successfully.",
      requestedEvidenceText: "Repository Alpha starred successfully.",
      otherVisible:
        "Repository Alpha remains unstarred. Repository Beta starred successfully.",
      otherEvidenceText: "Repository Beta starred successfully.",
      genericVisible: "Star completed.",
      genericSummary: "Star completed.",
    },
    {
      action: "unstar",
      request: "Unstar Repository Alpha.",
      summary: "Unstarred Repository Alpha.",
      targetLabel: "Repository Alpha",
      requestedVisible:
        "Repository Beta remains starred. Repository Alpha unstarred successfully.",
      requestedEvidenceText: "Repository Alpha unstarred successfully.",
      otherVisible:
        "Repository Alpha remains starred. Repository Beta unstarred successfully.",
      otherEvidenceText: "Repository Beta unstarred successfully.",
      genericVisible: "Unstar completed.",
      genericSummary: "Unstar completed.",
    },
    {
      action: "post",
      request: "Publish Article Alpha.",
      summary: "Published Article Alpha.",
      targetLabel: "Article Alpha",
      requestedVisible:
        "Article Beta remains draft. Article Alpha published successfully.",
      requestedEvidenceText: "Article Alpha published successfully.",
      otherVisible:
        "Article Alpha remains draft. Article Beta published successfully.",
      otherEvidenceText: "Article Beta published successfully.",
      genericVisible: "Publish completed.",
      genericSummary: "Publish completed.",
    },
    {
      action: "update",
      request: "Update Request Alpha.",
      summary: "Updated Request Alpha.",
      targetLabel: "Request Alpha",
      requestedVisible:
        "Request Beta remains stale. Request Alpha updated successfully.",
      requestedEvidenceText: "Request Alpha updated successfully.",
      otherVisible:
        "Request Alpha remains stale. Request Beta updated successfully.",
      otherEvidenceText: "Request Beta updated successfully.",
      genericVisible: "Update completed.",
      genericSummary: "Update completed.",
    },
  ] as const) {
    test(`accepts target-aware visible ${scenario.action} confirmation for the requested target`, () => {
      const snap = workflowSnapshot({
        visibleContent: scenario.requestedVisible,
        pageContent: scenario.requestedVisible,
      });
      const generated = generateCompletionContract({
        userRequest: scenario.request,
        snapshot: snap,
      });
      const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

      const decision = evaluateCompletionContract({
        contract: generated?.contract,
        evidence,
        snapshot: snap,
        candidateSource: "model_done",
        summary: scenario.summary,
      });

      expect(generated?.contract).toMatchObject({
        kind: "workflow_confirmation",
        action: scenario.action,
        targetLabel: scenario.targetLabel,
      });
      expect(evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "confirmation_state",
            logicalKey: `workflow:confirmation:${scenario.action}`,
            detail: expect.objectContaining({
              action: scenario.action,
              source: "visible_text",
              text: scenario.requestedEvidenceText,
            }),
          }),
        ]),
      );
      expect(decision.status).toBe("accepted");
    });

    test(`rejects target-aware visible ${scenario.action} confirmation for a different target`, () => {
      const snap = workflowSnapshot({
        visibleContent: scenario.otherVisible,
        pageContent: scenario.otherVisible,
      });
      const generated = generateCompletionContract({
        userRequest: scenario.request,
        snapshot: snap,
      });
      const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

      const decision = evaluateCompletionContract({
        contract: generated?.contract,
        evidence,
        snapshot: snap,
        candidateSource: "model_done",
        summary: scenario.summary,
      });

      expect(generated?.contract).toMatchObject({
        kind: "workflow_confirmation",
        action: scenario.action,
        targetLabel: scenario.targetLabel,
      });
      expect(evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "confirmation_state",
            logicalKey: `workflow:confirmation:${scenario.action}`,
            detail: expect.objectContaining({
              action: scenario.action,
              source: "visible_text",
              text: scenario.otherEvidenceText,
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

    test(`rejects targetless visible ${scenario.action} completion for a named target`, () => {
      const snap = workflowSnapshot({
        visibleContent: scenario.genericVisible,
        pageContent: scenario.genericVisible,
      });
      const generated = generateCompletionContract({
        userRequest: scenario.request,
        snapshot: snap,
      });
      const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

      const decision = evaluateCompletionContract({
        contract: generated?.contract,
        evidence,
        snapshot: snap,
        candidateSource: "model_done",
        summary: scenario.genericSummary,
      });

      expect(generated?.contract).toMatchObject({
        kind: "workflow_confirmation",
        action: scenario.action,
        targetLabel: scenario.targetLabel,
      });
      expect(decision).toMatchObject({
        status: "rejected",
        reason:
          "Workflow confirmation evidence is for a different target than the requested action.",
      });
    });
  }

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

  test("accepts target-aware visible restart confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Service Beta remains stopped. Service Alpha restarted successfully.",
      pageContent:
        "Service Beta remains stopped. Service Alpha restarted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Restart Service Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Restarted Service Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "restart",
      targetLabel: "Service Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:restart",
          detail: expect.objectContaining({
            action: "restart",
            source: "visible_text",
            text: "Service Alpha restarted successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible restart confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Service Alpha remains stopped. Service Beta restarted successfully.",
      pageContent:
        "Service Alpha remains stopped. Service Beta restarted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Restart Service Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Restarted Service Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "restart",
      targetLabel: "Service Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:restart",
          detail: expect.objectContaining({
            action: "restart",
            source: "visible_text",
            text: "Service Beta restarted successfully.",
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

  test("rejects targetless visible restart completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Restart completed.",
      pageContent: "Restart completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Restart Service Alpha.",
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
      targetLabel: "Service Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible refresh confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Report Beta is stale. Report Alpha refreshed successfully.",
      pageContent:
        "Report Beta is stale. Report Alpha refreshed successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Refresh Report Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Refreshed Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "refresh",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:refresh",
          detail: expect.objectContaining({
            action: "refresh",
            source: "visible_text",
            text: "Report Alpha refreshed successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible refresh confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Report Alpha is stale. Report Beta refreshed successfully.",
      pageContent:
        "Report Alpha is stale. Report Beta refreshed successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Refresh Report Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Refreshed Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "refresh",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:refresh",
          detail: expect.objectContaining({
            action: "refresh",
            source: "visible_text",
            text: "Report Beta refreshed successfully.",
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

  test("rejects targetless visible refresh completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Refresh completed.",
      pageContent: "Refresh completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Refresh Report Alpha.",
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
      targetLabel: "Report Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
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

  test("accepts target-aware visible approve confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Request Beta remains pending. Request Alpha approved successfully.",
      pageContent:
        "Request Beta remains pending. Request Alpha approved successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Approve Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Approved Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:approve",
          detail: expect.objectContaining({
            action: "approve",
            source: "visible_text",
            text: "Request Alpha approved successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible approve confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Request Alpha remains pending. Request Beta approved successfully.",
      pageContent:
        "Request Alpha remains pending. Request Beta approved successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Approve Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Approved Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:approve",
          detail: expect.objectContaining({
            action: "approve",
            source: "visible_text",
            text: "Request Beta approved successfully.",
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

  test("rejects targetless visible approval completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Approval completed.",
      pageContent: "Approval completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Approve Request Alpha.",
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
      targetLabel: "Request Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible reject confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Request Beta remains pending. Request Alpha rejected successfully.",
      pageContent:
        "Request Beta remains pending. Request Alpha rejected successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Reject Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Rejected Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reject",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:reject",
          detail: expect.objectContaining({
            action: "reject",
            source: "visible_text",
            text: "Request Alpha rejected successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible reject confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Request Alpha remains pending. Request Beta rejected successfully.",
      pageContent:
        "Request Alpha remains pending. Request Beta rejected successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Reject Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Rejected Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reject",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:reject",
          detail: expect.objectContaining({
            action: "reject",
            source: "visible_text",
            text: "Request Beta rejected successfully.",
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

  test("rejects targetless visible rejection completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Rejection completed.",
      pageContent: "Rejection completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Reject Request Alpha.",
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
      targetLabel: "Request Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
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

  test("rejects targetless visible close completion for a named target", () => {
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
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
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

  test("rejects targetless visible reopen completion for a named target", () => {
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
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
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

  test("rejects targetless visible cancellation completion for a named target", () => {
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
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible enable confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Feature Beta remains disabled. Feature Alpha enabled successfully.",
      pageContent:
        "Feature Beta remains disabled. Feature Alpha enabled successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Enable Feature Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Enabled Feature Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
      targetLabel: "Feature Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:enable",
          detail: expect.objectContaining({
            action: "enable",
            source: "visible_text",
            text: "Feature Alpha enabled successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible enable confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Feature Alpha remains disabled. Feature Beta enabled successfully.",
      pageContent:
        "Feature Alpha remains disabled. Feature Beta enabled successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Enable Feature Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Enabled Feature Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
      targetLabel: "Feature Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:enable",
          detail: expect.objectContaining({
            action: "enable",
            source: "visible_text",
            text: "Feature Beta enabled successfully.",
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

  test("rejects targetless visible enable completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Enable completed.",
      pageContent: "Enable completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Enable Feature Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Enable completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
      targetLabel: "Feature Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible disable confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Feature Beta remains enabled. Feature Alpha disabled successfully.",
      pageContent:
        "Feature Beta remains enabled. Feature Alpha disabled successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Disable Feature Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Disabled Feature Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "disable",
      targetLabel: "Feature Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:disable",
          detail: expect.objectContaining({
            action: "disable",
            source: "visible_text",
            text: "Feature Alpha disabled successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible disable confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Feature Alpha remains enabled. Feature Beta disabled successfully.",
      pageContent:
        "Feature Alpha remains enabled. Feature Beta disabled successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Disable Feature Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Disabled Feature Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "disable",
      targetLabel: "Feature Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:disable",
          detail: expect.objectContaining({
            action: "disable",
            source: "visible_text",
            text: "Feature Beta disabled successfully.",
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

  test("rejects targetless visible disable completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Disable completed.",
      pageContent: "Disable completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Disable Feature Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Disable completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "disable",
      targetLabel: "Feature Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible lock confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Account Beta remains unlocked. Account Alpha locked successfully.",
      pageContent:
        "Account Beta remains unlocked. Account Alpha locked successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Lock Account Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Locked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "lock",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:lock",
          detail: expect.objectContaining({
            action: "lock",
            source: "visible_text",
            text: "Account Alpha locked successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible lock confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Account Alpha remains unlocked. Account Beta locked successfully.",
      pageContent:
        "Account Alpha remains unlocked. Account Beta locked successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Lock Account Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Locked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "lock",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:lock",
          detail: expect.objectContaining({
            action: "lock",
            source: "visible_text",
            text: "Account Beta locked successfully.",
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

  test("rejects targetless visible lock completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Lock completed.",
      pageContent: "Lock completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Lock Account Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Lock completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "lock",
      targetLabel: "Account Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible unlock confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Account Beta remains locked. Account Alpha unlocked successfully.",
      pageContent:
        "Account Beta remains locked. Account Alpha unlocked successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Unlock Account Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Unlocked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unlock",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:unlock",
          detail: expect.objectContaining({
            action: "unlock",
            source: "visible_text",
            text: "Account Alpha unlocked successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible unlock confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Account Alpha remains locked. Account Beta unlocked successfully.",
      pageContent:
        "Account Alpha remains locked. Account Beta unlocked successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Unlock Account Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Unlocked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unlock",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:unlock",
          detail: expect.objectContaining({
            action: "unlock",
            source: "visible_text",
            text: "Account Beta unlocked successfully.",
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

  test("rejects targetless visible unlock completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Unlock completed.",
      pageContent: "Unlock completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Unlock Account Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Unlock completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unlock",
      targetLabel: "Account Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible assign confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Ticket Beta remains unassigned. Ticket Alpha assigned successfully.",
      pageContent:
        "Ticket Beta remains unassigned. Ticket Alpha assigned successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Assign Ticket Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Assigned Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "assign",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:assign",
          detail: expect.objectContaining({
            action: "assign",
            source: "visible_text",
            text: "Ticket Alpha assigned successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible assign confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Ticket Alpha remains unassigned. Ticket Beta assigned successfully.",
      pageContent:
        "Ticket Alpha remains unassigned. Ticket Beta assigned successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Assign Ticket Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Assigned Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "assign",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:assign",
          detail: expect.objectContaining({
            action: "assign",
            source: "visible_text",
            text: "Ticket Beta assigned successfully.",
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

  test("rejects targetless visible assignment completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Assignment completed.",
      pageContent: "Assignment completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Assign Ticket Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Assignment completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "assign",
      targetLabel: "Ticket Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible unassign confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Ticket Beta remains assigned. Ticket Alpha unassigned successfully.",
      pageContent:
        "Ticket Beta remains assigned. Ticket Alpha unassigned successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Unassign Ticket Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Unassigned Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unassign",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:unassign",
          detail: expect.objectContaining({
            action: "unassign",
            source: "visible_text",
            text: "Ticket Alpha unassigned successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible unassign confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Ticket Alpha remains assigned. Ticket Beta unassigned successfully.",
      pageContent:
        "Ticket Alpha remains assigned. Ticket Beta unassigned successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Unassign Ticket Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Unassigned Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unassign",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:unassign",
          detail: expect.objectContaining({
            action: "unassign",
            source: "visible_text",
            text: "Ticket Beta unassigned successfully.",
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

  test("rejects targetless visible unassign completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Unassign completed.",
      pageContent: "Unassign completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Unassign Ticket Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Unassign completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unassign",
      targetLabel: "Ticket Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible escalate confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Incident Beta remains open. Incident Alpha escalated successfully.",
      pageContent:
        "Incident Beta remains open. Incident Alpha escalated successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Escalate Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "escalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:escalate",
          detail: expect.objectContaining({
            action: "escalate",
            source: "visible_text",
            text: "Incident Alpha escalated successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible escalate confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Incident Alpha remains open. Incident Beta escalated successfully.",
      pageContent:
        "Incident Alpha remains open. Incident Beta escalated successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Escalate Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "escalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:escalate",
          detail: expect.objectContaining({
            action: "escalate",
            source: "visible_text",
            text: "Incident Beta escalated successfully.",
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

  test("rejects targetless visible escalation completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Escalation completed.",
      pageContent: "Escalation completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Escalate Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Escalation completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "escalate",
      targetLabel: "Incident Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible deescalate confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Incident Beta remains escalated. Incident Alpha de-escalated successfully.",
      pageContent:
        "Incident Beta remains escalated. Incident Alpha de-escalated successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "De-escalate Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "De-escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "deescalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:deescalate",
          detail: expect.objectContaining({
            action: "deescalate",
            source: "visible_text",
            text: "Incident Alpha de-escalated successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible deescalate confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Incident Alpha remains escalated. Incident Beta de-escalated successfully.",
      pageContent:
        "Incident Alpha remains escalated. Incident Beta de-escalated successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "De-escalate Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "De-escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "deescalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:deescalate",
          detail: expect.objectContaining({
            action: "deescalate",
            source: "visible_text",
            text: "Incident Beta de-escalated successfully.",
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

  test("rejects targetless visible deescalation completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "De-escalation completed.",
      pageContent: "De-escalation completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "De-escalate Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "De-escalation completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "deescalate",
      targetLabel: "Incident Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible pause confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Job Beta remains running. Job Alpha paused successfully.",
      pageContent:
        "Job Beta remains running. Job Alpha paused successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Pause Job Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Paused Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "pause",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:pause",
          detail: expect.objectContaining({
            action: "pause",
            source: "visible_text",
            text: "Job Alpha paused successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible pause confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Job Alpha remains running. Job Beta paused successfully.",
      pageContent:
        "Job Alpha remains running. Job Beta paused successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Pause Job Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Paused Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "pause",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:pause",
          detail: expect.objectContaining({
            action: "pause",
            source: "visible_text",
            text: "Job Beta paused successfully.",
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

  test("rejects targetless visible pause completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Pause completed.",
      pageContent: "Pause completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Pause Job Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Pause completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "pause",
      targetLabel: "Job Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible resume confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Job Beta remains paused. Job Alpha resumed successfully.",
      pageContent:
        "Job Beta remains paused. Job Alpha resumed successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Resume Job Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Resumed Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "resume",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:resume",
          detail: expect.objectContaining({
            action: "resume",
            source: "visible_text",
            text: "Job Alpha resumed successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible resume confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Job Alpha remains paused. Job Beta resumed successfully.",
      pageContent:
        "Job Alpha remains paused. Job Beta resumed successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Resume Job Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Resumed Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "resume",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:resume",
          detail: expect.objectContaining({
            action: "resume",
            source: "visible_text",
            text: "Job Beta resumed successfully.",
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

  test("rejects targetless visible resume completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Resume completed.",
      pageContent: "Resume completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Resume Job Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Resume completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "resume",
      targetLabel: "Job Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible start confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Service Beta remains stopped. Service Alpha started successfully.",
      pageContent:
        "Service Beta remains stopped. Service Alpha started successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Start Service Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Started Service Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "start",
      targetLabel: "Service Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:start",
          detail: expect.objectContaining({
            action: "start",
            source: "visible_text",
            text: "Service Alpha started successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible start confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Service Alpha remains stopped. Service Beta started successfully.",
      pageContent:
        "Service Alpha remains stopped. Service Beta started successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Start Service Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Started Service Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "start",
      targetLabel: "Service Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:start",
          detail: expect.objectContaining({
            action: "start",
            source: "visible_text",
            text: "Service Beta started successfully.",
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

  test("rejects targetless visible start completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Start completed.",
      pageContent: "Start completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Start Service Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Start completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "start",
      targetLabel: "Service Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible stop confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Service Beta remains running. Service Alpha stopped successfully.",
      pageContent:
        "Service Beta remains running. Service Alpha stopped successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Stop Service Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Stopped Service Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "stop",
      targetLabel: "Service Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:stop",
          detail: expect.objectContaining({
            action: "stop",
            source: "visible_text",
            text: "Service Alpha stopped successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible stop confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Service Alpha remains running. Service Beta stopped successfully.",
      pageContent:
        "Service Alpha remains running. Service Beta stopped successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Stop Service Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Stopped Service Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "stop",
      targetLabel: "Service Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:stop",
          detail: expect.objectContaining({
            action: "stop",
            source: "visible_text",
            text: "Service Beta stopped successfully.",
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

  test("rejects targetless visible stop completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Stop completed.",
      pageContent: "Stop completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Stop Service Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Stop completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "stop",
      targetLabel: "Service Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible submit confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Request Beta remains draft. Request Alpha submitted successfully.",
      pageContent:
        "Request Beta remains draft. Request Alpha submitted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Submit Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Submitted Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "submit",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:submit",
          detail: expect.objectContaining({
            action: "submit",
            source: "visible_text",
            text: "Request Alpha submitted successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible submit confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Request Alpha remains draft. Request Beta submitted successfully.",
      pageContent:
        "Request Alpha remains draft. Request Beta submitted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Submit Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Submitted Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "submit",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:submit",
          detail: expect.objectContaining({
            action: "submit",
            source: "visible_text",
            text: "Request Beta submitted successfully.",
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

  test("rejects targetless visible submission completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Submission completed.",
      pageContent: "Submission completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Submit Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Submission completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "submit",
      targetLabel: "Request Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible complete confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Task TASK002 remains incomplete. Task TASK001 completed successfully.",
      pageContent:
        "Task TASK002 remains incomplete. Task TASK001 completed successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Mark TASK001 complete.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Marked TASK001 complete.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "complete",
      targetLabel: "TASK001",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:complete",
          detail: expect.objectContaining({
            action: "complete",
            source: "visible_text",
            text: "Task TASK001 completed successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible complete confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Task TASK001 remains incomplete. Task TASK002 completed successfully.",
      pageContent:
        "Task TASK001 remains incomplete. Task TASK002 completed successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Mark TASK001 complete.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Marked TASK001 complete.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "complete",
      targetLabel: "TASK001",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:complete",
          detail: expect.objectContaining({
            action: "complete",
            source: "visible_text",
            text: "Task TASK002 completed successfully.",
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

  test("rejects targetless visible complete completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Completion successful.",
      pageContent: "Completion successful.",
    });
    const generated = generateCompletionContract({
      userRequest: "Mark TASK001 complete.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Completion successful.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "complete",
      targetLabel: "TASK001",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
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

  test("accepts modal dismissal from hide_element overlay disappearance evidence", () => {
    const pre = modalSnapshot();
    const current = workflowSnapshot({
      title: "Newsletter",
      visibleContent: "Account settings",
      pageContent: "Account settings",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Hide the newsletter popup.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.HIDE_ELEMENT,
      args: { id: 401 },
      result: 'Hidden element [401] <div> "Newsletter popup Stay updated"',
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 8,
    });

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Hid the newsletter popup.",
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

  test("accepts modal dismissal from dismiss_overlays disappearance evidence", () => {
    const pre = modalSnapshot();
    const current = workflowSnapshot({
      title: "Newsletter",
      visibleContent: "Account settings",
      pageContent: "Account settings",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Dismiss the newsletter overlay.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.DISMISS_OVERLAYS,
      args: {},
      result: "Dismissed 1 overlay(s).",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 8,
    });

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Dismissed the newsletter overlay.",
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

  test("does not infer modal dismissal from rejected hide_element result", () => {
    const pre = modalSnapshot();
    const current = workflowSnapshot({
      title: "Newsletter",
      visibleContent: "Account settings",
      pageContent: "Account settings",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.HIDE_ELEMENT,
      args: { id: 401 },
      result:
        'Element [401] <div> is not an overlay and has no overlay ancestor. Try press_key("Escape") or click a close button.',
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 8,
    });

    expect(evidence).toEqual([]);
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

  test("accepts deploy confirmation from named release disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Deploy queue Release Alpha Deploy Release Alpha Release Beta Deploy Release Beta",
      pageContent:
        "Deploy queue Release Alpha Deploy Release Alpha Release Beta Deploy Release Beta",
      elements: [
        actionButton(504, "Deploy Release Alpha"),
        actionButton(505, "Deploy Release Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Deploy queue Release Beta Deploy Release Beta",
      pageContent: "Deploy queue Release Beta Deploy Release Beta",
      elements: [actionButton(505, "Deploy Release Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Deploy Release Alpha.",
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
      summary: "Deployed Release Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "deploy",
      targetLabel: "Release Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:deploy:release-alpha",
        detail: expect.objectContaining({
          action: "deploy",
          source: "target_disappearance",
          text: "Deployed target no longer visible: Release Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects deploy target-disappearance evidence for the wrong requested release", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Deploy queue Release Alpha Deploy Release Alpha Release Beta Deploy Release Beta",
      pageContent:
        "Deploy queue Release Alpha Deploy Release Alpha Release Beta Deploy Release Beta",
      elements: [
        actionButton(504, "Deploy Release Alpha"),
        actionButton(505, "Deploy Release Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Deploy queue Release Alpha Deploy Release Alpha",
      pageContent: "Deploy queue Release Alpha Deploy Release Alpha",
      elements: [actionButton(504, "Deploy Release Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Deploy Release Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 505 },
      result: "Clicked element 505.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Deployed Release Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "deploy",
      targetLabel: "Release Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:deploy:release-beta",
        detail: expect.objectContaining({
          action: "deploy",
          source: "target_disappearance",
          text: "Deployed target no longer visible: Release Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer deploy confirmation while the named release remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Deploy queue Release Alpha Deploy Release Alpha",
      pageContent: "Deploy queue Release Alpha Deploy Release Alpha",
      elements: [actionButton(504, "Deploy Release Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Deploy queue Release Alpha Deploy Release Alpha",
      pageContent: "Deploy queue Release Alpha Deploy Release Alpha",
      elements: [actionButton(504, "Deploy Release Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer deploy confirmation from a generic deploy button", () => {
    const genericDeployButton: TaggedElement = {
      tag: 504,
      tagName: "button",
      role: "button",
      text: "Deploy",
      attributes: {
        id: "deploy",
        "aria-label": "Deploy",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Deploy queue Release Alpha Deploy",
      pageContent: "Deploy queue Release Alpha Deploy",
      elements: [genericDeployButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Deploy queue",
      pageContent: "Deploy queue",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts grant confirmation from named role disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Available grants Role Alpha Grant Role Alpha Role Beta Grant Role Beta",
      pageContent:
        "Available grants Role Alpha Grant Role Alpha Role Beta Grant Role Beta",
      elements: [
        actionButton(504, "Grant Role Alpha"),
        actionButton(505, "Grant Role Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Available grants Role Beta Grant Role Beta",
      pageContent: "Available grants Role Beta Grant Role Beta",
      elements: [actionButton(505, "Grant Role Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Grant Role Alpha.",
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
      summary: "Granted Role Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "grant",
      targetLabel: "Role Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:grant:role-alpha",
        detail: expect.objectContaining({
          action: "grant",
          source: "target_disappearance",
          text: "Granted target no longer visible: Role Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects grant target-disappearance evidence for the wrong requested role", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Available grants Role Alpha Grant Role Alpha Role Beta Grant Role Beta",
      pageContent:
        "Available grants Role Alpha Grant Role Alpha Role Beta Grant Role Beta",
      elements: [
        actionButton(504, "Grant Role Alpha"),
        actionButton(505, "Grant Role Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Available grants Role Alpha Grant Role Alpha",
      pageContent: "Available grants Role Alpha Grant Role Alpha",
      elements: [actionButton(504, "Grant Role Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Grant Role Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 505 },
      result: "Clicked element 505.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Granted Role Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "grant",
      targetLabel: "Role Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:grant:role-beta",
        detail: expect.objectContaining({
          action: "grant",
          source: "target_disappearance",
          text: "Granted target no longer visible: Role Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer grant confirmation while the named role remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Available grants Role Alpha Grant Role Alpha",
      pageContent: "Available grants Role Alpha Grant Role Alpha",
      elements: [actionButton(504, "Grant Role Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Available grants Role Alpha Grant Role Alpha",
      pageContent: "Available grants Role Alpha Grant Role Alpha",
      elements: [actionButton(504, "Grant Role Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer grant confirmation from a generic grant button", () => {
    const genericGrantButton: TaggedElement = {
      tag: 504,
      tagName: "button",
      role: "button",
      text: "Grant",
      attributes: {
        id: "grant",
        "aria-label": "Grant",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Available grants Role Alpha Grant",
      pageContent: "Available grants Role Alpha Grant",
      elements: [genericGrantButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Available grants",
      pageContent: "Available grants",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts backup confirmation from named database disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Backup queue Database Alpha Back up Database Alpha Database Beta Back up Database Beta",
      pageContent:
        "Backup queue Database Alpha Back up Database Alpha Database Beta Back up Database Beta",
      elements: [
        actionButton(504, "Back up Database Alpha"),
        actionButton(505, "Back up Database Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Backup queue Database Beta Back up Database Beta",
      pageContent: "Backup queue Database Beta Back up Database Beta",
      elements: [actionButton(505, "Back up Database Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Back up Database Alpha.",
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
      summary: "Backed up Database Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "backup",
      targetLabel: "Database Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:backup:database-alpha",
        detail: expect.objectContaining({
          action: "backup",
          source: "target_disappearance",
          text: "Backed up target no longer visible: Database Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects backup target-disappearance evidence for the wrong requested database", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Backup queue Database Alpha Back up Database Alpha Database Beta Back up Database Beta",
      pageContent:
        "Backup queue Database Alpha Back up Database Alpha Database Beta Back up Database Beta",
      elements: [
        actionButton(504, "Back up Database Alpha"),
        actionButton(505, "Back up Database Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Backup queue Database Alpha Back up Database Alpha",
      pageContent: "Backup queue Database Alpha Back up Database Alpha",
      elements: [actionButton(504, "Back up Database Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Back up Database Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 505 },
      result: "Clicked element 505.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Backed up Database Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "backup",
      targetLabel: "Database Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:backup:database-beta",
        detail: expect.objectContaining({
          action: "backup",
          source: "target_disappearance",
          text: "Backed up target no longer visible: Database Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer backup confirmation while the named database remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Backup queue Database Alpha Back up Database Alpha",
      pageContent: "Backup queue Database Alpha Back up Database Alpha",
      elements: [actionButton(504, "Back up Database Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Backup queue Database Alpha Back up Database Alpha",
      pageContent: "Backup queue Database Alpha Back up Database Alpha",
      elements: [actionButton(504, "Back up Database Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer backup confirmation from a generic backup button", () => {
    const genericBackupButton: TaggedElement = {
      tag: 504,
      tagName: "button",
      role: "button",
      text: "Back up",
      attributes: {
        id: "backup",
        "aria-label": "Back up",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Backup queue Database Alpha Back up",
      pageContent: "Backup queue Database Alpha Back up",
      elements: [genericBackupButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Backup queue",
      pageContent: "Backup queue",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts reset confirmation from named credential disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Reset queue Password Alpha Reset Password Alpha Password Beta Reset Password Beta",
      pageContent:
        "Reset queue Password Alpha Reset Password Alpha Password Beta Reset Password Beta",
      elements: [
        actionButton(504, "Reset Password Alpha"),
        actionButton(505, "Reset Password Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Reset queue Password Beta Reset Password Beta",
      pageContent: "Reset queue Password Beta Reset Password Beta",
      elements: [actionButton(505, "Reset Password Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Reset Password Alpha.",
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
      summary: "Reset Password Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reset",
      targetLabel: "Password Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:reset:password-alpha",
        detail: expect.objectContaining({
          action: "reset",
          source: "target_disappearance",
          text: "Reset target no longer visible: Password Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects reset target-disappearance evidence for the wrong requested credential", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Reset queue Password Alpha Reset Password Alpha Password Beta Reset Password Beta",
      pageContent:
        "Reset queue Password Alpha Reset Password Alpha Password Beta Reset Password Beta",
      elements: [
        actionButton(504, "Reset Password Alpha"),
        actionButton(505, "Reset Password Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Reset queue Password Alpha Reset Password Alpha",
      pageContent: "Reset queue Password Alpha Reset Password Alpha",
      elements: [actionButton(504, "Reset Password Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Reset Password Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 505 },
      result: "Clicked element 505.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Reset Password Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reset",
      targetLabel: "Password Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:reset:password-beta",
        detail: expect.objectContaining({
          action: "reset",
          source: "target_disappearance",
          text: "Reset target no longer visible: Password Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer reset confirmation while the named credential remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Reset queue Password Alpha Reset Password Alpha",
      pageContent: "Reset queue Password Alpha Reset Password Alpha",
      elements: [actionButton(504, "Reset Password Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Reset queue Password Alpha Reset Password Alpha",
      pageContent: "Reset queue Password Alpha Reset Password Alpha",
      elements: [actionButton(504, "Reset Password Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer reset confirmation from a generic reset button", () => {
    const genericResetButton: TaggedElement = {
      tag: 504,
      tagName: "button",
      role: "button",
      text: "Reset",
      attributes: {
        id: "reset",
        "aria-label": "Reset",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Reset queue Password Alpha Reset",
      pageContent: "Reset queue Password Alpha Reset",
      elements: [genericResetButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Reset queue",
      pageContent: "Reset queue",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts install confirmation from named package disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Available packages Package Alpha Install Package Alpha Package Beta Install Package Beta",
      pageContent:
        "Available packages Package Alpha Install Package Alpha Package Beta Install Package Beta",
      elements: [
        actionButton(504, "Install Package Alpha"),
        actionButton(505, "Install Package Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Available packages Package Beta Install Package Beta",
      pageContent: "Available packages Package Beta Install Package Beta",
      elements: [actionButton(505, "Install Package Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Install Package Alpha.",
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
      summary: "Installed Package Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "install",
      targetLabel: "Package Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:install:package-alpha",
        detail: expect.objectContaining({
          action: "install",
          source: "target_disappearance",
          text: "Installed target no longer visible: Package Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects install target-disappearance evidence for the wrong requested package", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Available packages Package Alpha Install Package Alpha Package Beta Install Package Beta",
      pageContent:
        "Available packages Package Alpha Install Package Alpha Package Beta Install Package Beta",
      elements: [
        actionButton(504, "Install Package Alpha"),
        actionButton(505, "Install Package Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Available packages Package Alpha Install Package Alpha",
      pageContent: "Available packages Package Alpha Install Package Alpha",
      elements: [actionButton(504, "Install Package Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Install Package Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 505 },
      result: "Clicked element 505.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Installed Package Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "install",
      targetLabel: "Package Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:install:package-beta",
        detail: expect.objectContaining({
          action: "install",
          source: "target_disappearance",
          text: "Installed target no longer visible: Package Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer install confirmation while the named package remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Available packages Package Alpha Install Package Alpha",
      pageContent: "Available packages Package Alpha Install Package Alpha",
      elements: [actionButton(504, "Install Package Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Available packages Package Alpha Install Package Alpha",
      pageContent: "Available packages Package Alpha Install Package Alpha",
      elements: [actionButton(504, "Install Package Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer install confirmation from a generic install button", () => {
    const genericInstallButton: TaggedElement = {
      tag: 504,
      tagName: "button",
      role: "button",
      text: "Install",
      attributes: {
        id: "install",
        "aria-label": "Install",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Available packages Package Alpha Install",
      pageContent: "Available packages Package Alpha Install",
      elements: [genericInstallButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Available packages",
      pageContent: "Available packages",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts uninstall confirmation from named package disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Packages Package Alpha Uninstall Package Alpha Package Beta Uninstall Package Beta",
      pageContent:
        "Packages Package Alpha Uninstall Package Alpha Package Beta Uninstall Package Beta",
      elements: [
        actionButton(505, "Uninstall Package Alpha"),
        actionButton(506, "Uninstall Package Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Packages Package Beta Uninstall Package Beta",
      pageContent: "Packages Package Beta Uninstall Package Beta",
      elements: [actionButton(506, "Uninstall Package Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Uninstall Package Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 505 },
      result: "Clicked element 505.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Uninstalled Package Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "uninstall",
      targetLabel: "Package Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:uninstall:package-alpha",
        detail: expect.objectContaining({
          action: "uninstall",
          source: "target_disappearance",
          text: "Uninstalled target no longer visible: Package Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects uninstall target-disappearance evidence for the wrong requested package", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Packages Package Alpha Uninstall Package Alpha Package Beta Uninstall Package Beta",
      pageContent:
        "Packages Package Alpha Uninstall Package Alpha Package Beta Uninstall Package Beta",
      elements: [
        actionButton(505, "Uninstall Package Alpha"),
        actionButton(506, "Uninstall Package Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Packages Package Alpha Uninstall Package Alpha",
      pageContent: "Packages Package Alpha Uninstall Package Alpha",
      elements: [actionButton(505, "Uninstall Package Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Uninstall Package Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 506 },
      result: "Clicked element 506.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Uninstalled Package Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "uninstall",
      targetLabel: "Package Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:uninstall:package-beta",
        detail: expect.objectContaining({
          action: "uninstall",
          source: "target_disappearance",
          text: "Uninstalled target no longer visible: Package Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer uninstall confirmation while the named package remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Packages Package Alpha Uninstall Package Alpha",
      pageContent: "Packages Package Alpha Uninstall Package Alpha",
      elements: [actionButton(505, "Uninstall Package Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Packages Package Alpha Uninstall Package Alpha",
      pageContent: "Packages Package Alpha Uninstall Package Alpha",
      elements: [actionButton(505, "Uninstall Package Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 505 },
      result: "Clicked element 505.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer uninstall confirmation from a generic uninstall button", () => {
    const genericUninstallButton: TaggedElement = {
      tag: 505,
      tagName: "button",
      role: "button",
      text: "Uninstall",
      attributes: {
        id: "uninstall",
        "aria-label": "Uninstall",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Packages Package Alpha Uninstall",
      pageContent: "Packages Package Alpha Uninstall",
      elements: [genericUninstallButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Packages",
      pageContent: "Packages",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 505 },
      result: "Clicked element 505.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts attach confirmation from named attachment disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Available attachments File Alpha Attach File Alpha File Beta Attach File Beta",
      pageContent:
        "Available attachments File Alpha Attach File Alpha File Beta Attach File Beta",
      elements: [
        actionButton(506, "Attach File Alpha"),
        actionButton(507, "Attach File Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Available attachments File Beta Attach File Beta",
      pageContent: "Available attachments File Beta Attach File Beta",
      elements: [actionButton(507, "Attach File Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Attach File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 506 },
      result: "Clicked element 506.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Attached File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "attach",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:attach:file-alpha",
        detail: expect.objectContaining({
          action: "attach",
          source: "target_disappearance",
          text: "Attached target no longer visible: File Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects attach target-disappearance evidence for the wrong requested attachment", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Available attachments File Alpha Attach File Alpha File Beta Attach File Beta",
      pageContent:
        "Available attachments File Alpha Attach File Alpha File Beta Attach File Beta",
      elements: [
        actionButton(506, "Attach File Alpha"),
        actionButton(507, "Attach File Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Available attachments File Alpha Attach File Alpha",
      pageContent: "Available attachments File Alpha Attach File Alpha",
      elements: [actionButton(506, "Attach File Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Attach File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 507 },
      result: "Clicked element 507.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Attached File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "attach",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:attach:file-beta",
        detail: expect.objectContaining({
          action: "attach",
          source: "target_disappearance",
          text: "Attached target no longer visible: File Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer attach confirmation while the named attachment remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Available attachments File Alpha Attach File Alpha",
      pageContent: "Available attachments File Alpha Attach File Alpha",
      elements: [actionButton(506, "Attach File Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Available attachments File Alpha Attach File Alpha",
      pageContent: "Available attachments File Alpha Attach File Alpha",
      elements: [actionButton(506, "Attach File Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 506 },
      result: "Clicked element 506.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer attach confirmation from a generic attach button", () => {
    const genericAttachButton: TaggedElement = {
      tag: 506,
      tagName: "button",
      role: "button",
      text: "Attach",
      attributes: {
        id: "attach",
        "aria-label": "Attach",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Available attachments File Alpha Attach",
      pageContent: "Available attachments File Alpha Attach",
      elements: [genericAttachButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Available attachments",
      pageContent: "Available attachments",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 506 },
      result: "Clicked element 506.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts detach confirmation from named attachment disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Attachments File Alpha Detach File Alpha File Beta Detach File Beta",
      pageContent:
        "Attachments File Alpha Detach File Alpha File Beta Detach File Beta",
      elements: [
        actionButton(507, "Detach File Alpha"),
        actionButton(508, "Detach File Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Attachments File Beta Detach File Beta",
      pageContent: "Attachments File Beta Detach File Beta",
      elements: [actionButton(508, "Detach File Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Detach File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 507 },
      result: "Clicked element 507.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Detached File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "detach",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:detach:file-alpha",
        detail: expect.objectContaining({
          action: "detach",
          source: "target_disappearance",
          text: "Detached target no longer visible: File Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects detach target-disappearance evidence for the wrong requested attachment", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Attachments File Alpha Detach File Alpha File Beta Detach File Beta",
      pageContent:
        "Attachments File Alpha Detach File Alpha File Beta Detach File Beta",
      elements: [
        actionButton(507, "Detach File Alpha"),
        actionButton(508, "Detach File Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Attachments File Alpha Detach File Alpha",
      pageContent: "Attachments File Alpha Detach File Alpha",
      elements: [actionButton(507, "Detach File Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Detach File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 508 },
      result: "Clicked element 508.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Detached File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "detach",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:detach:file-beta",
        detail: expect.objectContaining({
          action: "detach",
          source: "target_disappearance",
          text: "Detached target no longer visible: File Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer detach confirmation while the named attachment remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Attachments File Alpha Detach File Alpha",
      pageContent: "Attachments File Alpha Detach File Alpha",
      elements: [actionButton(507, "Detach File Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Attachments File Alpha Detach File Alpha",
      pageContent: "Attachments File Alpha Detach File Alpha",
      elements: [actionButton(507, "Detach File Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 507 },
      result: "Clicked element 507.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer detach confirmation from a generic detach button", () => {
    const genericDetachButton: TaggedElement = {
      tag: 507,
      tagName: "button",
      role: "button",
      text: "Detach",
      attributes: {
        id: "detach",
        "aria-label": "Detach",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Attachments File Alpha Detach",
      pageContent: "Attachments File Alpha Detach",
      elements: [genericDetachButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Attachments",
      pageContent: "Attachments",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 507 },
      result: "Clicked element 507.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unlink confirmation from named relationship disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Linked accounts Account Alpha Unlink Account Alpha Account Beta Unlink Account Beta",
      pageContent:
        "Linked accounts Account Alpha Unlink Account Alpha Account Beta Unlink Account Beta",
      elements: [
        actionButton(509, "Unlink Account Alpha"),
        actionButton(510, "Unlink Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Linked accounts Account Beta Unlink Account Beta",
      pageContent: "Linked accounts Account Beta Unlink Account Beta",
      elements: [actionButton(510, "Unlink Account Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unlink Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 509 },
      result: "Clicked element 509.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unlinked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unlink",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unlink:account-alpha",
        detail: expect.objectContaining({
          action: "unlink",
          source: "target_disappearance",
          text: "Unlinked target no longer visible: Account Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unlink target-disappearance evidence for the wrong requested relationship", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Linked accounts Account Alpha Unlink Account Alpha Account Beta Unlink Account Beta",
      pageContent:
        "Linked accounts Account Alpha Unlink Account Alpha Account Beta Unlink Account Beta",
      elements: [
        actionButton(509, "Unlink Account Alpha"),
        actionButton(510, "Unlink Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Linked accounts Account Alpha Unlink Account Alpha",
      pageContent: "Linked accounts Account Alpha Unlink Account Alpha",
      elements: [actionButton(509, "Unlink Account Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unlink Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 510 },
      result: "Clicked element 510.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unlinked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unlink",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unlink:account-beta",
        detail: expect.objectContaining({
          action: "unlink",
          source: "target_disappearance",
          text: "Unlinked target no longer visible: Account Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unlink confirmation while the named relationship remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Linked accounts Account Alpha Unlink Account Alpha",
      pageContent: "Linked accounts Account Alpha Unlink Account Alpha",
      elements: [actionButton(509, "Unlink Account Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Linked accounts Account Alpha Unlink Account Alpha",
      pageContent: "Linked accounts Account Alpha Unlink Account Alpha",
      elements: [actionButton(509, "Unlink Account Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 509 },
      result: "Clicked element 509.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unlink confirmation from a generic unlink button", () => {
    const genericUnlinkButton: TaggedElement = {
      tag: 509,
      tagName: "button",
      role: "button",
      text: "Unlink",
      attributes: {
        id: "unlink",
        "aria-label": "Unlink",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Linked accounts Account Alpha Unlink",
      pageContent: "Linked accounts Account Alpha Unlink",
      elements: [genericUnlinkButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Linked accounts",
      pageContent: "Linked accounts",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 509 },
      result: "Clicked element 509.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts link confirmation from named relationship disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unlinked accounts Account Alpha Link Account Alpha Account Beta Link Account Beta",
      pageContent:
        "Unlinked accounts Account Alpha Link Account Alpha Account Beta Link Account Beta",
      elements: [
        actionButton(511, "Link Account Alpha"),
        actionButton(512, "Link Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlinked accounts Account Beta Link Account Beta",
      pageContent: "Unlinked accounts Account Beta Link Account Beta",
      elements: [actionButton(512, "Link Account Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Link Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 511 },
      result: "Clicked element 511.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Linked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "link",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:link:account-alpha",
        detail: expect.objectContaining({
          action: "link",
          source: "target_disappearance",
          text: "Linked target no longer visible: Account Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects link target-disappearance evidence for the wrong requested relationship", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unlinked accounts Account Alpha Link Account Alpha Account Beta Link Account Beta",
      pageContent:
        "Unlinked accounts Account Alpha Link Account Alpha Account Beta Link Account Beta",
      elements: [
        actionButton(511, "Link Account Alpha"),
        actionButton(512, "Link Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlinked accounts Account Alpha Link Account Alpha",
      pageContent: "Unlinked accounts Account Alpha Link Account Alpha",
      elements: [actionButton(511, "Link Account Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Link Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 512 },
      result: "Clicked element 512.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Linked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "link",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:link:account-beta",
        detail: expect.objectContaining({
          action: "link",
          source: "target_disappearance",
          text: "Linked target no longer visible: Account Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer link confirmation while the named relationship remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unlinked accounts Account Alpha Link Account Alpha",
      pageContent: "Unlinked accounts Account Alpha Link Account Alpha",
      elements: [actionButton(511, "Link Account Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlinked accounts Account Alpha Link Account Alpha",
      pageContent: "Unlinked accounts Account Alpha Link Account Alpha",
      elements: [actionButton(511, "Link Account Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 511 },
      result: "Clicked element 511.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer link confirmation from a generic link button", () => {
    const genericLinkButton: TaggedElement = {
      tag: 511,
      tagName: "button",
      role: "button",
      text: "Link",
      attributes: {
        id: "link",
        "aria-label": "Link",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unlinked accounts Account Alpha Link",
      pageContent: "Unlinked accounts Account Alpha Link",
      elements: [genericLinkButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlinked accounts",
      pageContent: "Unlinked accounts",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 511 },
      result: "Clicked element 511.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts untag confirmation from named tagged target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Tagged issues Issue Alpha Untag Issue Alpha Issue Beta Untag Issue Beta",
      pageContent:
        "Tagged issues Issue Alpha Untag Issue Alpha Issue Beta Untag Issue Beta",
      elements: [
        actionButton(523, "Untag Issue Alpha"),
        actionButton(524, "Untag Issue Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Tagged issues Issue Beta Untag Issue Beta",
      pageContent: "Tagged issues Issue Beta Untag Issue Beta",
      elements: [actionButton(524, "Untag Issue Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Untag Issue Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 523 },
      result: "Clicked element 523.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Untagged Issue Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "untag",
      targetLabel: "Issue Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:untag:issue-alpha",
        detail: expect.objectContaining({
          action: "untag",
          source: "target_disappearance",
          text: "Untagged target no longer visible: Issue Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects untag target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Tagged issues Issue Alpha Untag Issue Alpha Issue Beta Untag Issue Beta",
      pageContent:
        "Tagged issues Issue Alpha Untag Issue Alpha Issue Beta Untag Issue Beta",
      elements: [
        actionButton(523, "Untag Issue Alpha"),
        actionButton(524, "Untag Issue Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Tagged issues Issue Alpha Untag Issue Alpha",
      pageContent: "Tagged issues Issue Alpha Untag Issue Alpha",
      elements: [actionButton(523, "Untag Issue Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Untag Issue Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 524 },
      result: "Clicked element 524.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Untagged Issue Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "untag",
      targetLabel: "Issue Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:untag:issue-beta",
        detail: expect.objectContaining({
          action: "untag",
          source: "target_disappearance",
          text: "Untagged target no longer visible: Issue Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer untag confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Tagged issues Issue Alpha Untag Issue Alpha",
      pageContent: "Tagged issues Issue Alpha Untag Issue Alpha",
      elements: [actionButton(523, "Untag Issue Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Tagged issues Issue Alpha Untag Issue Alpha",
      pageContent: "Tagged issues Issue Alpha Untag Issue Alpha",
      elements: [actionButton(523, "Untag Issue Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 523 },
      result: "Clicked element 523.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer untag confirmation from a generic untag button", () => {
    const genericUntagButton: TaggedElement = {
      tag: 523,
      tagName: "button",
      role: "button",
      text: "Untag",
      attributes: {
        id: "untag",
        "aria-label": "Untag",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Tagged issues Issue Alpha Untag",
      pageContent: "Tagged issues Issue Alpha Untag",
      elements: [genericUntagButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Tagged issues",
      pageContent: "Tagged issues",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 523 },
      result: "Clicked element 523.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts tag confirmation from named untagged target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Untagged issues Issue Alpha Tag Issue Alpha Issue Beta Tag Issue Beta",
      pageContent:
        "Untagged issues Issue Alpha Tag Issue Alpha Issue Beta Tag Issue Beta",
      elements: [
        actionButton(527, "Tag Issue Alpha"),
        actionButton(528, "Tag Issue Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Untagged issues Issue Beta Tag Issue Beta",
      pageContent: "Untagged issues Issue Beta Tag Issue Beta",
      elements: [actionButton(528, "Tag Issue Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Tag Issue Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 527 },
      result: "Clicked element 527.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Tagged Issue Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "tag",
      targetLabel: "Issue Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:tag:issue-alpha",
        detail: expect.objectContaining({
          action: "tag",
          source: "target_disappearance",
          text: "Tagged target no longer visible: Issue Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects tag target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Untagged issues Issue Alpha Tag Issue Alpha Issue Beta Tag Issue Beta",
      pageContent:
        "Untagged issues Issue Alpha Tag Issue Alpha Issue Beta Tag Issue Beta",
      elements: [
        actionButton(527, "Tag Issue Alpha"),
        actionButton(528, "Tag Issue Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Untagged issues Issue Alpha Tag Issue Alpha",
      pageContent: "Untagged issues Issue Alpha Tag Issue Alpha",
      elements: [actionButton(527, "Tag Issue Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Tag Issue Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 528 },
      result: "Clicked element 528.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Tagged Issue Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "tag",
      targetLabel: "Issue Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:tag:issue-beta",
        detail: expect.objectContaining({
          action: "tag",
          source: "target_disappearance",
          text: "Tagged target no longer visible: Issue Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer tag confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Untagged issues Issue Alpha Tag Issue Alpha",
      pageContent: "Untagged issues Issue Alpha Tag Issue Alpha",
      elements: [actionButton(527, "Tag Issue Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Untagged issues Issue Alpha Tag Issue Alpha",
      pageContent: "Untagged issues Issue Alpha Tag Issue Alpha",
      elements: [actionButton(527, "Tag Issue Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 527 },
      result: "Clicked element 527.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer tag confirmation from a generic tag button", () => {
    const genericTagButton: TaggedElement = {
      tag: 527,
      tagName: "button",
      role: "button",
      text: "Tag",
      attributes: {
        id: "tag",
        "aria-label": "Tag",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Untagged issues Issue Alpha Tag",
      pageContent: "Untagged issues Issue Alpha Tag",
      elements: [genericTagButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Untagged issues",
      pageContent: "Untagged issues",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 527 },
      result: "Clicked element 527.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unflag confirmation from named flagged target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Flagged messages Message Alpha Unflag Message Alpha Message Beta Unflag Message Beta",
      pageContent:
        "Flagged messages Message Alpha Unflag Message Alpha Message Beta Unflag Message Beta",
      elements: [
        actionButton(525, "Unflag Message Alpha"),
        actionButton(526, "Unflag Message Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Flagged messages Message Beta Unflag Message Beta",
      pageContent: "Flagged messages Message Beta Unflag Message Beta",
      elements: [actionButton(526, "Unflag Message Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unflag Message Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 525 },
      result: "Clicked element 525.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unflagged Message Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unflag",
      targetLabel: "Message Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unflag:message-alpha",
        detail: expect.objectContaining({
          action: "unflag",
          source: "target_disappearance",
          text: "Unflagged target no longer visible: Message Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unflag target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Flagged messages Message Alpha Unflag Message Alpha Message Beta Unflag Message Beta",
      pageContent:
        "Flagged messages Message Alpha Unflag Message Alpha Message Beta Unflag Message Beta",
      elements: [
        actionButton(525, "Unflag Message Alpha"),
        actionButton(526, "Unflag Message Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Flagged messages Message Alpha Unflag Message Alpha",
      pageContent: "Flagged messages Message Alpha Unflag Message Alpha",
      elements: [actionButton(525, "Unflag Message Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unflag Message Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 526 },
      result: "Clicked element 526.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unflagged Message Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unflag",
      targetLabel: "Message Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unflag:message-beta",
        detail: expect.objectContaining({
          action: "unflag",
          source: "target_disappearance",
          text: "Unflagged target no longer visible: Message Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unflag confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Flagged messages Message Alpha Unflag Message Alpha",
      pageContent: "Flagged messages Message Alpha Unflag Message Alpha",
      elements: [actionButton(525, "Unflag Message Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Flagged messages Message Alpha Unflag Message Alpha",
      pageContent: "Flagged messages Message Alpha Unflag Message Alpha",
      elements: [actionButton(525, "Unflag Message Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 525 },
      result: "Clicked element 525.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unflag confirmation from a generic unflag button", () => {
    const genericUnflagButton: TaggedElement = {
      tag: 525,
      tagName: "button",
      role: "button",
      text: "Unflag",
      attributes: {
        id: "unflag",
        "aria-label": "Unflag",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Flagged messages Message Alpha Unflag",
      pageContent: "Flagged messages Message Alpha Unflag",
      elements: [genericUnflagButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Flagged messages",
      pageContent: "Flagged messages",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 525 },
      result: "Clicked element 525.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts flag confirmation from named unflagged target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unflagged messages Message Alpha Flag Message Alpha Message Beta Flag Message Beta",
      pageContent:
        "Unflagged messages Message Alpha Flag Message Alpha Message Beta Flag Message Beta",
      elements: [
        actionButton(529, "Flag Message Alpha"),
        actionButton(530, "Flag Message Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unflagged messages Message Beta Flag Message Beta",
      pageContent: "Unflagged messages Message Beta Flag Message Beta",
      elements: [actionButton(530, "Flag Message Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Flag Message Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 529 },
      result: "Clicked element 529.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Flagged Message Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "flag",
      targetLabel: "Message Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:flag:message-alpha",
        detail: expect.objectContaining({
          action: "flag",
          source: "target_disappearance",
          text: "Flagged target no longer visible: Message Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects flag target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unflagged messages Message Alpha Flag Message Alpha Message Beta Flag Message Beta",
      pageContent:
        "Unflagged messages Message Alpha Flag Message Alpha Message Beta Flag Message Beta",
      elements: [
        actionButton(529, "Flag Message Alpha"),
        actionButton(530, "Flag Message Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unflagged messages Message Alpha Flag Message Alpha",
      pageContent: "Unflagged messages Message Alpha Flag Message Alpha",
      elements: [actionButton(529, "Flag Message Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Flag Message Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 530 },
      result: "Clicked element 530.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Flagged Message Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "flag",
      targetLabel: "Message Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:flag:message-beta",
        detail: expect.objectContaining({
          action: "flag",
          source: "target_disappearance",
          text: "Flagged target no longer visible: Message Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer flag confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unflagged messages Message Alpha Flag Message Alpha",
      pageContent: "Unflagged messages Message Alpha Flag Message Alpha",
      elements: [actionButton(529, "Flag Message Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unflagged messages Message Alpha Flag Message Alpha",
      pageContent: "Unflagged messages Message Alpha Flag Message Alpha",
      elements: [actionButton(529, "Flag Message Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 529 },
      result: "Clicked element 529.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer flag confirmation from a generic flag button", () => {
    const genericFlagButton: TaggedElement = {
      tag: 529,
      tagName: "button",
      role: "button",
      text: "Flag",
      attributes: {
        id: "flag",
        "aria-label": "Flag",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unflagged messages Message Alpha Flag",
      pageContent: "Unflagged messages Message Alpha Flag",
      elements: [genericFlagButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unflagged messages",
      pageContent: "Unflagged messages",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 529 },
      result: "Clicked element 529.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unsubscribe confirmation from named subscription disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Subscribed channels Channel Alpha Unsubscribe from Channel Alpha Channel Beta Unsubscribe from Channel Beta",
      pageContent:
        "Subscribed channels Channel Alpha Unsubscribe from Channel Alpha Channel Beta Unsubscribe from Channel Beta",
      elements: [
        actionButton(527, "Unsubscribe from Channel Alpha"),
        actionButton(528, "Unsubscribe from Channel Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Subscribed channels Channel Beta Unsubscribe from Channel Beta",
      pageContent:
        "Subscribed channels Channel Beta Unsubscribe from Channel Beta",
      elements: [actionButton(528, "Unsubscribe from Channel Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unsubscribe from Channel Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 527 },
      result: "Clicked element 527.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unsubscribed from Channel Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unsubscribe",
      targetLabel: "Channel Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unsubscribe:channel-alpha",
        detail: expect.objectContaining({
          action: "unsubscribe",
          source: "target_disappearance",
          text: "Unsubscribed target no longer visible: Channel Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unsubscribe target-disappearance evidence for the wrong requested subscription", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Subscribed channels Channel Alpha Unsubscribe from Channel Alpha Channel Beta Unsubscribe from Channel Beta",
      pageContent:
        "Subscribed channels Channel Alpha Unsubscribe from Channel Alpha Channel Beta Unsubscribe from Channel Beta",
      elements: [
        actionButton(527, "Unsubscribe from Channel Alpha"),
        actionButton(528, "Unsubscribe from Channel Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Subscribed channels Channel Alpha Unsubscribe from Channel Alpha",
      pageContent:
        "Subscribed channels Channel Alpha Unsubscribe from Channel Alpha",
      elements: [actionButton(527, "Unsubscribe from Channel Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unsubscribe from Channel Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 528 },
      result: "Clicked element 528.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unsubscribed from Channel Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unsubscribe",
      targetLabel: "Channel Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unsubscribe:channel-beta",
        detail: expect.objectContaining({
          action: "unsubscribe",
          source: "target_disappearance",
          text: "Unsubscribed target no longer visible: Channel Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unsubscribe confirmation while the named subscription remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Subscribed channels Channel Alpha Unsubscribe from Channel Alpha",
      pageContent:
        "Subscribed channels Channel Alpha Unsubscribe from Channel Alpha",
      elements: [actionButton(527, "Unsubscribe from Channel Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Subscribed channels Channel Alpha Unsubscribe from Channel Alpha",
      pageContent:
        "Subscribed channels Channel Alpha Unsubscribe from Channel Alpha",
      elements: [actionButton(527, "Unsubscribe from Channel Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 527 },
      result: "Clicked element 527.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unsubscribe confirmation from a generic unsubscribe button", () => {
    const genericUnsubscribeButton: TaggedElement = {
      tag: 527,
      tagName: "button",
      role: "button",
      text: "Unsubscribe",
      attributes: {
        id: "unsubscribe",
        "aria-label": "Unsubscribe",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Subscribed channels Channel Alpha Unsubscribe",
      pageContent: "Subscribed channels Channel Alpha Unsubscribe",
      elements: [genericUnsubscribeButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Subscribed channels",
      pageContent: "Subscribed channels",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 527 },
      result: "Clicked element 527.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts subscribe confirmation from named unsubscribed target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unsubscribed channels Channel Alpha Subscribe to Channel Alpha Channel Beta Subscribe to Channel Beta",
      pageContent:
        "Unsubscribed channels Channel Alpha Subscribe to Channel Alpha Channel Beta Subscribe to Channel Beta",
      elements: [
        actionButton(531, "Subscribe to Channel Alpha"),
        actionButton(532, "Subscribe to Channel Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Unsubscribed channels Channel Beta Subscribe to Channel Beta",
      pageContent:
        "Unsubscribed channels Channel Beta Subscribe to Channel Beta",
      elements: [actionButton(532, "Subscribe to Channel Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Subscribe to Channel Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 531 },
      result: "Clicked element 531.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Subscribed to Channel Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "subscribe",
      targetLabel: "Channel Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:subscribe:channel-alpha",
        detail: expect.objectContaining({
          action: "subscribe",
          source: "target_disappearance",
          text: "Subscribed target no longer visible: Channel Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects subscribe target-disappearance evidence for the wrong requested subscription", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unsubscribed channels Channel Alpha Subscribe to Channel Alpha Channel Beta Subscribe to Channel Beta",
      pageContent:
        "Unsubscribed channels Channel Alpha Subscribe to Channel Alpha Channel Beta Subscribe to Channel Beta",
      elements: [
        actionButton(531, "Subscribe to Channel Alpha"),
        actionButton(532, "Subscribe to Channel Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Unsubscribed channels Channel Alpha Subscribe to Channel Alpha",
      pageContent:
        "Unsubscribed channels Channel Alpha Subscribe to Channel Alpha",
      elements: [actionButton(531, "Subscribe to Channel Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Subscribe to Channel Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 532 },
      result: "Clicked element 532.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Subscribed to Channel Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "subscribe",
      targetLabel: "Channel Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:subscribe:channel-beta",
        detail: expect.objectContaining({
          action: "subscribe",
          source: "target_disappearance",
          text: "Subscribed target no longer visible: Channel Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer subscribe confirmation while the named subscription remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unsubscribed channels Channel Alpha Subscribe to Channel Alpha",
      pageContent:
        "Unsubscribed channels Channel Alpha Subscribe to Channel Alpha",
      elements: [actionButton(531, "Subscribe to Channel Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Unsubscribed channels Channel Alpha Subscribe to Channel Alpha",
      pageContent:
        "Unsubscribed channels Channel Alpha Subscribe to Channel Alpha",
      elements: [actionButton(531, "Subscribe to Channel Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 531 },
      result: "Clicked element 531.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer subscribe confirmation from a generic subscribe button", () => {
    const genericSubscribeButton: TaggedElement = {
      tag: 531,
      tagName: "button",
      role: "button",
      text: "Subscribe",
      attributes: {
        id: "subscribe",
        "aria-label": "Subscribe",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unsubscribed channels Channel Alpha Subscribe",
      pageContent: "Unsubscribed channels Channel Alpha Subscribe",
      elements: [genericSubscribeButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unsubscribed channels",
      pageContent: "Unsubscribed channels",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 531 },
      result: "Clicked element 531.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts follow confirmation from named unfollowed target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unfollowed topics Topic Alpha Follow Topic Alpha Topic Beta Follow Topic Beta",
      pageContent:
        "Unfollowed topics Topic Alpha Follow Topic Alpha Topic Beta Follow Topic Beta",
      elements: [
        actionButton(533, "Follow Topic Alpha"),
        actionButton(534, "Follow Topic Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unfollowed topics Topic Beta Follow Topic Beta",
      pageContent: "Unfollowed topics Topic Beta Follow Topic Beta",
      elements: [actionButton(534, "Follow Topic Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Follow Topic Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 533 },
      result: "Clicked element 533.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Followed Topic Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "follow",
      targetLabel: "Topic Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:follow:topic-alpha",
        detail: expect.objectContaining({
          action: "follow",
          source: "target_disappearance",
          text: "Followed target no longer visible: Topic Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects follow target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unfollowed topics Topic Alpha Follow Topic Alpha Topic Beta Follow Topic Beta",
      pageContent:
        "Unfollowed topics Topic Alpha Follow Topic Alpha Topic Beta Follow Topic Beta",
      elements: [
        actionButton(533, "Follow Topic Alpha"),
        actionButton(534, "Follow Topic Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unfollowed topics Topic Alpha Follow Topic Alpha",
      pageContent: "Unfollowed topics Topic Alpha Follow Topic Alpha",
      elements: [actionButton(533, "Follow Topic Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Follow Topic Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 534 },
      result: "Clicked element 534.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Followed Topic Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "follow",
      targetLabel: "Topic Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:follow:topic-beta",
        detail: expect.objectContaining({
          action: "follow",
          source: "target_disappearance",
          text: "Followed target no longer visible: Topic Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer follow confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unfollowed topics Topic Alpha Follow Topic Alpha",
      pageContent: "Unfollowed topics Topic Alpha Follow Topic Alpha",
      elements: [actionButton(533, "Follow Topic Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unfollowed topics Topic Alpha Follow Topic Alpha",
      pageContent: "Unfollowed topics Topic Alpha Follow Topic Alpha",
      elements: [actionButton(533, "Follow Topic Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 533 },
      result: "Clicked element 533.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer follow confirmation from a generic follow button", () => {
    const genericFollowButton: TaggedElement = {
      tag: 533,
      tagName: "button",
      role: "button",
      text: "Follow",
      attributes: {
        id: "follow",
        "aria-label": "Follow",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unfollowed topics Topic Alpha Follow",
      pageContent: "Unfollowed topics Topic Alpha Follow",
      elements: [genericFollowButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unfollowed topics",
      pageContent: "Unfollowed topics",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 533 },
      result: "Clicked element 533.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unfollow confirmation from named followed target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Followed topics Topic Alpha Unfollow Topic Alpha Topic Beta Unfollow Topic Beta",
      pageContent:
        "Followed topics Topic Alpha Unfollow Topic Alpha Topic Beta Unfollow Topic Beta",
      elements: [
        actionButton(529, "Unfollow Topic Alpha"),
        actionButton(530, "Unfollow Topic Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Followed topics Topic Beta Unfollow Topic Beta",
      pageContent: "Followed topics Topic Beta Unfollow Topic Beta",
      elements: [actionButton(530, "Unfollow Topic Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unfollow Topic Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 529 },
      result: "Clicked element 529.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unfollowed Topic Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unfollow",
      targetLabel: "Topic Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unfollow:topic-alpha",
        detail: expect.objectContaining({
          action: "unfollow",
          source: "target_disappearance",
          text: "Unfollowed target no longer visible: Topic Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unfollow target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Followed topics Topic Alpha Unfollow Topic Alpha Topic Beta Unfollow Topic Beta",
      pageContent:
        "Followed topics Topic Alpha Unfollow Topic Alpha Topic Beta Unfollow Topic Beta",
      elements: [
        actionButton(529, "Unfollow Topic Alpha"),
        actionButton(530, "Unfollow Topic Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Followed topics Topic Alpha Unfollow Topic Alpha",
      pageContent: "Followed topics Topic Alpha Unfollow Topic Alpha",
      elements: [actionButton(529, "Unfollow Topic Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unfollow Topic Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 530 },
      result: "Clicked element 530.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unfollowed Topic Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unfollow",
      targetLabel: "Topic Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unfollow:topic-beta",
        detail: expect.objectContaining({
          action: "unfollow",
          source: "target_disappearance",
          text: "Unfollowed target no longer visible: Topic Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unfollow confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Followed topics Topic Alpha Unfollow Topic Alpha",
      pageContent: "Followed topics Topic Alpha Unfollow Topic Alpha",
      elements: [actionButton(529, "Unfollow Topic Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Followed topics Topic Alpha Unfollow Topic Alpha",
      pageContent: "Followed topics Topic Alpha Unfollow Topic Alpha",
      elements: [actionButton(529, "Unfollow Topic Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 529 },
      result: "Clicked element 529.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unfollow confirmation from a generic unfollow button", () => {
    const genericUnfollowButton: TaggedElement = {
      tag: 529,
      tagName: "button",
      role: "button",
      text: "Unfollow",
      attributes: {
        id: "unfollow",
        "aria-label": "Unfollow",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Followed topics Topic Alpha Unfollow",
      pageContent: "Followed topics Topic Alpha Unfollow",
      elements: [genericUnfollowButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Followed topics",
      pageContent: "Followed topics",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 529 },
      result: "Clicked element 529.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts watch confirmation from named unwatched target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unwatched repositories Repository Alpha Watch Repository Alpha Repository Beta Watch Repository Beta",
      pageContent:
        "Unwatched repositories Repository Alpha Watch Repository Alpha Repository Beta Watch Repository Beta",
      elements: [
        actionButton(535, "Watch Repository Alpha"),
        actionButton(536, "Watch Repository Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Unwatched repositories Repository Beta Watch Repository Beta",
      pageContent:
        "Unwatched repositories Repository Beta Watch Repository Beta",
      elements: [actionButton(536, "Watch Repository Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Watch Repository Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 535 },
      result: "Clicked element 535.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Watched Repository Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "watch",
      targetLabel: "Repository Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:watch:repository-alpha",
        detail: expect.objectContaining({
          action: "watch",
          source: "target_disappearance",
          text: "Watched target no longer visible: Repository Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects watch target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unwatched repositories Repository Alpha Watch Repository Alpha Repository Beta Watch Repository Beta",
      pageContent:
        "Unwatched repositories Repository Alpha Watch Repository Alpha Repository Beta Watch Repository Beta",
      elements: [
        actionButton(535, "Watch Repository Alpha"),
        actionButton(536, "Watch Repository Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Unwatched repositories Repository Alpha Watch Repository Alpha",
      pageContent:
        "Unwatched repositories Repository Alpha Watch Repository Alpha",
      elements: [actionButton(535, "Watch Repository Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Watch Repository Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 536 },
      result: "Clicked element 536.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Watched Repository Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "watch",
      targetLabel: "Repository Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:watch:repository-beta",
        detail: expect.objectContaining({
          action: "watch",
          source: "target_disappearance",
          text: "Watched target no longer visible: Repository Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer watch confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unwatched repositories Repository Alpha Watch Repository Alpha",
      pageContent:
        "Unwatched repositories Repository Alpha Watch Repository Alpha",
      elements: [actionButton(535, "Watch Repository Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Unwatched repositories Repository Alpha Watch Repository Alpha",
      pageContent:
        "Unwatched repositories Repository Alpha Watch Repository Alpha",
      elements: [actionButton(535, "Watch Repository Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 535 },
      result: "Clicked element 535.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer watch confirmation from a generic watch button", () => {
    const genericWatchButton: TaggedElement = {
      tag: 535,
      tagName: "button",
      role: "button",
      text: "Watch",
      attributes: {
        id: "watch",
        "aria-label": "Watch",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unwatched repositories Repository Alpha Watch",
      pageContent: "Unwatched repositories Repository Alpha Watch",
      elements: [genericWatchButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unwatched repositories",
      pageContent: "Unwatched repositories",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 535 },
      result: "Clicked element 535.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unwatch confirmation from named watched target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Watched repositories Repository Alpha Unwatch Repository Alpha Repository Beta Unwatch Repository Beta",
      pageContent:
        "Watched repositories Repository Alpha Unwatch Repository Alpha Repository Beta Unwatch Repository Beta",
      elements: [
        actionButton(531, "Unwatch Repository Alpha"),
        actionButton(532, "Unwatch Repository Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Watched repositories Repository Beta Unwatch Repository Beta",
      pageContent:
        "Watched repositories Repository Beta Unwatch Repository Beta",
      elements: [actionButton(532, "Unwatch Repository Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unwatch Repository Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 531 },
      result: "Clicked element 531.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unwatched Repository Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unwatch",
      targetLabel: "Repository Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unwatch:repository-alpha",
        detail: expect.objectContaining({
          action: "unwatch",
          source: "target_disappearance",
          text: "Unwatched target no longer visible: Repository Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unwatch target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Watched repositories Repository Alpha Unwatch Repository Alpha Repository Beta Unwatch Repository Beta",
      pageContent:
        "Watched repositories Repository Alpha Unwatch Repository Alpha Repository Beta Unwatch Repository Beta",
      elements: [
        actionButton(531, "Unwatch Repository Alpha"),
        actionButton(532, "Unwatch Repository Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Watched repositories Repository Alpha Unwatch Repository Alpha",
      pageContent:
        "Watched repositories Repository Alpha Unwatch Repository Alpha",
      elements: [actionButton(531, "Unwatch Repository Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unwatch Repository Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 532 },
      result: "Clicked element 532.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unwatched Repository Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unwatch",
      targetLabel: "Repository Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unwatch:repository-beta",
        detail: expect.objectContaining({
          action: "unwatch",
          source: "target_disappearance",
          text: "Unwatched target no longer visible: Repository Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unwatch confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Watched repositories Repository Alpha Unwatch Repository Alpha",
      pageContent:
        "Watched repositories Repository Alpha Unwatch Repository Alpha",
      elements: [actionButton(531, "Unwatch Repository Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Watched repositories Repository Alpha Unwatch Repository Alpha",
      pageContent:
        "Watched repositories Repository Alpha Unwatch Repository Alpha",
      elements: [actionButton(531, "Unwatch Repository Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 531 },
      result: "Clicked element 531.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unwatch confirmation from a generic unwatch button", () => {
    const genericUnwatchButton: TaggedElement = {
      tag: 531,
      tagName: "button",
      role: "button",
      text: "Unwatch",
      attributes: {
        id: "unwatch",
        "aria-label": "Unwatch",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Watched repositories Repository Alpha Unwatch",
      pageContent: "Watched repositories Repository Alpha Unwatch",
      elements: [genericUnwatchButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Watched repositories",
      pageContent: "Watched repositories",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 531 },
      result: "Clicked element 531.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts star confirmation from named unstarred target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unstarred repositories Repository Alpha Star Repository Alpha Repository Beta Star Repository Beta",
      pageContent:
        "Unstarred repositories Repository Alpha Star Repository Alpha Repository Beta Star Repository Beta",
      elements: [
        actionButton(537, "Star Repository Alpha"),
        actionButton(538, "Star Repository Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Unstarred repositories Repository Beta Star Repository Beta",
      pageContent:
        "Unstarred repositories Repository Beta Star Repository Beta",
      elements: [actionButton(538, "Star Repository Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Star Repository Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Starred Repository Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "star",
      targetLabel: "Repository Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:star:repository-alpha",
        detail: expect.objectContaining({
          action: "star",
          source: "target_disappearance",
          text: "Starred target no longer visible: Repository Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects star target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unstarred repositories Repository Alpha Star Repository Alpha Repository Beta Star Repository Beta",
      pageContent:
        "Unstarred repositories Repository Alpha Star Repository Alpha Repository Beta Star Repository Beta",
      elements: [
        actionButton(537, "Star Repository Alpha"),
        actionButton(538, "Star Repository Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Unstarred repositories Repository Alpha Star Repository Alpha",
      pageContent:
        "Unstarred repositories Repository Alpha Star Repository Alpha",
      elements: [actionButton(537, "Star Repository Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Star Repository Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 538 },
      result: "Clicked element 538.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Starred Repository Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "star",
      targetLabel: "Repository Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:star:repository-beta",
        detail: expect.objectContaining({
          action: "star",
          source: "target_disappearance",
          text: "Starred target no longer visible: Repository Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer star confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unstarred repositories Repository Alpha Star Repository Alpha",
      pageContent:
        "Unstarred repositories Repository Alpha Star Repository Alpha",
      elements: [actionButton(537, "Star Repository Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Unstarred repositories Repository Alpha Star Repository Alpha",
      pageContent:
        "Unstarred repositories Repository Alpha Star Repository Alpha",
      elements: [actionButton(537, "Star Repository Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer star confirmation from a generic star button", () => {
    const genericStarButton: TaggedElement = {
      tag: 537,
      tagName: "button",
      role: "button",
      text: "Star",
      attributes: {
        id: "star",
        "aria-label": "Star",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unstarred repositories Repository Alpha Star",
      pageContent: "Unstarred repositories Repository Alpha Star",
      elements: [genericStarButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unstarred repositories",
      pageContent: "Unstarred repositories",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unstar confirmation from named starred target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Starred repositories Repository Alpha Unstar Repository Alpha Repository Beta Unstar Repository Beta",
      pageContent:
        "Starred repositories Repository Alpha Unstar Repository Alpha Repository Beta Unstar Repository Beta",
      elements: [
        actionButton(533, "Unstar Repository Alpha"),
        actionButton(534, "Unstar Repository Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Starred repositories Repository Beta Unstar Repository Beta",
      pageContent:
        "Starred repositories Repository Beta Unstar Repository Beta",
      elements: [actionButton(534, "Unstar Repository Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unstar Repository Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 533 },
      result: "Clicked element 533.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unstarred Repository Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unstar",
      targetLabel: "Repository Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unstar:repository-alpha",
        detail: expect.objectContaining({
          action: "unstar",
          source: "target_disappearance",
          text: "Unstarred target no longer visible: Repository Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unstar target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Starred repositories Repository Alpha Unstar Repository Alpha Repository Beta Unstar Repository Beta",
      pageContent:
        "Starred repositories Repository Alpha Unstar Repository Alpha Repository Beta Unstar Repository Beta",
      elements: [
        actionButton(533, "Unstar Repository Alpha"),
        actionButton(534, "Unstar Repository Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Starred repositories Repository Alpha Unstar Repository Alpha",
      pageContent:
        "Starred repositories Repository Alpha Unstar Repository Alpha",
      elements: [actionButton(533, "Unstar Repository Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unstar Repository Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 534 },
      result: "Clicked element 534.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unstarred Repository Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unstar",
      targetLabel: "Repository Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unstar:repository-beta",
        detail: expect.objectContaining({
          action: "unstar",
          source: "target_disappearance",
          text: "Unstarred target no longer visible: Repository Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unstar confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Starred repositories Repository Alpha Unstar Repository Alpha",
      pageContent:
        "Starred repositories Repository Alpha Unstar Repository Alpha",
      elements: [actionButton(533, "Unstar Repository Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Starred repositories Repository Alpha Unstar Repository Alpha",
      pageContent:
        "Starred repositories Repository Alpha Unstar Repository Alpha",
      elements: [actionButton(533, "Unstar Repository Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 533 },
      result: "Clicked element 533.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unstar confirmation from a generic unstar button", () => {
    const genericUnstarButton: TaggedElement = {
      tag: 533,
      tagName: "button",
      role: "button",
      text: "Unstar",
      attributes: {
        id: "unstar",
        "aria-label": "Unstar",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Starred repositories Repository Alpha Unstar",
      pageContent: "Starred repositories Repository Alpha Unstar",
      elements: [genericUnstarButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Starred repositories",
      pageContent: "Starred repositories",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 533 },
      result: "Clicked element 533.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts bookmark confirmation from named unbookmarked target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unbookmarked pages Page Alpha Bookmark Page Alpha Page Beta Bookmark Page Beta",
      pageContent:
        "Unbookmarked pages Page Alpha Bookmark Page Alpha Page Beta Bookmark Page Beta",
      elements: [
        actionButton(539, "Bookmark Page Alpha"),
        actionButton(540, "Bookmark Page Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unbookmarked pages Page Beta Bookmark Page Beta",
      pageContent: "Unbookmarked pages Page Beta Bookmark Page Beta",
      elements: [actionButton(540, "Bookmark Page Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Bookmark Page Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 539 },
      result: "Clicked element 539.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Bookmarked Page Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "bookmark",
      targetLabel: "Page Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:bookmark:page-alpha",
        detail: expect.objectContaining({
          action: "bookmark",
          source: "target_disappearance",
          text: "Bookmarked target no longer visible: Page Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects bookmark target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unbookmarked pages Page Alpha Bookmark Page Alpha Page Beta Bookmark Page Beta",
      pageContent:
        "Unbookmarked pages Page Alpha Bookmark Page Alpha Page Beta Bookmark Page Beta",
      elements: [
        actionButton(539, "Bookmark Page Alpha"),
        actionButton(540, "Bookmark Page Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unbookmarked pages Page Alpha Bookmark Page Alpha",
      pageContent: "Unbookmarked pages Page Alpha Bookmark Page Alpha",
      elements: [actionButton(539, "Bookmark Page Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Bookmark Page Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 540 },
      result: "Clicked element 540.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Bookmarked Page Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "bookmark",
      targetLabel: "Page Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:bookmark:page-beta",
        detail: expect.objectContaining({
          action: "bookmark",
          source: "target_disappearance",
          text: "Bookmarked target no longer visible: Page Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer bookmark confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unbookmarked pages Page Alpha Bookmark Page Alpha",
      pageContent: "Unbookmarked pages Page Alpha Bookmark Page Alpha",
      elements: [actionButton(539, "Bookmark Page Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unbookmarked pages Page Alpha Bookmark Page Alpha",
      pageContent: "Unbookmarked pages Page Alpha Bookmark Page Alpha",
      elements: [actionButton(539, "Bookmark Page Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 539 },
      result: "Clicked element 539.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer bookmark confirmation from a generic bookmark button", () => {
    const genericBookmarkButton: TaggedElement = {
      tag: 539,
      tagName: "button",
      role: "button",
      text: "Bookmark",
      attributes: {
        id: "bookmark",
        "aria-label": "Bookmark",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unbookmarked pages Page Alpha Bookmark",
      pageContent: "Unbookmarked pages Page Alpha Bookmark",
      elements: [genericBookmarkButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unbookmarked pages",
      pageContent: "Unbookmarked pages",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 539 },
      result: "Clicked element 539.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unbookmark confirmation from named bookmarked target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Bookmarked pages Page Alpha Unbookmark Page Alpha Page Beta Unbookmark Page Beta",
      pageContent:
        "Bookmarked pages Page Alpha Unbookmark Page Alpha Page Beta Unbookmark Page Beta",
      elements: [
        actionButton(535, "Unbookmark Page Alpha"),
        actionButton(536, "Unbookmark Page Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Bookmarked pages Page Beta Unbookmark Page Beta",
      pageContent: "Bookmarked pages Page Beta Unbookmark Page Beta",
      elements: [actionButton(536, "Unbookmark Page Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unbookmark Page Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 535 },
      result: "Clicked element 535.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unbookmarked Page Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unbookmark",
      targetLabel: "Page Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unbookmark:page-alpha",
        detail: expect.objectContaining({
          action: "unbookmark",
          source: "target_disappearance",
          text: "Unbookmarked target no longer visible: Page Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unbookmark target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Bookmarked pages Page Alpha Unbookmark Page Alpha Page Beta Unbookmark Page Beta",
      pageContent:
        "Bookmarked pages Page Alpha Unbookmark Page Alpha Page Beta Unbookmark Page Beta",
      elements: [
        actionButton(535, "Unbookmark Page Alpha"),
        actionButton(536, "Unbookmark Page Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Bookmarked pages Page Alpha Unbookmark Page Alpha",
      pageContent: "Bookmarked pages Page Alpha Unbookmark Page Alpha",
      elements: [actionButton(535, "Unbookmark Page Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unbookmark Page Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 536 },
      result: "Clicked element 536.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unbookmarked Page Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unbookmark",
      targetLabel: "Page Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unbookmark:page-beta",
        detail: expect.objectContaining({
          action: "unbookmark",
          source: "target_disappearance",
          text: "Unbookmarked target no longer visible: Page Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unbookmark confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Bookmarked pages Page Alpha Unbookmark Page Alpha",
      pageContent: "Bookmarked pages Page Alpha Unbookmark Page Alpha",
      elements: [actionButton(535, "Unbookmark Page Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Bookmarked pages Page Alpha Unbookmark Page Alpha",
      pageContent: "Bookmarked pages Page Alpha Unbookmark Page Alpha",
      elements: [actionButton(535, "Unbookmark Page Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 535 },
      result: "Clicked element 535.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unbookmark confirmation from a generic unbookmark button", () => {
    const genericUnbookmarkButton: TaggedElement = {
      tag: 535,
      tagName: "button",
      role: "button",
      text: "Unbookmark",
      attributes: {
        id: "unbookmark",
        "aria-label": "Unbookmark",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Bookmarked pages Page Alpha Unbookmark",
      pageContent: "Bookmarked pages Page Alpha Unbookmark",
      elements: [genericUnbookmarkButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Bookmarked pages",
      pageContent: "Bookmarked pages",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 535 },
      result: "Clicked element 535.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts favorite confirmation from named unfavorited target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unfavorited reports Report Alpha Favorite Report Alpha Report Beta Favorite Report Beta",
      pageContent:
        "Unfavorited reports Report Alpha Favorite Report Alpha Report Beta Favorite Report Beta",
      elements: [
        actionButton(541, "Favorite Report Alpha"),
        actionButton(542, "Favorite Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unfavorited reports Report Beta Favorite Report Beta",
      pageContent: "Unfavorited reports Report Beta Favorite Report Beta",
      elements: [actionButton(542, "Favorite Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Favorite Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Favorited Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "favorite",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:favorite:report-alpha",
        detail: expect.objectContaining({
          action: "favorite",
          source: "target_disappearance",
          text: "Favorited target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects favorite target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unfavorited reports Report Alpha Favorite Report Alpha Report Beta Favorite Report Beta",
      pageContent:
        "Unfavorited reports Report Alpha Favorite Report Alpha Report Beta Favorite Report Beta",
      elements: [
        actionButton(541, "Favorite Report Alpha"),
        actionButton(542, "Favorite Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unfavorited reports Report Alpha Favorite Report Alpha",
      pageContent: "Unfavorited reports Report Alpha Favorite Report Alpha",
      elements: [actionButton(541, "Favorite Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Favorite Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 542 },
      result: "Clicked element 542.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Favorited Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "favorite",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:favorite:report-beta",
        detail: expect.objectContaining({
          action: "favorite",
          source: "target_disappearance",
          text: "Favorited target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer favorite confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unfavorited reports Report Alpha Favorite Report Alpha",
      pageContent: "Unfavorited reports Report Alpha Favorite Report Alpha",
      elements: [actionButton(541, "Favorite Report Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unfavorited reports Report Alpha Favorite Report Alpha",
      pageContent: "Unfavorited reports Report Alpha Favorite Report Alpha",
      elements: [actionButton(541, "Favorite Report Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer favorite confirmation from a generic favorite button", () => {
    const genericFavoriteButton: TaggedElement = {
      tag: 541,
      tagName: "button",
      role: "button",
      text: "Favorite",
      attributes: {
        id: "favorite",
        "aria-label": "Favorite",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unfavorited reports Report Alpha Favorite",
      pageContent: "Unfavorited reports Report Alpha Favorite",
      elements: [genericFavoriteButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unfavorited reports",
      pageContent: "Unfavorited reports",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unfavorite confirmation from named favorited target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha Report Beta Unfavorite Report Beta",
      pageContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha Report Beta Unfavorite Report Beta",
      elements: [
        actionButton(537, "Unfavorite Report Alpha"),
        actionButton(538, "Unfavorite Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Favorited reports Report Beta Unfavorite Report Beta",
      pageContent:
        "Favorited reports Report Beta Unfavorite Report Beta",
      elements: [actionButton(538, "Unfavorite Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unfavorite Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unfavorited Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unfavorite",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unfavorite:report-alpha",
        detail: expect.objectContaining({
          action: "unfavorite",
          source: "target_disappearance",
          text: "Unfavorited target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unfavorite target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha Report Beta Unfavorite Report Beta",
      pageContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha Report Beta Unfavorite Report Beta",
      elements: [
        actionButton(537, "Unfavorite Report Alpha"),
        actionButton(538, "Unfavorite Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha",
      pageContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha",
      elements: [actionButton(537, "Unfavorite Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unfavorite Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 538 },
      result: "Clicked element 538.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unfavorited Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unfavorite",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unfavorite:report-beta",
        detail: expect.objectContaining({
          action: "unfavorite",
          source: "target_disappearance",
          text: "Unfavorited target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unfavorite confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha",
      pageContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha",
      elements: [actionButton(537, "Unfavorite Report Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha",
      pageContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha",
      elements: [actionButton(537, "Unfavorite Report Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unfavorite confirmation from a generic unfavorite button", () => {
    const genericUnfavoriteButton: TaggedElement = {
      tag: 537,
      tagName: "button",
      role: "button",
      text: "Unfavorite",
      attributes: {
        id: "unfavorite",
        "aria-label": "Unfavorite",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Favorited reports Report Alpha Unfavorite",
      pageContent: "Favorited reports Report Alpha Unfavorite",
      elements: [genericUnfavoriteButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Favorited reports",
      pageContent: "Favorited reports",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts pin confirmation from named unpinned target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unpinned reports Report Alpha Pin Report Alpha Report Beta Pin Report Beta",
      pageContent:
        "Unpinned reports Report Alpha Pin Report Alpha Report Beta Pin Report Beta",
      elements: [
        actionButton(543, "Pin Report Alpha"),
        actionButton(544, "Pin Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unpinned reports Report Beta Pin Report Beta",
      pageContent: "Unpinned reports Report Beta Pin Report Beta",
      elements: [actionButton(544, "Pin Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Pin Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Pinned Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "pin",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:pin:report-alpha",
        detail: expect.objectContaining({
          action: "pin",
          source: "target_disappearance",
          text: "Pinned target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects pin target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unpinned reports Report Alpha Pin Report Alpha Report Beta Pin Report Beta",
      pageContent:
        "Unpinned reports Report Alpha Pin Report Alpha Report Beta Pin Report Beta",
      elements: [
        actionButton(543, "Pin Report Alpha"),
        actionButton(544, "Pin Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unpinned reports Report Alpha Pin Report Alpha",
      pageContent: "Unpinned reports Report Alpha Pin Report Alpha",
      elements: [actionButton(543, "Pin Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Pin Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 544 },
      result: "Clicked element 544.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Pinned Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "pin",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:pin:report-beta",
        detail: expect.objectContaining({
          action: "pin",
          source: "target_disappearance",
          text: "Pinned target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer pin confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unpinned reports Report Alpha Pin Report Alpha",
      pageContent: "Unpinned reports Report Alpha Pin Report Alpha",
      elements: [actionButton(543, "Pin Report Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unpinned reports Report Alpha Pin Report Alpha",
      pageContent: "Unpinned reports Report Alpha Pin Report Alpha",
      elements: [actionButton(543, "Pin Report Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer pin confirmation from a generic pin button", () => {
    const genericPinButton: TaggedElement = {
      tag: 543,
      tagName: "button",
      role: "button",
      text: "Pin",
      attributes: {
        id: "pin",
        "aria-label": "Pin",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unpinned reports Report Alpha Pin",
      pageContent: "Unpinned reports Report Alpha Pin",
      elements: [genericPinButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unpinned reports",
      pageContent: "Unpinned reports",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unpin confirmation from named pinned target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pinned reports Report Alpha Unpin Report Alpha Report Beta Unpin Report Beta",
      pageContent:
        "Pinned reports Report Alpha Unpin Report Alpha Report Beta Unpin Report Beta",
      elements: [
        actionButton(539, "Unpin Report Alpha"),
        actionButton(540, "Unpin Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pinned reports Report Beta Unpin Report Beta",
      pageContent: "Pinned reports Report Beta Unpin Report Beta",
      elements: [actionButton(540, "Unpin Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unpin Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 539 },
      result: "Clicked element 539.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unpinned Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unpin",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unpin:report-alpha",
        detail: expect.objectContaining({
          action: "unpin",
          source: "target_disappearance",
          text: "Unpinned target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unpin target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pinned reports Report Alpha Unpin Report Alpha Report Beta Unpin Report Beta",
      pageContent:
        "Pinned reports Report Alpha Unpin Report Alpha Report Beta Unpin Report Beta",
      elements: [
        actionButton(539, "Unpin Report Alpha"),
        actionButton(540, "Unpin Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pinned reports Report Alpha Unpin Report Alpha",
      pageContent: "Pinned reports Report Alpha Unpin Report Alpha",
      elements: [actionButton(539, "Unpin Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unpin Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 540 },
      result: "Clicked element 540.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unpinned Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unpin",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unpin:report-beta",
        detail: expect.objectContaining({
          action: "unpin",
          source: "target_disappearance",
          text: "Unpinned target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unpin confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pinned reports Report Alpha Unpin Report Alpha",
      pageContent: "Pinned reports Report Alpha Unpin Report Alpha",
      elements: [actionButton(539, "Unpin Report Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pinned reports Report Alpha Unpin Report Alpha",
      pageContent: "Pinned reports Report Alpha Unpin Report Alpha",
      elements: [actionButton(539, "Unpin Report Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 539 },
      result: "Clicked element 539.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unpin confirmation from a generic unpin button", () => {
    const genericUnpinButton: TaggedElement = {
      tag: 539,
      tagName: "button",
      role: "button",
      text: "Unpin",
      attributes: {
        id: "unpin",
        "aria-label": "Unpin",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pinned reports Report Alpha Unpin",
      pageContent: "Pinned reports Report Alpha Unpin",
      elements: [genericUnpinButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pinned reports",
      pageContent: "Pinned reports",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 539 },
      result: "Clicked element 539.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts mute confirmation from named unmuted target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unmuted channels Channel Alpha Mute Channel Alpha Channel Beta Mute Channel Beta",
      pageContent:
        "Unmuted channels Channel Alpha Mute Channel Alpha Channel Beta Mute Channel Beta",
      elements: [
        actionButton(545, "Mute Channel Alpha"),
        actionButton(546, "Mute Channel Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unmuted channels Channel Beta Mute Channel Beta",
      pageContent: "Unmuted channels Channel Beta Mute Channel Beta",
      elements: [actionButton(546, "Mute Channel Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Mute Channel Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Muted Channel Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "mute",
      targetLabel: "Channel Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:mute:channel-alpha",
        detail: expect.objectContaining({
          action: "mute",
          source: "target_disappearance",
          text: "Muted target no longer visible: Channel Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects mute target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unmuted channels Channel Alpha Mute Channel Alpha Channel Beta Mute Channel Beta",
      pageContent:
        "Unmuted channels Channel Alpha Mute Channel Alpha Channel Beta Mute Channel Beta",
      elements: [
        actionButton(545, "Mute Channel Alpha"),
        actionButton(546, "Mute Channel Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unmuted channels Channel Alpha Mute Channel Alpha",
      pageContent: "Unmuted channels Channel Alpha Mute Channel Alpha",
      elements: [actionButton(545, "Mute Channel Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Mute Channel Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 546 },
      result: "Clicked element 546.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Muted Channel Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "mute",
      targetLabel: "Channel Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:mute:channel-beta",
        detail: expect.objectContaining({
          action: "mute",
          source: "target_disappearance",
          text: "Muted target no longer visible: Channel Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer mute confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unmuted channels Channel Alpha Mute Channel Alpha",
      pageContent: "Unmuted channels Channel Alpha Mute Channel Alpha",
      elements: [actionButton(545, "Mute Channel Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unmuted channels Channel Alpha Mute Channel Alpha",
      pageContent: "Unmuted channels Channel Alpha Mute Channel Alpha",
      elements: [actionButton(545, "Mute Channel Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer mute confirmation from a generic mute button", () => {
    const genericMuteButton: TaggedElement = {
      tag: 545,
      tagName: "button",
      role: "button",
      text: "Mute",
      attributes: {
        id: "mute",
        "aria-label": "Mute",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unmuted channels Channel Alpha Mute",
      pageContent: "Unmuted channels Channel Alpha Mute",
      elements: [genericMuteButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unmuted channels",
      pageContent: "Unmuted channels",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unmute confirmation from named muted target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Muted channels Channel Alpha Unmute Channel Alpha Channel Beta Unmute Channel Beta",
      pageContent:
        "Muted channels Channel Alpha Unmute Channel Alpha Channel Beta Unmute Channel Beta",
      elements: [
        actionButton(541, "Unmute Channel Alpha"),
        actionButton(542, "Unmute Channel Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Muted channels Channel Beta Unmute Channel Beta",
      pageContent: "Muted channels Channel Beta Unmute Channel Beta",
      elements: [actionButton(542, "Unmute Channel Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unmute Channel Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unmuted Channel Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unmute",
      targetLabel: "Channel Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unmute:channel-alpha",
        detail: expect.objectContaining({
          action: "unmute",
          source: "target_disappearance",
          text: "Unmuted target no longer visible: Channel Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unmute target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Muted channels Channel Alpha Unmute Channel Alpha Channel Beta Unmute Channel Beta",
      pageContent:
        "Muted channels Channel Alpha Unmute Channel Alpha Channel Beta Unmute Channel Beta",
      elements: [
        actionButton(541, "Unmute Channel Alpha"),
        actionButton(542, "Unmute Channel Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Muted channels Channel Alpha Unmute Channel Alpha",
      pageContent: "Muted channels Channel Alpha Unmute Channel Alpha",
      elements: [actionButton(541, "Unmute Channel Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unmute Channel Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 542 },
      result: "Clicked element 542.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unmuted Channel Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unmute",
      targetLabel: "Channel Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unmute:channel-beta",
        detail: expect.objectContaining({
          action: "unmute",
          source: "target_disappearance",
          text: "Unmuted target no longer visible: Channel Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unmute confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Muted channels Channel Alpha Unmute Channel Alpha",
      pageContent: "Muted channels Channel Alpha Unmute Channel Alpha",
      elements: [actionButton(541, "Unmute Channel Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Muted channels Channel Alpha Unmute Channel Alpha",
      pageContent: "Muted channels Channel Alpha Unmute Channel Alpha",
      elements: [actionButton(541, "Unmute Channel Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unmute confirmation from a generic unmute button", () => {
    const genericUnmuteButton: TaggedElement = {
      tag: 541,
      tagName: "button",
      role: "button",
      text: "Unmute",
      attributes: {
        id: "unmute",
        "aria-label": "Unmute",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Muted channels Channel Alpha Unmute",
      pageContent: "Muted channels Channel Alpha Unmute",
      elements: [genericUnmuteButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Muted channels",
      pageContent: "Muted channels",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unschedule confirmation from named scheduled target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Scheduled reports Report Alpha Unschedule Report Alpha Report Beta Unschedule Report Beta",
      pageContent:
        "Scheduled reports Report Alpha Unschedule Report Alpha Report Beta Unschedule Report Beta",
      elements: [
        actionButton(543, "Unschedule Report Alpha"),
        actionButton(544, "Unschedule Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Scheduled reports Report Beta Unschedule Report Beta",
      pageContent:
        "Scheduled reports Report Beta Unschedule Report Beta",
      elements: [actionButton(544, "Unschedule Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unschedule Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unscheduled Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unschedule",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unschedule:report-alpha",
        detail: expect.objectContaining({
          action: "unschedule",
          source: "target_disappearance",
          text: "Unscheduled target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unschedule target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Scheduled reports Report Alpha Unschedule Report Alpha Report Beta Unschedule Report Beta",
      pageContent:
        "Scheduled reports Report Alpha Unschedule Report Alpha Report Beta Unschedule Report Beta",
      elements: [
        actionButton(543, "Unschedule Report Alpha"),
        actionButton(544, "Unschedule Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Scheduled reports Report Alpha Unschedule Report Alpha",
      pageContent:
        "Scheduled reports Report Alpha Unschedule Report Alpha",
      elements: [actionButton(543, "Unschedule Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unschedule Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 544 },
      result: "Clicked element 544.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unscheduled Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unschedule",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unschedule:report-beta",
        detail: expect.objectContaining({
          action: "unschedule",
          source: "target_disappearance",
          text: "Unscheduled target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unschedule confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Scheduled reports Report Alpha Unschedule Report Alpha",
      pageContent:
        "Scheduled reports Report Alpha Unschedule Report Alpha",
      elements: [actionButton(543, "Unschedule Report Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Scheduled reports Report Alpha Unschedule Report Alpha",
      pageContent:
        "Scheduled reports Report Alpha Unschedule Report Alpha",
      elements: [actionButton(543, "Unschedule Report Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unschedule confirmation from a generic unschedule button", () => {
    const genericUnscheduleButton: TaggedElement = {
      tag: 543,
      tagName: "button",
      role: "button",
      text: "Unschedule",
      attributes: {
        id: "unschedule",
        "aria-label": "Unschedule",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Scheduled reports Report Alpha Unschedule",
      pageContent: "Scheduled reports Report Alpha Unschedule",
      elements: [genericUnscheduleButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Scheduled reports",
      pageContent: "Scheduled reports",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unassign confirmation from named assigned target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Assigned tickets Ticket Alpha Unassign Ticket Alpha Ticket Beta Unassign Ticket Beta",
      pageContent:
        "Assigned tickets Ticket Alpha Unassign Ticket Alpha Ticket Beta Unassign Ticket Beta",
      elements: [
        actionButton(545, "Unassign Ticket Alpha"),
        actionButton(546, "Unassign Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Assigned tickets Ticket Beta Unassign Ticket Beta",
      pageContent: "Assigned tickets Ticket Beta Unassign Ticket Beta",
      elements: [actionButton(546, "Unassign Ticket Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unassign Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unassigned Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unassign",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unassign:ticket-alpha",
        detail: expect.objectContaining({
          action: "unassign",
          source: "target_disappearance",
          text: "Unassigned target no longer visible: Ticket Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unassign target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Assigned tickets Ticket Alpha Unassign Ticket Alpha Ticket Beta Unassign Ticket Beta",
      pageContent:
        "Assigned tickets Ticket Alpha Unassign Ticket Alpha Ticket Beta Unassign Ticket Beta",
      elements: [
        actionButton(545, "Unassign Ticket Alpha"),
        actionButton(546, "Unassign Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Assigned tickets Ticket Alpha Unassign Ticket Alpha",
      pageContent: "Assigned tickets Ticket Alpha Unassign Ticket Alpha",
      elements: [actionButton(545, "Unassign Ticket Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unassign Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 546 },
      result: "Clicked element 546.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unassigned Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unassign",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unassign:ticket-beta",
        detail: expect.objectContaining({
          action: "unassign",
          source: "target_disappearance",
          text: "Unassigned target no longer visible: Ticket Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unassign confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Assigned tickets Ticket Alpha Unassign Ticket Alpha",
      pageContent: "Assigned tickets Ticket Alpha Unassign Ticket Alpha",
      elements: [actionButton(545, "Unassign Ticket Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Assigned tickets Ticket Alpha Unassign Ticket Alpha",
      pageContent: "Assigned tickets Ticket Alpha Unassign Ticket Alpha",
      elements: [actionButton(545, "Unassign Ticket Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unassign confirmation from a generic unassign button", () => {
    const genericUnassignButton: TaggedElement = {
      tag: 545,
      tagName: "button",
      role: "button",
      text: "Unassign",
      attributes: {
        id: "unassign",
        "aria-label": "Unassign",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Assigned tickets Ticket Alpha Unassign",
      pageContent: "Assigned tickets Ticket Alpha Unassign",
      elements: [genericUnassignButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Assigned tickets",
      pageContent: "Assigned tickets",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts cancel confirmation from named target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Active requests Request Alpha Cancel Request Alpha Request Beta Cancel Request Beta",
      pageContent:
        "Active requests Request Alpha Cancel Request Alpha Request Beta Cancel Request Beta",
      elements: [
        actionButton(547, "Cancel Request Alpha"),
        actionButton(548, "Cancel Request Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Active requests Request Beta Cancel Request Beta",
      pageContent: "Active requests Request Beta Cancel Request Beta",
      elements: [actionButton(548, "Cancel Request Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Cancel Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 547 },
      result: "Clicked element 547.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Canceled Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "cancel",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:cancel:request-alpha",
        detail: expect.objectContaining({
          action: "cancel",
          source: "target_disappearance",
          text: "Canceled target no longer visible: Request Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects cancel target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Active requests Request Alpha Cancel Request Alpha Request Beta Cancel Request Beta",
      pageContent:
        "Active requests Request Alpha Cancel Request Alpha Request Beta Cancel Request Beta",
      elements: [
        actionButton(547, "Cancel Request Alpha"),
        actionButton(548, "Cancel Request Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Active requests Request Alpha Cancel Request Alpha",
      pageContent: "Active requests Request Alpha Cancel Request Alpha",
      elements: [actionButton(547, "Cancel Request Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Cancel Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 548 },
      result: "Clicked element 548.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Canceled Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "cancel",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:cancel:request-beta",
        detail: expect.objectContaining({
          action: "cancel",
          source: "target_disappearance",
          text: "Canceled target no longer visible: Request Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer cancel confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Active requests Request Alpha Cancel Request Alpha",
      pageContent: "Active requests Request Alpha Cancel Request Alpha",
      elements: [actionButton(547, "Cancel Request Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Active requests Request Alpha Cancel Request Alpha",
      pageContent: "Active requests Request Alpha Cancel Request Alpha",
      elements: [actionButton(547, "Cancel Request Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 547 },
      result: "Clicked element 547.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer cancel confirmation from a generic cancel button", () => {
    const genericCancelButton: TaggedElement = {
      tag: 547,
      tagName: "button",
      role: "button",
      text: "Cancel",
      attributes: {
        id: "cancel",
        "aria-label": "Cancel",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Active requests Request Alpha Cancel",
      pageContent: "Active requests Request Alpha Cancel",
      elements: [genericCancelButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Active requests",
      pageContent: "Active requests",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 547 },
      result: "Clicked element 547.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unlock confirmation from named locked target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Locked accounts Account Alpha Unlock Account Alpha Account Beta Unlock Account Beta",
      pageContent:
        "Locked accounts Account Alpha Unlock Account Alpha Account Beta Unlock Account Beta",
      elements: [
        actionButton(549, "Unlock Account Alpha"),
        actionButton(550, "Unlock Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Locked accounts Account Beta Unlock Account Beta",
      pageContent: "Locked accounts Account Beta Unlock Account Beta",
      elements: [actionButton(550, "Unlock Account Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unlock Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 549 },
      result: "Clicked element 549.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unlocked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unlock",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unlock:account-alpha",
        detail: expect.objectContaining({
          action: "unlock",
          source: "target_disappearance",
          text: "Unlocked target no longer visible: Account Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unlock target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Locked accounts Account Alpha Unlock Account Alpha Account Beta Unlock Account Beta",
      pageContent:
        "Locked accounts Account Alpha Unlock Account Alpha Account Beta Unlock Account Beta",
      elements: [
        actionButton(549, "Unlock Account Alpha"),
        actionButton(550, "Unlock Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Locked accounts Account Alpha Unlock Account Alpha",
      pageContent: "Locked accounts Account Alpha Unlock Account Alpha",
      elements: [actionButton(549, "Unlock Account Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unlock Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 550 },
      result: "Clicked element 550.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unlocked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unlock",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unlock:account-beta",
        detail: expect.objectContaining({
          action: "unlock",
          source: "target_disappearance",
          text: "Unlocked target no longer visible: Account Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unlock confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Locked accounts Account Alpha Unlock Account Alpha",
      pageContent: "Locked accounts Account Alpha Unlock Account Alpha",
      elements: [actionButton(549, "Unlock Account Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Locked accounts Account Alpha Unlock Account Alpha",
      pageContent: "Locked accounts Account Alpha Unlock Account Alpha",
      elements: [actionButton(549, "Unlock Account Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 549 },
      result: "Clicked element 549.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unlock confirmation from a generic unlock button", () => {
    const genericUnlockButton: TaggedElement = {
      tag: 549,
      tagName: "button",
      role: "button",
      text: "Unlock",
      attributes: {
        id: "unlock",
        "aria-label": "Unlock",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Locked accounts Account Alpha Unlock",
      pageContent: "Locked accounts Account Alpha Unlock",
      elements: [genericUnlockButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Locked accounts",
      pageContent: "Locked accounts",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 549 },
      result: "Clicked element 549.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts lock confirmation from named unlocked target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unlocked accounts Account Alpha Lock Account Alpha Account Beta Lock Account Beta",
      pageContent:
        "Unlocked accounts Account Alpha Lock Account Alpha Account Beta Lock Account Beta",
      elements: [
        actionButton(551, "Lock Account Alpha"),
        actionButton(552, "Lock Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlocked accounts Account Beta Lock Account Beta",
      pageContent: "Unlocked accounts Account Beta Lock Account Beta",
      elements: [actionButton(552, "Lock Account Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Lock Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 551 },
      result: "Clicked element 551.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Locked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "lock",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:lock:account-alpha",
        detail: expect.objectContaining({
          action: "lock",
          source: "target_disappearance",
          text: "Locked target no longer visible: Account Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects lock target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unlocked accounts Account Alpha Lock Account Alpha Account Beta Lock Account Beta",
      pageContent:
        "Unlocked accounts Account Alpha Lock Account Alpha Account Beta Lock Account Beta",
      elements: [
        actionButton(551, "Lock Account Alpha"),
        actionButton(552, "Lock Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlocked accounts Account Alpha Lock Account Alpha",
      pageContent: "Unlocked accounts Account Alpha Lock Account Alpha",
      elements: [actionButton(551, "Lock Account Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Lock Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 552 },
      result: "Clicked element 552.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Locked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "lock",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:lock:account-beta",
        detail: expect.objectContaining({
          action: "lock",
          source: "target_disappearance",
          text: "Locked target no longer visible: Account Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer lock confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unlocked accounts Account Alpha Lock Account Alpha",
      pageContent: "Unlocked accounts Account Alpha Lock Account Alpha",
      elements: [actionButton(551, "Lock Account Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlocked accounts Account Alpha Lock Account Alpha",
      pageContent: "Unlocked accounts Account Alpha Lock Account Alpha",
      elements: [actionButton(551, "Lock Account Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 551 },
      result: "Clicked element 551.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer lock confirmation from a generic lock button", () => {
    const genericLockButton: TaggedElement = {
      tag: 551,
      tagName: "button",
      role: "button",
      text: "Lock",
      attributes: {
        id: "lock",
        "aria-label": "Lock",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unlocked accounts Account Alpha Lock",
      pageContent: "Unlocked accounts Account Alpha Lock",
      elements: [genericLockButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlocked accounts",
      pageContent: "Unlocked accounts",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 551 },
      result: "Clicked element 551.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts enable confirmation from named disabled target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Disabled features Feature Alpha Enable Feature Alpha Feature Beta Enable Feature Beta",
      pageContent:
        "Disabled features Feature Alpha Enable Feature Alpha Feature Beta Enable Feature Beta",
      elements: [
        actionButton(553, "Enable Feature Alpha"),
        actionButton(554, "Enable Feature Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Disabled features Feature Beta Enable Feature Beta",
      pageContent: "Disabled features Feature Beta Enable Feature Beta",
      elements: [actionButton(554, "Enable Feature Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Enable Feature Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 553 },
      result: "Clicked element 553.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Enabled Feature Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
      targetLabel: "Feature Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:enable:feature-alpha",
        detail: expect.objectContaining({
          action: "enable",
          source: "target_disappearance",
          text: "Enabled target no longer visible: Feature Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects enable target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Disabled features Feature Alpha Enable Feature Alpha Feature Beta Enable Feature Beta",
      pageContent:
        "Disabled features Feature Alpha Enable Feature Alpha Feature Beta Enable Feature Beta",
      elements: [
        actionButton(553, "Enable Feature Alpha"),
        actionButton(554, "Enable Feature Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Disabled features Feature Alpha Enable Feature Alpha",
      pageContent: "Disabled features Feature Alpha Enable Feature Alpha",
      elements: [actionButton(553, "Enable Feature Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Enable Feature Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 554 },
      result: "Clicked element 554.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Enabled Feature Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
      targetLabel: "Feature Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:enable:feature-beta",
        detail: expect.objectContaining({
          action: "enable",
          source: "target_disappearance",
          text: "Enabled target no longer visible: Feature Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer enable confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Disabled features Feature Alpha Enable Feature Alpha",
      pageContent: "Disabled features Feature Alpha Enable Feature Alpha",
      elements: [actionButton(553, "Enable Feature Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Disabled features Feature Alpha Enable Feature Alpha",
      pageContent: "Disabled features Feature Alpha Enable Feature Alpha",
      elements: [actionButton(553, "Enable Feature Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 553 },
      result: "Clicked element 553.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer enable confirmation from a generic enable button", () => {
    const genericEnableButton: TaggedElement = {
      tag: 553,
      tagName: "button",
      role: "button",
      text: "Enable",
      attributes: {
        id: "enable",
        "aria-label": "Enable",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Disabled features Feature Alpha Enable",
      pageContent: "Disabled features Feature Alpha Enable",
      elements: [genericEnableButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Disabled features",
      pageContent: "Disabled features",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 553 },
      result: "Clicked element 553.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts disable confirmation from named enabled target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Enabled features Feature Alpha Disable Feature Alpha Feature Beta Disable Feature Beta",
      pageContent:
        "Enabled features Feature Alpha Disable Feature Alpha Feature Beta Disable Feature Beta",
      elements: [
        actionButton(553, "Disable Feature Alpha"),
        actionButton(554, "Disable Feature Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Enabled features Feature Beta Disable Feature Beta",
      pageContent: "Enabled features Feature Beta Disable Feature Beta",
      elements: [actionButton(554, "Disable Feature Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Disable Feature Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 553 },
      result: "Clicked element 553.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Disabled Feature Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "disable",
      targetLabel: "Feature Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:disable:feature-alpha",
        detail: expect.objectContaining({
          action: "disable",
          source: "target_disappearance",
          text: "Disabled target no longer visible: Feature Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects disable target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Enabled features Feature Alpha Disable Feature Alpha Feature Beta Disable Feature Beta",
      pageContent:
        "Enabled features Feature Alpha Disable Feature Alpha Feature Beta Disable Feature Beta",
      elements: [
        actionButton(553, "Disable Feature Alpha"),
        actionButton(554, "Disable Feature Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Enabled features Feature Alpha Disable Feature Alpha",
      pageContent: "Enabled features Feature Alpha Disable Feature Alpha",
      elements: [actionButton(553, "Disable Feature Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Disable Feature Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 554 },
      result: "Clicked element 554.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Disabled Feature Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "disable",
      targetLabel: "Feature Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:disable:feature-beta",
        detail: expect.objectContaining({
          action: "disable",
          source: "target_disappearance",
          text: "Disabled target no longer visible: Feature Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer disable confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Enabled features Feature Alpha Disable Feature Alpha",
      pageContent: "Enabled features Feature Alpha Disable Feature Alpha",
      elements: [actionButton(553, "Disable Feature Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Enabled features Feature Alpha Disable Feature Alpha",
      pageContent: "Enabled features Feature Alpha Disable Feature Alpha",
      elements: [actionButton(553, "Disable Feature Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 553 },
      result: "Clicked element 553.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer disable confirmation from a generic disable button", () => {
    const genericDisableButton: TaggedElement = {
      tag: 553,
      tagName: "button",
      role: "button",
      text: "Disable",
      attributes: {
        id: "disable",
        "aria-label": "Disable",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Enabled features Feature Alpha Disable",
      pageContent: "Enabled features Feature Alpha Disable",
      elements: [genericDisableButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Enabled features",
      pageContent: "Enabled features",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 553 },
      result: "Clicked element 553.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts pause confirmation from named running target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Running jobs Job Alpha Pause Job Alpha Job Beta Pause Job Beta",
      pageContent:
        "Running jobs Job Alpha Pause Job Alpha Job Beta Pause Job Beta",
      elements: [
        actionButton(555, "Pause Job Alpha"),
        actionButton(556, "Pause Job Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Running jobs Job Beta Pause Job Beta",
      pageContent: "Running jobs Job Beta Pause Job Beta",
      elements: [actionButton(556, "Pause Job Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Pause Job Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 555 },
      result: "Clicked element 555.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Paused Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "pause",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:pause:job-alpha",
        detail: expect.objectContaining({
          action: "pause",
          source: "target_disappearance",
          text: "Paused target no longer visible: Job Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects pause target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Running jobs Job Alpha Pause Job Alpha Job Beta Pause Job Beta",
      pageContent:
        "Running jobs Job Alpha Pause Job Alpha Job Beta Pause Job Beta",
      elements: [
        actionButton(555, "Pause Job Alpha"),
        actionButton(556, "Pause Job Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Running jobs Job Alpha Pause Job Alpha",
      pageContent: "Running jobs Job Alpha Pause Job Alpha",
      elements: [actionButton(555, "Pause Job Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Pause Job Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 556 },
      result: "Clicked element 556.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Paused Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "pause",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:pause:job-beta",
        detail: expect.objectContaining({
          action: "pause",
          source: "target_disappearance",
          text: "Paused target no longer visible: Job Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer pause confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Running jobs Job Alpha Pause Job Alpha",
      pageContent: "Running jobs Job Alpha Pause Job Alpha",
      elements: [actionButton(555, "Pause Job Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Running jobs Job Alpha Pause Job Alpha",
      pageContent: "Running jobs Job Alpha Pause Job Alpha",
      elements: [actionButton(555, "Pause Job Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 555 },
      result: "Clicked element 555.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer pause confirmation from a generic pause button", () => {
    const genericPauseButton: TaggedElement = {
      tag: 555,
      tagName: "button",
      role: "button",
      text: "Pause",
      attributes: {
        id: "pause",
        "aria-label": "Pause",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Running jobs Job Alpha Pause",
      pageContent: "Running jobs Job Alpha Pause",
      elements: [genericPauseButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Running jobs",
      pageContent: "Running jobs",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 555 },
      result: "Clicked element 555.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts resume confirmation from named paused target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Paused jobs Job Alpha Resume Job Alpha Job Beta Resume Job Beta",
      pageContent:
        "Paused jobs Job Alpha Resume Job Alpha Job Beta Resume Job Beta",
      elements: [
        actionButton(557, "Resume Job Alpha"),
        actionButton(558, "Resume Job Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Paused jobs Job Beta Resume Job Beta",
      pageContent: "Paused jobs Job Beta Resume Job Beta",
      elements: [actionButton(558, "Resume Job Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Resume Job Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 557 },
      result: "Clicked element 557.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Resumed Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "resume",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:resume:job-alpha",
        detail: expect.objectContaining({
          action: "resume",
          source: "target_disappearance",
          text: "Resumed target no longer visible: Job Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects resume target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Paused jobs Job Alpha Resume Job Alpha Job Beta Resume Job Beta",
      pageContent:
        "Paused jobs Job Alpha Resume Job Alpha Job Beta Resume Job Beta",
      elements: [
        actionButton(557, "Resume Job Alpha"),
        actionButton(558, "Resume Job Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Paused jobs Job Alpha Resume Job Alpha",
      pageContent: "Paused jobs Job Alpha Resume Job Alpha",
      elements: [actionButton(557, "Resume Job Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Resume Job Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 558 },
      result: "Clicked element 558.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Resumed Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "resume",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:resume:job-beta",
        detail: expect.objectContaining({
          action: "resume",
          source: "target_disappearance",
          text: "Resumed target no longer visible: Job Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer resume confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Paused jobs Job Alpha Resume Job Alpha",
      pageContent: "Paused jobs Job Alpha Resume Job Alpha",
      elements: [actionButton(557, "Resume Job Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Paused jobs Job Alpha Resume Job Alpha",
      pageContent: "Paused jobs Job Alpha Resume Job Alpha",
      elements: [actionButton(557, "Resume Job Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 557 },
      result: "Clicked element 557.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer resume confirmation from a generic resume button", () => {
    const genericResumeButton: TaggedElement = {
      tag: 557,
      tagName: "button",
      role: "button",
      text: "Resume",
      attributes: {
        id: "resume",
        "aria-label": "Resume",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Paused jobs Job Alpha Resume",
      pageContent: "Paused jobs Job Alpha Resume",
      elements: [genericResumeButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Paused jobs",
      pageContent: "Paused jobs",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 557 },
      result: "Clicked element 557.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts start confirmation from named stopped target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Stopped jobs Job Alpha Start Job Alpha Job Beta Start Job Beta",
      pageContent:
        "Stopped jobs Job Alpha Start Job Alpha Job Beta Start Job Beta",
      elements: [
        actionButton(559, "Start Job Alpha"),
        actionButton(560, "Start Job Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Stopped jobs Job Beta Start Job Beta",
      pageContent: "Stopped jobs Job Beta Start Job Beta",
      elements: [actionButton(560, "Start Job Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Start Job Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 559 },
      result: "Clicked element 559.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Started Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "start",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:start:job-alpha",
        detail: expect.objectContaining({
          action: "start",
          source: "target_disappearance",
          text: "Started target no longer visible: Job Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects start target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Stopped jobs Job Alpha Start Job Alpha Job Beta Start Job Beta",
      pageContent:
        "Stopped jobs Job Alpha Start Job Alpha Job Beta Start Job Beta",
      elements: [
        actionButton(559, "Start Job Alpha"),
        actionButton(560, "Start Job Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Stopped jobs Job Alpha Start Job Alpha",
      pageContent: "Stopped jobs Job Alpha Start Job Alpha",
      elements: [actionButton(559, "Start Job Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Start Job Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 560 },
      result: "Clicked element 560.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Started Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "start",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:start:job-beta",
        detail: expect.objectContaining({
          action: "start",
          source: "target_disappearance",
          text: "Started target no longer visible: Job Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer start confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Stopped jobs Job Alpha Start Job Alpha",
      pageContent: "Stopped jobs Job Alpha Start Job Alpha",
      elements: [actionButton(559, "Start Job Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Stopped jobs Job Alpha Start Job Alpha",
      pageContent: "Stopped jobs Job Alpha Start Job Alpha",
      elements: [actionButton(559, "Start Job Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 559 },
      result: "Clicked element 559.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer start confirmation from a generic start button", () => {
    const genericStartButton: TaggedElement = {
      tag: 559,
      tagName: "button",
      role: "button",
      text: "Start",
      attributes: {
        id: "start",
        "aria-label": "Start",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Stopped jobs Job Alpha Start",
      pageContent: "Stopped jobs Job Alpha Start",
      elements: [genericStartButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Stopped jobs",
      pageContent: "Stopped jobs",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 559 },
      result: "Clicked element 559.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts stop confirmation from named running target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Running jobs Job Alpha Stop Job Alpha Job Beta Stop Job Beta",
      pageContent:
        "Running jobs Job Alpha Stop Job Alpha Job Beta Stop Job Beta",
      elements: [
        actionButton(561, "Stop Job Alpha"),
        actionButton(562, "Stop Job Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Running jobs Job Beta Stop Job Beta",
      pageContent: "Running jobs Job Beta Stop Job Beta",
      elements: [actionButton(562, "Stop Job Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Stop Job Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 561 },
      result: "Clicked element 561.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Stopped Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "stop",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:stop:job-alpha",
        detail: expect.objectContaining({
          action: "stop",
          source: "target_disappearance",
          text: "Stopped target no longer visible: Job Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects stop target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Running jobs Job Alpha Stop Job Alpha Job Beta Stop Job Beta",
      pageContent:
        "Running jobs Job Alpha Stop Job Alpha Job Beta Stop Job Beta",
      elements: [
        actionButton(561, "Stop Job Alpha"),
        actionButton(562, "Stop Job Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Running jobs Job Alpha Stop Job Alpha",
      pageContent: "Running jobs Job Alpha Stop Job Alpha",
      elements: [actionButton(561, "Stop Job Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Stop Job Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 562 },
      result: "Clicked element 562.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Stopped Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "stop",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:stop:job-beta",
        detail: expect.objectContaining({
          action: "stop",
          source: "target_disappearance",
          text: "Stopped target no longer visible: Job Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer stop confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Running jobs Job Alpha Stop Job Alpha",
      pageContent: "Running jobs Job Alpha Stop Job Alpha",
      elements: [actionButton(561, "Stop Job Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Running jobs Job Alpha Stop Job Alpha",
      pageContent: "Running jobs Job Alpha Stop Job Alpha",
      elements: [actionButton(561, "Stop Job Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 561 },
      result: "Clicked element 561.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer stop confirmation from a generic stop button", () => {
    const genericStopButton: TaggedElement = {
      tag: 561,
      tagName: "button",
      role: "button",
      text: "Stop",
      attributes: {
        id: "stop",
        "aria-label": "Stop",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Running jobs Job Alpha Stop",
      pageContent: "Running jobs Job Alpha Stop",
      elements: [genericStopButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Running jobs",
      pageContent: "Running jobs",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 561 },
      result: "Clicked element 561.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts assign confirmation from named unassigned target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unassigned tickets Ticket Alpha Assign Ticket Alpha Ticket Beta Assign Ticket Beta",
      pageContent:
        "Unassigned tickets Ticket Alpha Assign Ticket Alpha Ticket Beta Assign Ticket Beta",
      elements: [
        actionButton(563, "Assign Ticket Alpha"),
        actionButton(564, "Assign Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unassigned tickets Ticket Beta Assign Ticket Beta",
      pageContent: "Unassigned tickets Ticket Beta Assign Ticket Beta",
      elements: [actionButton(564, "Assign Ticket Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Assign Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 563 },
      result: "Clicked element 563.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Assigned Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "assign",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:assign:ticket-alpha",
        detail: expect.objectContaining({
          action: "assign",
          source: "target_disappearance",
          text: "Assigned target no longer visible: Ticket Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects assign target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unassigned tickets Ticket Alpha Assign Ticket Alpha Ticket Beta Assign Ticket Beta",
      pageContent:
        "Unassigned tickets Ticket Alpha Assign Ticket Alpha Ticket Beta Assign Ticket Beta",
      elements: [
        actionButton(563, "Assign Ticket Alpha"),
        actionButton(564, "Assign Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unassigned tickets Ticket Alpha Assign Ticket Alpha",
      pageContent: "Unassigned tickets Ticket Alpha Assign Ticket Alpha",
      elements: [actionButton(563, "Assign Ticket Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Assign Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 564 },
      result: "Clicked element 564.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Assigned Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "assign",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:assign:ticket-beta",
        detail: expect.objectContaining({
          action: "assign",
          source: "target_disappearance",
          text: "Assigned target no longer visible: Ticket Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer assign confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unassigned tickets Ticket Alpha Assign Ticket Alpha",
      pageContent: "Unassigned tickets Ticket Alpha Assign Ticket Alpha",
      elements: [actionButton(563, "Assign Ticket Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unassigned tickets Ticket Alpha Assign Ticket Alpha",
      pageContent: "Unassigned tickets Ticket Alpha Assign Ticket Alpha",
      elements: [actionButton(563, "Assign Ticket Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 563 },
      result: "Clicked element 563.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer assign confirmation from a generic assign button", () => {
    const genericAssignButton: TaggedElement = {
      tag: 563,
      tagName: "button",
      role: "button",
      text: "Assign",
      attributes: {
        id: "assign",
        "aria-label": "Assign",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unassigned tickets Ticket Alpha Assign",
      pageContent: "Unassigned tickets Ticket Alpha Assign",
      elements: [genericAssignButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unassigned tickets",
      pageContent: "Unassigned tickets",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 563 },
      result: "Clicked element 563.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts schedule confirmation from named unscheduled target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unscheduled reports Report Alpha Schedule Report Alpha Report Beta Schedule Report Beta",
      pageContent:
        "Unscheduled reports Report Alpha Schedule Report Alpha Report Beta Schedule Report Beta",
      elements: [
        actionButton(565, "Schedule Report Alpha"),
        actionButton(566, "Schedule Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unscheduled reports Report Beta Schedule Report Beta",
      pageContent: "Unscheduled reports Report Beta Schedule Report Beta",
      elements: [actionButton(566, "Schedule Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Schedule Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 565 },
      result: "Clicked element 565.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Scheduled Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "schedule",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:schedule:report-alpha",
        detail: expect.objectContaining({
          action: "schedule",
          source: "target_disappearance",
          text: "Scheduled target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects schedule target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unscheduled reports Report Alpha Schedule Report Alpha Report Beta Schedule Report Beta",
      pageContent:
        "Unscheduled reports Report Alpha Schedule Report Alpha Report Beta Schedule Report Beta",
      elements: [
        actionButton(565, "Schedule Report Alpha"),
        actionButton(566, "Schedule Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unscheduled reports Report Alpha Schedule Report Alpha",
      pageContent: "Unscheduled reports Report Alpha Schedule Report Alpha",
      elements: [actionButton(565, "Schedule Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Schedule Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 566 },
      result: "Clicked element 566.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Scheduled Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "schedule",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:schedule:report-beta",
        detail: expect.objectContaining({
          action: "schedule",
          source: "target_disappearance",
          text: "Scheduled target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer schedule confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unscheduled reports Report Alpha Schedule Report Alpha",
      pageContent: "Unscheduled reports Report Alpha Schedule Report Alpha",
      elements: [actionButton(565, "Schedule Report Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unscheduled reports Report Alpha Schedule Report Alpha",
      pageContent: "Unscheduled reports Report Alpha Schedule Report Alpha",
      elements: [actionButton(565, "Schedule Report Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 565 },
      result: "Clicked element 565.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer schedule confirmation from a generic schedule button", () => {
    const genericScheduleButton: TaggedElement = {
      tag: 565,
      tagName: "button",
      role: "button",
      text: "Schedule",
      attributes: {
        id: "schedule",
        "aria-label": "Schedule",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unscheduled reports Report Alpha Schedule",
      pageContent: "Unscheduled reports Report Alpha Schedule",
      elements: [genericScheduleButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unscheduled reports",
      pageContent: "Unscheduled reports",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 565 },
      result: "Clicked element 565.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts revoke confirmation from named role disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Roles Role Alpha Revoke Role Alpha Role Beta Revoke Role Beta",
      pageContent:
        "Roles Role Alpha Revoke Role Alpha Role Beta Revoke Role Beta",
      elements: [
        actionButton(511, "Revoke Role Alpha"),
        actionButton(512, "Revoke Role Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Roles Role Beta Revoke Role Beta",
      pageContent: "Roles Role Beta Revoke Role Beta",
      elements: [actionButton(512, "Revoke Role Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Revoke Role Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 511 },
      result: "Clicked element 511.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Revoked Role Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "revoke",
      targetLabel: "Role Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:revoke:role-alpha",
        detail: expect.objectContaining({
          action: "revoke",
          source: "target_disappearance",
          text: "Revoked target no longer visible: Role Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects revoke target-disappearance evidence for the wrong requested role", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Roles Role Alpha Revoke Role Alpha Role Beta Revoke Role Beta",
      pageContent:
        "Roles Role Alpha Revoke Role Alpha Role Beta Revoke Role Beta",
      elements: [
        actionButton(511, "Revoke Role Alpha"),
        actionButton(512, "Revoke Role Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Roles Role Alpha Revoke Role Alpha",
      pageContent: "Roles Role Alpha Revoke Role Alpha",
      elements: [actionButton(511, "Revoke Role Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Revoke Role Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 512 },
      result: "Clicked element 512.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Revoked Role Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "revoke",
      targetLabel: "Role Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:revoke:role-beta",
        detail: expect.objectContaining({
          action: "revoke",
          source: "target_disappearance",
          text: "Revoked target no longer visible: Role Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer revoke confirmation while the named role remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Roles Role Alpha Revoke Role Alpha",
      pageContent: "Roles Role Alpha Revoke Role Alpha",
      elements: [actionButton(511, "Revoke Role Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Roles Role Alpha Revoke Role Alpha",
      pageContent: "Roles Role Alpha Revoke Role Alpha",
      elements: [actionButton(511, "Revoke Role Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 511 },
      result: "Clicked element 511.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer revoke confirmation from a generic revoke button", () => {
    const genericRevokeButton: TaggedElement = {
      tag: 511,
      tagName: "button",
      role: "button",
      text: "Revoke",
      attributes: {
        id: "revoke",
        "aria-label": "Revoke",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Roles Role Alpha Revoke",
      pageContent: "Roles Role Alpha Revoke",
      elements: [genericRevokeButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Roles",
      pageContent: "Roles",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 511 },
      result: "Clicked element 511.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts block confirmation from named allowed target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Allowed users User Alpha Block User Alpha User Beta Block User Beta",
      pageContent:
        "Allowed users User Alpha Block User Alpha User Beta Block User Beta",
      elements: [
        actionButton(521, "Block User Alpha"),
        actionButton(522, "Block User Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Allowed users User Beta Block User Beta",
      pageContent: "Allowed users User Beta Block User Beta",
      elements: [actionButton(522, "Block User Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Block User Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 521 },
      result: "Clicked element 521.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Blocked User Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "block",
      targetLabel: "User Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:block:user-alpha",
        detail: expect.objectContaining({
          action: "block",
          source: "target_disappearance",
          text: "Blocked target no longer visible: User Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects block target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Allowed users User Alpha Block User Alpha User Beta Block User Beta",
      pageContent:
        "Allowed users User Alpha Block User Alpha User Beta Block User Beta",
      elements: [
        actionButton(521, "Block User Alpha"),
        actionButton(522, "Block User Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Allowed users User Alpha Block User Alpha",
      pageContent: "Allowed users User Alpha Block User Alpha",
      elements: [actionButton(521, "Block User Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Block User Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 522 },
      result: "Clicked element 522.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Blocked User Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "block",
      targetLabel: "User Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:block:user-beta",
        detail: expect.objectContaining({
          action: "block",
          source: "target_disappearance",
          text: "Blocked target no longer visible: User Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer block confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Allowed users User Alpha Block User Alpha",
      pageContent: "Allowed users User Alpha Block User Alpha",
      elements: [actionButton(521, "Block User Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Allowed users User Alpha Block User Alpha",
      pageContent: "Allowed users User Alpha Block User Alpha",
      elements: [actionButton(521, "Block User Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 521 },
      result: "Clicked element 521.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer block confirmation from a generic block button", () => {
    const genericBlockButton: TaggedElement = {
      tag: 521,
      tagName: "button",
      role: "button",
      text: "Block",
      attributes: {
        id: "block",
        "aria-label": "Block",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Allowed users User Alpha Block",
      pageContent: "Allowed users User Alpha Block",
      elements: [genericBlockButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Allowed users",
      pageContent: "Allowed users",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 521 },
      result: "Clicked element 521.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unblock confirmation from named blocklist target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Blocked users User Alpha Unblock User Alpha User Beta Unblock User Beta",
      pageContent:
        "Blocked users User Alpha Unblock User Alpha User Beta Unblock User Beta",
      elements: [
        actionButton(513, "Unblock User Alpha"),
        actionButton(514, "Unblock User Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Blocked users User Beta Unblock User Beta",
      pageContent: "Blocked users User Beta Unblock User Beta",
      elements: [actionButton(514, "Unblock User Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unblock User Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 513 },
      result: "Clicked element 513.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unblocked User Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unblock",
      targetLabel: "User Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unblock:user-alpha",
        detail: expect.objectContaining({
          action: "unblock",
          source: "target_disappearance",
          text: "Unblocked target no longer visible: User Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unblock target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Blocked users User Alpha Unblock User Alpha User Beta Unblock User Beta",
      pageContent:
        "Blocked users User Alpha Unblock User Alpha User Beta Unblock User Beta",
      elements: [
        actionButton(513, "Unblock User Alpha"),
        actionButton(514, "Unblock User Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Blocked users User Alpha Unblock User Alpha",
      pageContent: "Blocked users User Alpha Unblock User Alpha",
      elements: [actionButton(513, "Unblock User Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unblock User Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 514 },
      result: "Clicked element 514.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unblocked User Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unblock",
      targetLabel: "User Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unblock:user-beta",
        detail: expect.objectContaining({
          action: "unblock",
          source: "target_disappearance",
          text: "Unblocked target no longer visible: User Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unblock confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Blocked users User Alpha Unblock User Alpha",
      pageContent: "Blocked users User Alpha Unblock User Alpha",
      elements: [actionButton(513, "Unblock User Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Blocked users User Alpha Unblock User Alpha",
      pageContent: "Blocked users User Alpha Unblock User Alpha",
      elements: [actionButton(513, "Unblock User Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 513 },
      result: "Clicked element 513.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unblock confirmation from a generic unblock button", () => {
    const genericUnblockButton: TaggedElement = {
      tag: 513,
      tagName: "button",
      role: "button",
      text: "Unblock",
      attributes: {
        id: "unblock",
        "aria-label": "Unblock",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Blocked users User Alpha Unblock",
      pageContent: "Blocked users User Alpha Unblock",
      elements: [genericUnblockButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Blocked users",
      pageContent: "Blocked users",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 513 },
      result: "Clicked element 513.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts suspend confirmation from named active target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Active accounts Account Alpha Suspend Account Alpha Account Beta Suspend Account Beta",
      pageContent:
        "Active accounts Account Alpha Suspend Account Alpha Account Beta Suspend Account Beta",
      elements: [
        actionButton(519, "Suspend Account Alpha"),
        actionButton(520, "Suspend Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Active accounts Account Beta Suspend Account Beta",
      pageContent: "Active accounts Account Beta Suspend Account Beta",
      elements: [actionButton(520, "Suspend Account Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Suspend Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 519 },
      result: "Clicked element 519.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Suspended Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "suspend",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:suspend:account-alpha",
        detail: expect.objectContaining({
          action: "suspend",
          source: "target_disappearance",
          text: "Suspended target no longer visible: Account Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects suspend target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Active accounts Account Alpha Suspend Account Alpha Account Beta Suspend Account Beta",
      pageContent:
        "Active accounts Account Alpha Suspend Account Alpha Account Beta Suspend Account Beta",
      elements: [
        actionButton(519, "Suspend Account Alpha"),
        actionButton(520, "Suspend Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Active accounts Account Alpha Suspend Account Alpha",
      pageContent: "Active accounts Account Alpha Suspend Account Alpha",
      elements: [actionButton(519, "Suspend Account Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Suspend Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 520 },
      result: "Clicked element 520.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Suspended Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "suspend",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:suspend:account-beta",
        detail: expect.objectContaining({
          action: "suspend",
          source: "target_disappearance",
          text: "Suspended target no longer visible: Account Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer suspend confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Active accounts Account Alpha Suspend Account Alpha",
      pageContent: "Active accounts Account Alpha Suspend Account Alpha",
      elements: [actionButton(519, "Suspend Account Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Active accounts Account Alpha Suspend Account Alpha",
      pageContent: "Active accounts Account Alpha Suspend Account Alpha",
      elements: [actionButton(519, "Suspend Account Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 519 },
      result: "Clicked element 519.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer suspend confirmation from a generic suspend button", () => {
    const genericSuspendButton: TaggedElement = {
      tag: 519,
      tagName: "button",
      role: "button",
      text: "Suspend",
      attributes: {
        id: "suspend",
        "aria-label": "Suspend",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Active accounts Account Alpha Suspend",
      pageContent: "Active accounts Account Alpha Suspend",
      elements: [genericSuspendButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Active accounts",
      pageContent: "Active accounts",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 519 },
      result: "Clicked element 519.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unsuspend confirmation from named suspended target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Suspended accounts Account Alpha Unsuspend Account Alpha Account Beta Unsuspend Account Beta",
      pageContent:
        "Suspended accounts Account Alpha Unsuspend Account Alpha Account Beta Unsuspend Account Beta",
      elements: [
        actionButton(515, "Unsuspend Account Alpha"),
        actionButton(516, "Unsuspend Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Suspended accounts Account Beta Unsuspend Account Beta",
      pageContent: "Suspended accounts Account Beta Unsuspend Account Beta",
      elements: [actionButton(516, "Unsuspend Account Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unsuspend Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 515 },
      result: "Clicked element 515.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unsuspended Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unsuspend",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unsuspend:account-alpha",
        detail: expect.objectContaining({
          action: "unsuspend",
          source: "target_disappearance",
          text: "Unsuspended target no longer visible: Account Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unsuspend target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Suspended accounts Account Alpha Unsuspend Account Alpha Account Beta Unsuspend Account Beta",
      pageContent:
        "Suspended accounts Account Alpha Unsuspend Account Alpha Account Beta Unsuspend Account Beta",
      elements: [
        actionButton(515, "Unsuspend Account Alpha"),
        actionButton(516, "Unsuspend Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Suspended accounts Account Alpha Unsuspend Account Alpha",
      pageContent: "Suspended accounts Account Alpha Unsuspend Account Alpha",
      elements: [actionButton(515, "Unsuspend Account Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unsuspend Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 516 },
      result: "Clicked element 516.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unsuspended Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unsuspend",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unsuspend:account-beta",
        detail: expect.objectContaining({
          action: "unsuspend",
          source: "target_disappearance",
          text: "Unsuspended target no longer visible: Account Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unsuspend confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Suspended accounts Account Alpha Unsuspend Account Alpha",
      pageContent: "Suspended accounts Account Alpha Unsuspend Account Alpha",
      elements: [actionButton(515, "Unsuspend Account Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Suspended accounts Account Alpha Unsuspend Account Alpha",
      pageContent: "Suspended accounts Account Alpha Unsuspend Account Alpha",
      elements: [actionButton(515, "Unsuspend Account Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 515 },
      result: "Clicked element 515.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unsuspend confirmation from a generic unsuspend button", () => {
    const genericUnsuspendButton: TaggedElement = {
      tag: 515,
      tagName: "button",
      role: "button",
      text: "Unsuspend",
      attributes: {
        id: "unsuspend",
        "aria-label": "Unsuspend",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Suspended accounts Account Alpha Unsuspend",
      pageContent: "Suspended accounts Account Alpha Unsuspend",
      elements: [genericUnsuspendButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Suspended accounts",
      pageContent: "Suspended accounts",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 515 },
      result: "Clicked element 515.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts disconnect confirmation from named connection disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Connected integrations Integration Alpha Disconnect Integration Alpha Integration Beta Disconnect Integration Beta",
      pageContent:
        "Connected integrations Integration Alpha Disconnect Integration Alpha Integration Beta Disconnect Integration Beta",
      elements: [
        actionButton(517, "Disconnect Integration Alpha"),
        actionButton(518, "Disconnect Integration Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Connected integrations Integration Beta Disconnect Integration Beta",
      pageContent:
        "Connected integrations Integration Beta Disconnect Integration Beta",
      elements: [actionButton(518, "Disconnect Integration Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Disconnect Integration Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 517 },
      result: "Clicked element 517.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Disconnected Integration Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "disconnect",
      targetLabel: "Integration Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:disconnect:integration-alpha",
        detail: expect.objectContaining({
          action: "disconnect",
          source: "target_disappearance",
          text: "Disconnected target no longer visible: Integration Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects disconnect target-disappearance evidence for the wrong requested connection", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Connected integrations Integration Alpha Disconnect Integration Alpha Integration Beta Disconnect Integration Beta",
      pageContent:
        "Connected integrations Integration Alpha Disconnect Integration Alpha Integration Beta Disconnect Integration Beta",
      elements: [
        actionButton(517, "Disconnect Integration Alpha"),
        actionButton(518, "Disconnect Integration Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Connected integrations Integration Alpha Disconnect Integration Alpha",
      pageContent:
        "Connected integrations Integration Alpha Disconnect Integration Alpha",
      elements: [actionButton(517, "Disconnect Integration Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Disconnect Integration Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 518 },
      result: "Clicked element 518.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Disconnected Integration Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "disconnect",
      targetLabel: "Integration Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:disconnect:integration-beta",
        detail: expect.objectContaining({
          action: "disconnect",
          source: "target_disappearance",
          text: "Disconnected target no longer visible: Integration Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer disconnect confirmation while the named connection remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Connected integrations Integration Alpha Disconnect Integration Alpha",
      pageContent:
        "Connected integrations Integration Alpha Disconnect Integration Alpha",
      elements: [actionButton(517, "Disconnect Integration Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Connected integrations Integration Alpha Disconnect Integration Alpha",
      pageContent:
        "Connected integrations Integration Alpha Disconnect Integration Alpha",
      elements: [actionButton(517, "Disconnect Integration Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 517 },
      result: "Clicked element 517.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer disconnect confirmation from a generic disconnect button", () => {
    const genericDisconnectButton: TaggedElement = {
      tag: 517,
      tagName: "button",
      role: "button",
      text: "Disconnect",
      attributes: {
        id: "disconnect",
        "aria-label": "Disconnect",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Connected integrations Integration Alpha Disconnect",
      pageContent: "Connected integrations Integration Alpha Disconnect",
      elements: [genericDisconnectButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Connected integrations",
      pageContent: "Connected integrations",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 517 },
      result: "Clicked element 517.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts connect confirmation from named connection disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Disconnected integrations Integration Alpha Connect Integration Alpha Integration Beta Connect Integration Beta",
      pageContent:
        "Disconnected integrations Integration Alpha Connect Integration Alpha Integration Beta Connect Integration Beta",
      elements: [
        actionButton(519, "Connect Integration Alpha"),
        actionButton(520, "Connect Integration Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Disconnected integrations Integration Beta Connect Integration Beta",
      pageContent:
        "Disconnected integrations Integration Beta Connect Integration Beta",
      elements: [actionButton(520, "Connect Integration Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Connect Integration Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 519 },
      result: "Clicked element 519.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Connected Integration Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "connect",
      targetLabel: "Integration Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:connect:integration-alpha",
        detail: expect.objectContaining({
          action: "connect",
          source: "target_disappearance",
          text: "Connected target no longer visible: Integration Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects connect target-disappearance evidence for the wrong requested connection", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Disconnected integrations Integration Alpha Connect Integration Alpha Integration Beta Connect Integration Beta",
      pageContent:
        "Disconnected integrations Integration Alpha Connect Integration Alpha Integration Beta Connect Integration Beta",
      elements: [
        actionButton(519, "Connect Integration Alpha"),
        actionButton(520, "Connect Integration Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Disconnected integrations Integration Alpha Connect Integration Alpha",
      pageContent:
        "Disconnected integrations Integration Alpha Connect Integration Alpha",
      elements: [actionButton(519, "Connect Integration Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Connect Integration Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 520 },
      result: "Clicked element 520.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Connected Integration Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "connect",
      targetLabel: "Integration Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:connect:integration-beta",
        detail: expect.objectContaining({
          action: "connect",
          source: "target_disappearance",
          text: "Connected target no longer visible: Integration Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer connect confirmation while the named connection remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Disconnected integrations Integration Alpha Connect Integration Alpha",
      pageContent:
        "Disconnected integrations Integration Alpha Connect Integration Alpha",
      elements: [actionButton(519, "Connect Integration Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Disconnected integrations Integration Alpha Connect Integration Alpha",
      pageContent:
        "Disconnected integrations Integration Alpha Connect Integration Alpha",
      elements: [actionButton(519, "Connect Integration Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 519 },
      result: "Clicked element 519.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer connect confirmation from a generic connect button", () => {
    const genericConnectButton: TaggedElement = {
      tag: 519,
      tagName: "button",
      role: "button",
      text: "Connect",
      attributes: {
        id: "connect",
        "aria-label": "Connect",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Disconnected integrations Integration Alpha Connect",
      pageContent: "Disconnected integrations Integration Alpha Connect",
      elements: [genericConnectButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Disconnected integrations",
      pageContent: "Disconnected integrations",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 519 },
      result: "Clicked element 519.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts sync confirmation from named integration disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending syncs Integration Alpha Sync Integration Alpha Integration Beta Sync Integration Beta",
      pageContent:
        "Pending syncs Integration Alpha Sync Integration Alpha Integration Beta Sync Integration Beta",
      elements: [
        actionButton(521, "Sync Integration Alpha"),
        actionButton(522, "Sync Integration Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending syncs Integration Beta Sync Integration Beta",
      pageContent: "Pending syncs Integration Beta Sync Integration Beta",
      elements: [actionButton(522, "Sync Integration Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Sync Integration Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 521 },
      result: "Clicked element 521.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Synced Integration Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "sync",
      targetLabel: "Integration Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:sync:integration-alpha",
        detail: expect.objectContaining({
          action: "sync",
          source: "target_disappearance",
          text: "Synced target no longer visible: Integration Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects sync target-disappearance evidence for the wrong requested integration", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending syncs Integration Alpha Sync Integration Alpha Integration Beta Sync Integration Beta",
      pageContent:
        "Pending syncs Integration Alpha Sync Integration Alpha Integration Beta Sync Integration Beta",
      elements: [
        actionButton(521, "Sync Integration Alpha"),
        actionButton(522, "Sync Integration Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending syncs Integration Alpha Sync Integration Alpha",
      pageContent: "Pending syncs Integration Alpha Sync Integration Alpha",
      elements: [actionButton(521, "Sync Integration Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Sync Integration Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 522 },
      result: "Clicked element 522.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Synced Integration Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "sync",
      targetLabel: "Integration Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:sync:integration-beta",
        detail: expect.objectContaining({
          action: "sync",
          source: "target_disappearance",
          text: "Synced target no longer visible: Integration Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer sync confirmation while the named integration remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending syncs Integration Alpha Sync Integration Alpha",
      pageContent: "Pending syncs Integration Alpha Sync Integration Alpha",
      elements: [actionButton(521, "Sync Integration Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending syncs Integration Alpha Sync Integration Alpha",
      pageContent: "Pending syncs Integration Alpha Sync Integration Alpha",
      elements: [actionButton(521, "Sync Integration Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 521 },
      result: "Clicked element 521.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer sync confirmation from a generic sync button", () => {
    const genericSyncButton: TaggedElement = {
      tag: 521,
      tagName: "button",
      role: "button",
      text: "Sync",
      attributes: {
        id: "sync",
        "aria-label": "Sync",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending syncs Integration Alpha Sync",
      pageContent: "Pending syncs Integration Alpha Sync",
      elements: [genericSyncButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending syncs",
      pageContent: "Pending syncs",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 521 },
      result: "Clicked element 521.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts transfer confirmation from named case disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending transfers Case Alpha Transfer Case Alpha Case Beta Transfer Case Beta",
      pageContent:
        "Pending transfers Case Alpha Transfer Case Alpha Case Beta Transfer Case Beta",
      elements: [
        actionButton(523, "Transfer Case Alpha"),
        actionButton(524, "Transfer Case Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending transfers Case Beta Transfer Case Beta",
      pageContent: "Pending transfers Case Beta Transfer Case Beta",
      elements: [actionButton(524, "Transfer Case Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Transfer Case Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 523 },
      result: "Clicked element 523.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Transferred Case Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "transfer",
      targetLabel: "Case Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:transfer:case-alpha",
        detail: expect.objectContaining({
          action: "transfer",
          source: "target_disappearance",
          text: "Transferred target no longer visible: Case Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects transfer target-disappearance evidence for the wrong requested case", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending transfers Case Alpha Transfer Case Alpha Case Beta Transfer Case Beta",
      pageContent:
        "Pending transfers Case Alpha Transfer Case Alpha Case Beta Transfer Case Beta",
      elements: [
        actionButton(523, "Transfer Case Alpha"),
        actionButton(524, "Transfer Case Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending transfers Case Alpha Transfer Case Alpha",
      pageContent: "Pending transfers Case Alpha Transfer Case Alpha",
      elements: [actionButton(523, "Transfer Case Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Transfer Case Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 524 },
      result: "Clicked element 524.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Transferred Case Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "transfer",
      targetLabel: "Case Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:transfer:case-beta",
        detail: expect.objectContaining({
          action: "transfer",
          source: "target_disappearance",
          text: "Transferred target no longer visible: Case Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer transfer confirmation while the named case remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending transfers Case Alpha Transfer Case Alpha",
      pageContent: "Pending transfers Case Alpha Transfer Case Alpha",
      elements: [actionButton(523, "Transfer Case Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending transfers Case Alpha Transfer Case Alpha",
      pageContent: "Pending transfers Case Alpha Transfer Case Alpha",
      elements: [actionButton(523, "Transfer Case Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 523 },
      result: "Clicked element 523.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer transfer confirmation from a generic transfer button", () => {
    const genericTransferButton: TaggedElement = {
      tag: 523,
      tagName: "button",
      role: "button",
      text: "Transfer",
      attributes: {
        id: "transfer",
        "aria-label": "Transfer",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending transfers Case Alpha Transfer",
      pageContent: "Pending transfers Case Alpha Transfer",
      elements: [genericTransferButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending transfers",
      pageContent: "Pending transfers",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 523 },
      result: "Clicked element 523.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts move confirmation from named card disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending moves Card Alpha Move Card Alpha Card Beta Move Card Beta",
      pageContent:
        "Pending moves Card Alpha Move Card Alpha Card Beta Move Card Beta",
      elements: [
        actionButton(525, "Move Card Alpha"),
        actionButton(526, "Move Card Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending moves Card Beta Move Card Beta",
      pageContent: "Pending moves Card Beta Move Card Beta",
      elements: [actionButton(526, "Move Card Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Move Card Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 525 },
      result: "Clicked element 525.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Moved Card Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "move",
      targetLabel: "Card Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:move:card-alpha",
        detail: expect.objectContaining({
          action: "move",
          source: "target_disappearance",
          text: "Moved target no longer visible: Card Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects move target-disappearance evidence for the wrong requested card", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending moves Card Alpha Move Card Alpha Card Beta Move Card Beta",
      pageContent:
        "Pending moves Card Alpha Move Card Alpha Card Beta Move Card Beta",
      elements: [
        actionButton(525, "Move Card Alpha"),
        actionButton(526, "Move Card Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending moves Card Alpha Move Card Alpha",
      pageContent: "Pending moves Card Alpha Move Card Alpha",
      elements: [actionButton(525, "Move Card Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Move Card Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 526 },
      result: "Clicked element 526.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Moved Card Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "move",
      targetLabel: "Card Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:move:card-beta",
        detail: expect.objectContaining({
          action: "move",
          source: "target_disappearance",
          text: "Moved target no longer visible: Card Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer move confirmation while the named card remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending moves Card Alpha Move Card Alpha",
      pageContent: "Pending moves Card Alpha Move Card Alpha",
      elements: [actionButton(525, "Move Card Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending moves Card Alpha Move Card Alpha",
      pageContent: "Pending moves Card Alpha Move Card Alpha",
      elements: [actionButton(525, "Move Card Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 525 },
      result: "Clicked element 525.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer move confirmation from a generic move button", () => {
    const genericMoveButton: TaggedElement = {
      tag: 525,
      tagName: "button",
      role: "button",
      text: "Move",
      attributes: {
        id: "move",
        "aria-label": "Move",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending moves Card Alpha Move",
      pageContent: "Pending moves Card Alpha Move",
      elements: [genericMoveButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending moves",
      pageContent: "Pending moves",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 525 },
      result: "Clicked element 525.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts rename confirmation from named page disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending renames Page Alpha Rename Page Alpha Page Beta Rename Page Beta",
      pageContent:
        "Pending renames Page Alpha Rename Page Alpha Page Beta Rename Page Beta",
      elements: [
        actionButton(527, "Rename Page Alpha"),
        actionButton(528, "Rename Page Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending renames Page Beta Rename Page Beta",
      pageContent: "Pending renames Page Beta Rename Page Beta",
      elements: [actionButton(528, "Rename Page Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Rename Page Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 527 },
      result: "Clicked element 527.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Renamed Page Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "rename",
      targetLabel: "Page Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:rename:page-alpha",
        detail: expect.objectContaining({
          action: "rename",
          source: "target_disappearance",
          text: "Renamed target no longer visible: Page Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects rename target-disappearance evidence for the wrong requested page", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending renames Page Alpha Rename Page Alpha Page Beta Rename Page Beta",
      pageContent:
        "Pending renames Page Alpha Rename Page Alpha Page Beta Rename Page Beta",
      elements: [
        actionButton(527, "Rename Page Alpha"),
        actionButton(528, "Rename Page Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending renames Page Alpha Rename Page Alpha",
      pageContent: "Pending renames Page Alpha Rename Page Alpha",
      elements: [actionButton(527, "Rename Page Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Rename Page Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 528 },
      result: "Clicked element 528.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Renamed Page Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "rename",
      targetLabel: "Page Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:rename:page-beta",
        detail: expect.objectContaining({
          action: "rename",
          source: "target_disappearance",
          text: "Renamed target no longer visible: Page Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer rename confirmation while the named page remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending renames Page Alpha Rename Page Alpha",
      pageContent: "Pending renames Page Alpha Rename Page Alpha",
      elements: [actionButton(527, "Rename Page Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending renames Page Alpha Rename Page Alpha",
      pageContent: "Pending renames Page Alpha Rename Page Alpha",
      elements: [actionButton(527, "Rename Page Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 527 },
      result: "Clicked element 527.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer rename confirmation from a generic rename button", () => {
    const genericRenameButton: TaggedElement = {
      tag: 527,
      tagName: "button",
      role: "button",
      text: "Rename",
      attributes: {
        id: "rename",
        "aria-label": "Rename",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending renames Page Alpha Rename",
      pageContent: "Pending renames Page Alpha Rename",
      elements: [genericRenameButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending renames",
      pageContent: "Pending renames",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 527 },
      result: "Clicked element 527.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts merge confirmation from named ticket disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending merges Ticket Alpha Merge Ticket Alpha Ticket Beta Merge Ticket Beta",
      pageContent:
        "Pending merges Ticket Alpha Merge Ticket Alpha Ticket Beta Merge Ticket Beta",
      elements: [
        actionButton(529, "Merge Ticket Alpha"),
        actionButton(530, "Merge Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending merges Ticket Beta Merge Ticket Beta",
      pageContent: "Pending merges Ticket Beta Merge Ticket Beta",
      elements: [actionButton(530, "Merge Ticket Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Merge Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 529 },
      result: "Clicked element 529.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Merged Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "merge",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:merge:ticket-alpha",
        detail: expect.objectContaining({
          action: "merge",
          source: "target_disappearance",
          text: "Merged target no longer visible: Ticket Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects merge target-disappearance evidence for the wrong requested ticket", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending merges Ticket Alpha Merge Ticket Alpha Ticket Beta Merge Ticket Beta",
      pageContent:
        "Pending merges Ticket Alpha Merge Ticket Alpha Ticket Beta Merge Ticket Beta",
      elements: [
        actionButton(529, "Merge Ticket Alpha"),
        actionButton(530, "Merge Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending merges Ticket Alpha Merge Ticket Alpha",
      pageContent: "Pending merges Ticket Alpha Merge Ticket Alpha",
      elements: [actionButton(529, "Merge Ticket Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Merge Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 530 },
      result: "Clicked element 530.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Merged Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "merge",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:merge:ticket-beta",
        detail: expect.objectContaining({
          action: "merge",
          source: "target_disappearance",
          text: "Merged target no longer visible: Ticket Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer merge confirmation while the named ticket remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending merges Ticket Alpha Merge Ticket Alpha",
      pageContent: "Pending merges Ticket Alpha Merge Ticket Alpha",
      elements: [actionButton(529, "Merge Ticket Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending merges Ticket Alpha Merge Ticket Alpha",
      pageContent: "Pending merges Ticket Alpha Merge Ticket Alpha",
      elements: [actionButton(529, "Merge Ticket Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 529 },
      result: "Clicked element 529.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer merge confirmation from a generic merge button", () => {
    const genericMergeButton: TaggedElement = {
      tag: 529,
      tagName: "button",
      role: "button",
      text: "Merge",
      attributes: {
        id: "merge",
        "aria-label": "Merge",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending merges Ticket Alpha Merge",
      pageContent: "Pending merges Ticket Alpha Merge",
      elements: [genericMergeButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending merges",
      pageContent: "Pending merges",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 529 },
      result: "Clicked element 529.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts rollback confirmation from named release disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending rollbacks Release Alpha Rollback Release Alpha Release Beta Rollback Release Beta",
      pageContent:
        "Pending rollbacks Release Alpha Rollback Release Alpha Release Beta Rollback Release Beta",
      elements: [
        actionButton(531, "Rollback Release Alpha"),
        actionButton(532, "Rollback Release Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rollbacks Release Beta Rollback Release Beta",
      pageContent: "Pending rollbacks Release Beta Rollback Release Beta",
      elements: [actionButton(532, "Rollback Release Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Rollback Release Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 531 },
      result: "Clicked element 531.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Rolled back Release Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "rollback",
      targetLabel: "Release Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:rollback:release-alpha",
        detail: expect.objectContaining({
          action: "rollback",
          source: "target_disappearance",
          text: "Rolled back target no longer visible: Release Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects rollback target-disappearance evidence for the wrong requested release", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending rollbacks Release Alpha Rollback Release Alpha Release Beta Rollback Release Beta",
      pageContent:
        "Pending rollbacks Release Alpha Rollback Release Alpha Release Beta Rollback Release Beta",
      elements: [
        actionButton(531, "Rollback Release Alpha"),
        actionButton(532, "Rollback Release Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rollbacks Release Alpha Rollback Release Alpha",
      pageContent: "Pending rollbacks Release Alpha Rollback Release Alpha",
      elements: [actionButton(531, "Rollback Release Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Rollback Release Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 532 },
      result: "Clicked element 532.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Rolled back Release Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "rollback",
      targetLabel: "Release Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:rollback:release-beta",
        detail: expect.objectContaining({
          action: "rollback",
          source: "target_disappearance",
          text: "Rolled back target no longer visible: Release Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer rollback confirmation while the named release remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending rollbacks Release Alpha Rollback Release Alpha",
      pageContent: "Pending rollbacks Release Alpha Rollback Release Alpha",
      elements: [actionButton(531, "Rollback Release Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rollbacks Release Alpha Rollback Release Alpha",
      pageContent: "Pending rollbacks Release Alpha Rollback Release Alpha",
      elements: [actionButton(531, "Rollback Release Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 531 },
      result: "Clicked element 531.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer rollback confirmation from a generic rollback button", () => {
    const genericRollbackButton: TaggedElement = {
      tag: 531,
      tagName: "button",
      role: "button",
      text: "Rollback",
      attributes: {
        id: "rollback",
        "aria-label": "Rollback",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending rollbacks Release Alpha Rollback",
      pageContent: "Pending rollbacks Release Alpha Rollback",
      elements: [genericRollbackButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rollbacks",
      pageContent: "Pending rollbacks",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 531 },
      result: "Clicked element 531.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts approve confirmation from named request disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending approvals Request Alpha Approve Request Alpha Request Beta Approve Request Beta",
      pageContent:
        "Pending approvals Request Alpha Approve Request Alpha Request Beta Approve Request Beta",
      elements: [
        actionButton(533, "Approve Request Alpha"),
        actionButton(534, "Approve Request Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending approvals Request Beta Approve Request Beta",
      pageContent: "Pending approvals Request Beta Approve Request Beta",
      elements: [actionButton(534, "Approve Request Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Approve Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 533 },
      result: "Clicked element 533.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Approved Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:approve:request-alpha",
        detail: expect.objectContaining({
          action: "approve",
          source: "target_disappearance",
          text: "Approved target no longer visible: Request Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects approve target-disappearance evidence for the wrong requested request", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending approvals Request Alpha Approve Request Alpha Request Beta Approve Request Beta",
      pageContent:
        "Pending approvals Request Alpha Approve Request Alpha Request Beta Approve Request Beta",
      elements: [
        actionButton(533, "Approve Request Alpha"),
        actionButton(534, "Approve Request Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending approvals Request Alpha Approve Request Alpha",
      pageContent: "Pending approvals Request Alpha Approve Request Alpha",
      elements: [actionButton(533, "Approve Request Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Approve Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 534 },
      result: "Clicked element 534.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Approved Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:approve:request-beta",
        detail: expect.objectContaining({
          action: "approve",
          source: "target_disappearance",
          text: "Approved target no longer visible: Request Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer approve confirmation while the named request remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending approvals Request Alpha Approve Request Alpha",
      pageContent: "Pending approvals Request Alpha Approve Request Alpha",
      elements: [actionButton(533, "Approve Request Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending approvals Request Alpha Approve Request Alpha",
      pageContent: "Pending approvals Request Alpha Approve Request Alpha",
      elements: [actionButton(533, "Approve Request Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 533 },
      result: "Clicked element 533.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer approve confirmation from a generic approve button", () => {
    const genericApproveButton: TaggedElement = {
      tag: 533,
      tagName: "button",
      role: "button",
      text: "Approve",
      attributes: {
        id: "approve",
        "aria-label": "Approve",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending approvals Request Alpha Approve",
      pageContent: "Pending approvals Request Alpha Approve",
      elements: [genericApproveButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending approvals",
      pageContent: "Pending approvals",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 533 },
      result: "Clicked element 533.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts reject confirmation from named request disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending rejections Request Alpha Reject Request Alpha Request Beta Reject Request Beta",
      pageContent:
        "Pending rejections Request Alpha Reject Request Alpha Request Beta Reject Request Beta",
      elements: [
        actionButton(535, "Reject Request Alpha"),
        actionButton(536, "Reject Request Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rejections Request Beta Reject Request Beta",
      pageContent: "Pending rejections Request Beta Reject Request Beta",
      elements: [actionButton(536, "Reject Request Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Reject Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 535 },
      result: "Clicked element 535.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Rejected Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reject",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:reject:request-alpha",
        detail: expect.objectContaining({
          action: "reject",
          source: "target_disappearance",
          text: "Rejected target no longer visible: Request Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects reject target-disappearance evidence for the wrong requested request", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending rejections Request Alpha Reject Request Alpha Request Beta Reject Request Beta",
      pageContent:
        "Pending rejections Request Alpha Reject Request Alpha Request Beta Reject Request Beta",
      elements: [
        actionButton(535, "Reject Request Alpha"),
        actionButton(536, "Reject Request Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rejections Request Alpha Reject Request Alpha",
      pageContent: "Pending rejections Request Alpha Reject Request Alpha",
      elements: [actionButton(535, "Reject Request Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Reject Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 536 },
      result: "Clicked element 536.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Rejected Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reject",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:reject:request-beta",
        detail: expect.objectContaining({
          action: "reject",
          source: "target_disappearance",
          text: "Rejected target no longer visible: Request Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer reject confirmation while the named request remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending rejections Request Alpha Reject Request Alpha",
      pageContent: "Pending rejections Request Alpha Reject Request Alpha",
      elements: [actionButton(535, "Reject Request Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rejections Request Alpha Reject Request Alpha",
      pageContent: "Pending rejections Request Alpha Reject Request Alpha",
      elements: [actionButton(535, "Reject Request Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 535 },
      result: "Clicked element 535.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer reject confirmation from a generic reject button", () => {
    const genericRejectButton: TaggedElement = {
      tag: 535,
      tagName: "button",
      role: "button",
      text: "Reject",
      attributes: {
        id: "reject",
        "aria-label": "Reject",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending rejections Request Alpha Reject",
      pageContent: "Pending rejections Request Alpha Reject",
      elements: [genericRejectButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rejections",
      pageContent: "Pending rejections",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 535 },
      result: "Clicked element 535.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts close confirmation from named ticket disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Open tickets Ticket Alpha Close Ticket Alpha Ticket Beta Close Ticket Beta",
      pageContent:
        "Open tickets Ticket Alpha Close Ticket Alpha Ticket Beta Close Ticket Beta",
      elements: [
        actionButton(537, "Close Ticket Alpha"),
        actionButton(538, "Close Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tickets Ticket Beta Close Ticket Beta",
      pageContent: "Open tickets Ticket Beta Close Ticket Beta",
      elements: [actionButton(538, "Close Ticket Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Close Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Closed Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "close",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:close:ticket-alpha",
        detail: expect.objectContaining({
          action: "close",
          source: "target_disappearance",
          text: "Closed target no longer visible: Ticket Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects close target-disappearance evidence for the wrong requested ticket", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Open tickets Ticket Alpha Close Ticket Alpha Ticket Beta Close Ticket Beta",
      pageContent:
        "Open tickets Ticket Alpha Close Ticket Alpha Ticket Beta Close Ticket Beta",
      elements: [
        actionButton(537, "Close Ticket Alpha"),
        actionButton(538, "Close Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tickets Ticket Alpha Close Ticket Alpha",
      pageContent: "Open tickets Ticket Alpha Close Ticket Alpha",
      elements: [actionButton(537, "Close Ticket Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Close Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 538 },
      result: "Clicked element 538.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Closed Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "close",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:close:ticket-beta",
        detail: expect.objectContaining({
          action: "close",
          source: "target_disappearance",
          text: "Closed target no longer visible: Ticket Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer close confirmation while the named ticket remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Open tickets Ticket Alpha Close Ticket Alpha",
      pageContent: "Open tickets Ticket Alpha Close Ticket Alpha",
      elements: [actionButton(537, "Close Ticket Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tickets Ticket Alpha Close Ticket Alpha",
      pageContent: "Open tickets Ticket Alpha Close Ticket Alpha",
      elements: [actionButton(537, "Close Ticket Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer close confirmation from a generic close button", () => {
    const genericCloseButton: TaggedElement = {
      tag: 537,
      tagName: "button",
      role: "button",
      text: "Close",
      attributes: {
        id: "close",
        "aria-label": "Close",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Open tickets Ticket Alpha Close",
      pageContent: "Open tickets Ticket Alpha Close",
      elements: [genericCloseButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tickets",
      pageContent: "Open tickets",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer close workflow confirmation from a generic close dialog control", () => {
    const closeDialogButton: TaggedElement = {
      tag: 537,
      tagName: "button",
      role: "button",
      text: "Close dialog",
      attributes: {
        id: "close-dialog",
        "aria-label": "Close dialog",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Settings dialog Close dialog",
      pageContent: "Settings dialog Close dialog",
      elements: [closeDialogButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Settings",
      pageContent: "Settings",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts reopen confirmation from named ticket disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Closed tickets Ticket Alpha Reopen Ticket Alpha Ticket Beta Reopen Ticket Beta",
      pageContent:
        "Closed tickets Ticket Alpha Reopen Ticket Alpha Ticket Beta Reopen Ticket Beta",
      elements: [
        actionButton(539, "Reopen Ticket Alpha"),
        actionButton(540, "Reopen Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Closed tickets Ticket Beta Reopen Ticket Beta",
      pageContent: "Closed tickets Ticket Beta Reopen Ticket Beta",
      elements: [actionButton(540, "Reopen Ticket Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Reopen Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 539 },
      result: "Clicked element 539.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Reopened Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reopen",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:reopen:ticket-alpha",
        detail: expect.objectContaining({
          action: "reopen",
          source: "target_disappearance",
          text: "Reopened target no longer visible: Ticket Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects reopen target-disappearance evidence for the wrong requested ticket", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Closed tickets Ticket Alpha Reopen Ticket Alpha Ticket Beta Reopen Ticket Beta",
      pageContent:
        "Closed tickets Ticket Alpha Reopen Ticket Alpha Ticket Beta Reopen Ticket Beta",
      elements: [
        actionButton(539, "Reopen Ticket Alpha"),
        actionButton(540, "Reopen Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Closed tickets Ticket Alpha Reopen Ticket Alpha",
      pageContent: "Closed tickets Ticket Alpha Reopen Ticket Alpha",
      elements: [actionButton(539, "Reopen Ticket Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Reopen Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 540 },
      result: "Clicked element 540.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Reopened Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reopen",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:reopen:ticket-beta",
        detail: expect.objectContaining({
          action: "reopen",
          source: "target_disappearance",
          text: "Reopened target no longer visible: Ticket Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer reopen confirmation while the named ticket remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Closed tickets Ticket Alpha Reopen Ticket Alpha",
      pageContent: "Closed tickets Ticket Alpha Reopen Ticket Alpha",
      elements: [actionButton(539, "Reopen Ticket Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Closed tickets Ticket Alpha Reopen Ticket Alpha",
      pageContent: "Closed tickets Ticket Alpha Reopen Ticket Alpha",
      elements: [actionButton(539, "Reopen Ticket Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 539 },
      result: "Clicked element 539.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer reopen confirmation from a generic reopen button", () => {
    const genericReopenButton: TaggedElement = {
      tag: 539,
      tagName: "button",
      role: "button",
      text: "Reopen",
      attributes: {
        id: "reopen",
        "aria-label": "Reopen",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Closed tickets Ticket Alpha Reopen",
      pageContent: "Closed tickets Ticket Alpha Reopen",
      elements: [genericReopenButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Closed tickets",
      pageContent: "Closed tickets",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 539 },
      result: "Clicked element 539.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer reopen confirmation from a generic reopen ticket control", () => {
    const genericReopenTicketButton: TaggedElement = {
      tag: 539,
      tagName: "button",
      role: "button",
      text: "Reopen ticket",
      attributes: {
        id: "reopen-ticket",
        "aria-label": "Reopen ticket",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Closed tickets Ticket Alpha Reopen ticket",
      pageContent: "Closed tickets Ticket Alpha Reopen ticket",
      elements: [genericReopenTicketButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Closed tickets",
      pageContent: "Closed tickets",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 539 },
      result: "Clicked element 539.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts escalate confirmation from named incident disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Open incidents Incident Alpha Escalate Incident Alpha Incident Beta Escalate Incident Beta",
      pageContent:
        "Open incidents Incident Alpha Escalate Incident Alpha Incident Beta Escalate Incident Beta",
      elements: [
        actionButton(541, "Escalate Incident Alpha"),
        actionButton(542, "Escalate Incident Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Open incidents Incident Beta Escalate Incident Beta",
      pageContent: "Open incidents Incident Beta Escalate Incident Beta",
      elements: [actionButton(542, "Escalate Incident Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Escalate Incident Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "escalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:escalate:incident-alpha",
        detail: expect.objectContaining({
          action: "escalate",
          source: "target_disappearance",
          text: "Escalated target no longer visible: Incident Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects escalate target-disappearance evidence for the wrong requested incident", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Open incidents Incident Alpha Escalate Incident Alpha Incident Beta Escalate Incident Beta",
      pageContent:
        "Open incidents Incident Alpha Escalate Incident Alpha Incident Beta Escalate Incident Beta",
      elements: [
        actionButton(541, "Escalate Incident Alpha"),
        actionButton(542, "Escalate Incident Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Open incidents Incident Alpha Escalate Incident Alpha",
      pageContent: "Open incidents Incident Alpha Escalate Incident Alpha",
      elements: [actionButton(541, "Escalate Incident Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Escalate Incident Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 542 },
      result: "Clicked element 542.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "escalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:escalate:incident-beta",
        detail: expect.objectContaining({
          action: "escalate",
          source: "target_disappearance",
          text: "Escalated target no longer visible: Incident Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer escalate confirmation while the named incident remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Open incidents Incident Alpha Escalate Incident Alpha",
      pageContent: "Open incidents Incident Alpha Escalate Incident Alpha",
      elements: [actionButton(541, "Escalate Incident Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Open incidents Incident Alpha Escalate Incident Alpha",
      pageContent: "Open incidents Incident Alpha Escalate Incident Alpha",
      elements: [actionButton(541, "Escalate Incident Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer escalate confirmation from a generic escalate button", () => {
    const genericEscalateButton: TaggedElement = {
      tag: 541,
      tagName: "button",
      role: "button",
      text: "Escalate",
      attributes: {
        id: "escalate",
        "aria-label": "Escalate",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Open incidents Incident Alpha Escalate",
      pageContent: "Open incidents Incident Alpha Escalate",
      elements: [genericEscalateButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Open incidents",
      pageContent: "Open incidents",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer escalate confirmation from a generic escalate incident control", () => {
    const genericEscalateIncidentButton: TaggedElement = {
      tag: 541,
      tagName: "button",
      role: "button",
      text: "Escalate incident",
      attributes: {
        id: "escalate-incident",
        "aria-label": "Escalate incident",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Open incidents Incident Alpha Escalate incident",
      pageContent: "Open incidents Incident Alpha Escalate incident",
      elements: [genericEscalateIncidentButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Open incidents",
      pageContent: "Open incidents",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not accept deescalate disappearance as escalate confirmation", () => {
    const pre = workflowSnapshot({
      visibleContent: "Open incidents Incident Alpha De-escalate Incident Alpha",
      pageContent: "Open incidents Incident Alpha De-escalate Incident Alpha",
      elements: [actionButton(541, "De-escalate Incident Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Open incidents",
      pageContent: "Open incidents",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Escalate Incident Alpha.",
      snapshot: current,
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "escalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:deescalate:incident-alpha",
        detail: expect.objectContaining({
          action: "deescalate",
          source: "target_disappearance",
          text: "De-escalated target no longer visible: Incident Alpha",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "needs_verification",
      reason: "Requested action has no matching visible confirmation evidence yet.",
    });
  });

  test("accepts deescalate confirmation from named incident disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Escalated incidents Incident Alpha De-escalate Incident Alpha Incident Beta De-escalate Incident Beta",
      pageContent:
        "Escalated incidents Incident Alpha De-escalate Incident Alpha Incident Beta De-escalate Incident Beta",
      elements: [
        actionButton(543, "De-escalate Incident Alpha"),
        actionButton(544, "De-escalate Incident Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Escalated incidents Incident Beta De-escalate Incident Beta",
      pageContent:
        "Escalated incidents Incident Beta De-escalate Incident Beta",
      elements: [actionButton(544, "De-escalate Incident Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "De-escalate Incident Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "De-escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "deescalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:deescalate:incident-alpha",
        detail: expect.objectContaining({
          action: "deescalate",
          source: "target_disappearance",
          text: "De-escalated target no longer visible: Incident Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects deescalate target-disappearance evidence for the wrong requested incident", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Escalated incidents Incident Alpha De-escalate Incident Alpha Incident Beta De-escalate Incident Beta",
      pageContent:
        "Escalated incidents Incident Alpha De-escalate Incident Alpha Incident Beta De-escalate Incident Beta",
      elements: [
        actionButton(543, "De-escalate Incident Alpha"),
        actionButton(544, "De-escalate Incident Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Escalated incidents Incident Alpha De-escalate Incident Alpha",
      pageContent:
        "Escalated incidents Incident Alpha De-escalate Incident Alpha",
      elements: [actionButton(543, "De-escalate Incident Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "De-escalate Incident Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 544 },
      result: "Clicked element 544.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "De-escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "deescalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:deescalate:incident-beta",
        detail: expect.objectContaining({
          action: "deescalate",
          source: "target_disappearance",
          text: "De-escalated target no longer visible: Incident Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer deescalate confirmation while the named incident remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Escalated incidents Incident Alpha De-escalate Incident Alpha",
      pageContent: "Escalated incidents Incident Alpha De-escalate Incident Alpha",
      elements: [actionButton(543, "De-escalate Incident Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Escalated incidents Incident Alpha De-escalate Incident Alpha",
      pageContent: "Escalated incidents Incident Alpha De-escalate Incident Alpha",
      elements: [actionButton(543, "De-escalate Incident Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer deescalate confirmation from a generic deescalate button", () => {
    const genericDeescalateButton: TaggedElement = {
      tag: 543,
      tagName: "button",
      role: "button",
      text: "De-escalate",
      attributes: {
        id: "de-escalate",
        "aria-label": "De-escalate",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Escalated incidents Incident Alpha De-escalate",
      pageContent: "Escalated incidents Incident Alpha De-escalate",
      elements: [genericDeescalateButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Escalated incidents",
      pageContent: "Escalated incidents",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer deescalate confirmation from a generic deescalate incident control", () => {
    const genericDeescalateIncidentButton: TaggedElement = {
      tag: 543,
      tagName: "button",
      role: "button",
      text: "De-escalate incident",
      attributes: {
        id: "de-escalate-incident",
        "aria-label": "De-escalate incident",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Escalated incidents Incident Alpha De-escalate incident",
      pageContent: "Escalated incidents Incident Alpha De-escalate incident",
      elements: [genericDeescalateIncidentButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Escalated incidents",
      pageContent: "Escalated incidents",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts complete confirmation from named task disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Open tasks TASK001 Mark TASK001 complete TASK002 Mark TASK002 complete",
      pageContent:
        "Open tasks TASK001 Mark TASK001 complete TASK002 Mark TASK002 complete",
      elements: [
        actionButton(545, "Mark TASK001 complete"),
        actionButton(546, "Mark TASK002 complete"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tasks TASK002 Mark TASK002 complete",
      pageContent: "Open tasks TASK002 Mark TASK002 complete",
      elements: [actionButton(546, "Mark TASK002 complete")],
    });
    const generated = generateCompletionContract({
      userRequest: "Mark TASK001 complete.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
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
      targetLabel: "TASK001",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:complete:task001",
        detail: expect.objectContaining({
          action: "complete",
          source: "target_disappearance",
          text: "Completed target no longer visible: TASK001",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects complete target-disappearance evidence for the wrong requested task", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Open tasks TASK001 Mark TASK001 complete TASK002 Mark TASK002 complete",
      pageContent:
        "Open tasks TASK001 Mark TASK001 complete TASK002 Mark TASK002 complete",
      elements: [
        actionButton(545, "Mark TASK001 complete"),
        actionButton(546, "Mark TASK002 complete"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tasks TASK001 Mark TASK001 complete",
      pageContent: "Open tasks TASK001 Mark TASK001 complete",
      elements: [actionButton(545, "Mark TASK001 complete")],
    });
    const generated = generateCompletionContract({
      userRequest: "Mark TASK001 complete.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 546 },
      result: "Clicked element 546.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
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
      targetLabel: "TASK001",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:complete:task002",
        detail: expect.objectContaining({
          action: "complete",
          source: "target_disappearance",
          text: "Completed target no longer visible: TASK002",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer complete confirmation while the named task remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Open tasks TASK001 Mark TASK001 complete",
      pageContent: "Open tasks TASK001 Mark TASK001 complete",
      elements: [actionButton(545, "Mark TASK001 complete")],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tasks TASK001 Mark TASK001 complete",
      pageContent: "Open tasks TASK001 Mark TASK001 complete",
      elements: [actionButton(545, "Mark TASK001 complete")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer complete confirmation from a generic complete button", () => {
    const genericCompleteButton: TaggedElement = {
      tag: 545,
      tagName: "button",
      role: "button",
      text: "Complete",
      attributes: {
        id: "complete",
        "aria-label": "Complete",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Open tasks TASK001 Complete",
      pageContent: "Open tasks TASK001 Complete",
      elements: [genericCompleteButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tasks",
      pageContent: "Open tasks",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer complete confirmation from a generic complete task control", () => {
    const genericCompleteTaskButton: TaggedElement = {
      tag: 545,
      tagName: "button",
      role: "button",
      text: "Complete task",
      attributes: {
        id: "complete-task",
        "aria-label": "Complete task",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Open tasks TASK001 Complete task",
      pageContent: "Open tasks TASK001 Complete task",
      elements: [genericCompleteTaskButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tasks",
      pageContent: "Open tasks",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts submit confirmation from named request disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Draft requests Request Alpha Submit Request Alpha Request Beta Submit Request Beta",
      pageContent:
        "Draft requests Request Alpha Submit Request Alpha Request Beta Submit Request Beta",
      elements: [
        actionButton(547, "Submit Request Alpha"),
        actionButton(548, "Submit Request Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft requests Request Beta Submit Request Beta",
      pageContent: "Draft requests Request Beta Submit Request Beta",
      elements: [actionButton(548, "Submit Request Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Submit Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 547 },
      result: "Clicked element 547.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Submitted Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "submit",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:submit:request-alpha",
        detail: expect.objectContaining({
          action: "submit",
          source: "target_disappearance",
          text: "Submitted target no longer visible: Request Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects submit target-disappearance evidence for the wrong requested request", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Draft requests Request Alpha Submit Request Alpha Request Beta Submit Request Beta",
      pageContent:
        "Draft requests Request Alpha Submit Request Alpha Request Beta Submit Request Beta",
      elements: [
        actionButton(547, "Submit Request Alpha"),
        actionButton(548, "Submit Request Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft requests Request Alpha Submit Request Alpha",
      pageContent: "Draft requests Request Alpha Submit Request Alpha",
      elements: [actionButton(547, "Submit Request Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Submit Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 548 },
      result: "Clicked element 548.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Submitted Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "submit",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:submit:request-beta",
        detail: expect.objectContaining({
          action: "submit",
          source: "target_disappearance",
          text: "Submitted target no longer visible: Request Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer submit confirmation while the named request remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Draft requests Request Alpha Submit Request Alpha",
      pageContent: "Draft requests Request Alpha Submit Request Alpha",
      elements: [actionButton(547, "Submit Request Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft requests Request Alpha Submit Request Alpha",
      pageContent: "Draft requests Request Alpha Submit Request Alpha",
      elements: [actionButton(547, "Submit Request Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 547 },
      result: "Clicked element 547.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer submit confirmation from a generic submit request control", () => {
    const genericSubmitRequestButton: TaggedElement = {
      tag: 547,
      tagName: "button",
      role: "button",
      text: "Submit request",
      attributes: {
        id: "submit-request",
        "aria-label": "Submit request",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Draft requests Request Alpha Submit request",
      pageContent: "Draft requests Request Alpha Submit request",
      elements: [genericSubmitRequestButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft requests",
      pageContent: "Draft requests",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 547 },
      result: "Clicked element 547.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts export confirmation from named report disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending exports Report Alpha Export Report Alpha Report Beta Export Report Beta",
      pageContent:
        "Pending exports Report Alpha Export Report Alpha Report Beta Export Report Beta",
      elements: [
        actionButton(553, "Export Report Alpha"),
        actionButton(554, "Export Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending exports Report Beta Export Report Beta",
      pageContent: "Pending exports Report Beta Export Report Beta",
      elements: [actionButton(554, "Export Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Export Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 553 },
      result: "Clicked element 553.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Exported Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "export",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:export:report-alpha",
        detail: expect.objectContaining({
          action: "export",
          source: "target_disappearance",
          text: "Exported target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects export target-disappearance evidence for the wrong requested report", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending exports Report Alpha Export Report Alpha Report Beta Export Report Beta",
      pageContent:
        "Pending exports Report Alpha Export Report Alpha Report Beta Export Report Beta",
      elements: [
        actionButton(553, "Export Report Alpha"),
        actionButton(554, "Export Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending exports Report Alpha Export Report Alpha",
      pageContent: "Pending exports Report Alpha Export Report Alpha",
      elements: [actionButton(553, "Export Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Export Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 554 },
      result: "Clicked element 554.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Exported Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "export",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:export:report-beta",
        detail: expect.objectContaining({
          action: "export",
          source: "target_disappearance",
          text: "Exported target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer export confirmation while the named report remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending exports Report Alpha Export Report Alpha",
      pageContent: "Pending exports Report Alpha Export Report Alpha",
      elements: [actionButton(553, "Export Report Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending exports Report Alpha Export Report Alpha",
      pageContent: "Pending exports Report Alpha Export Report Alpha",
      elements: [actionButton(553, "Export Report Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 553 },
      result: "Clicked element 553.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer export confirmation from a generic export report control", () => {
    const genericExportReportButton: TaggedElement = {
      tag: 553,
      tagName: "button",
      role: "button",
      text: "Export report",
      attributes: {
        id: "export-report",
        "aria-label": "Export report",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending exports Report Alpha Export report",
      pageContent: "Pending exports Report Alpha Export report",
      elements: [genericExportReportButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending exports",
      pageContent: "Pending exports",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 553 },
      result: "Clicked element 553.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts download confirmation from named file disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending downloads File Alpha Download File Alpha File Beta Download File Beta",
      pageContent:
        "Pending downloads File Alpha Download File Alpha File Beta Download File Beta",
      elements: [
        actionButton(555, "Download File Alpha"),
        actionButton(556, "Download File Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending downloads File Beta Download File Beta",
      pageContent: "Pending downloads File Beta Download File Beta",
      elements: [actionButton(556, "Download File Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Download File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 555 },
      result: "Clicked element 555.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Downloaded File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "download",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:download:file-alpha",
        detail: expect.objectContaining({
          action: "download",
          source: "target_disappearance",
          text: "Downloaded target no longer visible: File Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects download target-disappearance evidence for the wrong requested file", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending downloads File Alpha Download File Alpha File Beta Download File Beta",
      pageContent:
        "Pending downloads File Alpha Download File Alpha File Beta Download File Beta",
      elements: [
        actionButton(555, "Download File Alpha"),
        actionButton(556, "Download File Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending downloads File Alpha Download File Alpha",
      pageContent: "Pending downloads File Alpha Download File Alpha",
      elements: [actionButton(555, "Download File Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Download File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 556 },
      result: "Clicked element 556.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Downloaded File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "download",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:download:file-beta",
        detail: expect.objectContaining({
          action: "download",
          source: "target_disappearance",
          text: "Downloaded target no longer visible: File Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer download confirmation while the named file remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending downloads File Alpha Download File Alpha",
      pageContent: "Pending downloads File Alpha Download File Alpha",
      elements: [actionButton(555, "Download File Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending downloads File Alpha Download File Alpha",
      pageContent: "Pending downloads File Alpha Download File Alpha",
      elements: [actionButton(555, "Download File Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 555 },
      result: "Clicked element 555.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer download confirmation from a generic download file control", () => {
    const genericDownloadFileButton: TaggedElement = {
      tag: 555,
      tagName: "button",
      role: "button",
      text: "Download file",
      attributes: {
        id: "download-file",
        "aria-label": "Download file",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending downloads File Alpha Download file",
      pageContent: "Pending downloads File Alpha Download file",
      elements: [genericDownloadFileButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending downloads",
      pageContent: "Pending downloads",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 555 },
      result: "Clicked element 555.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts upload confirmation from named file disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending uploads File Alpha Upload File Alpha File Beta Upload File Beta",
      pageContent:
        "Pending uploads File Alpha Upload File Alpha File Beta Upload File Beta",
      elements: [
        actionButton(557, "Upload File Alpha"),
        actionButton(558, "Upload File Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending uploads File Beta Upload File Beta",
      pageContent: "Pending uploads File Beta Upload File Beta",
      elements: [actionButton(558, "Upload File Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Upload File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 557 },
      result: "Clicked element 557.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Uploaded File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "upload",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:upload:file-alpha",
        detail: expect.objectContaining({
          action: "upload",
          source: "target_disappearance",
          text: "Uploaded target no longer visible: File Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects upload target-disappearance evidence for the wrong requested file", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending uploads File Alpha Upload File Alpha File Beta Upload File Beta",
      pageContent:
        "Pending uploads File Alpha Upload File Alpha File Beta Upload File Beta",
      elements: [
        actionButton(557, "Upload File Alpha"),
        actionButton(558, "Upload File Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending uploads File Alpha Upload File Alpha",
      pageContent: "Pending uploads File Alpha Upload File Alpha",
      elements: [actionButton(557, "Upload File Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Upload File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 558 },
      result: "Clicked element 558.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Uploaded File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "upload",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:upload:file-beta",
        detail: expect.objectContaining({
          action: "upload",
          source: "target_disappearance",
          text: "Uploaded target no longer visible: File Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer upload confirmation while the named file remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending uploads File Alpha Upload File Alpha",
      pageContent: "Pending uploads File Alpha Upload File Alpha",
      elements: [actionButton(557, "Upload File Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending uploads File Alpha Upload File Alpha",
      pageContent: "Pending uploads File Alpha Upload File Alpha",
      elements: [actionButton(557, "Upload File Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 557 },
      result: "Clicked element 557.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer upload confirmation from a generic upload file control", () => {
    const genericUploadFileButton: TaggedElement = {
      tag: 557,
      tagName: "button",
      role: "button",
      text: "Upload file",
      attributes: {
        id: "upload-file",
        "aria-label": "Upload file",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending uploads File Alpha Upload file",
      pageContent: "Pending uploads File Alpha Upload file",
      elements: [genericUploadFileButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending uploads",
      pageContent: "Pending uploads",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 557 },
      result: "Clicked element 557.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts upload confirmation from upload_file result evidence", () => {
    const snap = workflowSnapshot({
      visibleContent: "Upload form File input",
      pageContent: "Upload form File input",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Upload File Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-alpha.pdf" },
      result: 'Uploaded "File Alpha.pdf" (2048 bytes) to [557] file input',
      currentSnapshot: snap,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Uploaded File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "upload",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:upload:file-alpha-pdf",
        detail: expect.objectContaining({
          action: "upload",
          source: "upload_file_result",
          targetText: "File Alpha.pdf",
          text: "Uploaded file selected: File Alpha.pdf (2048 bytes)",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects upload_file result evidence for the wrong requested file", () => {
    const snap = workflowSnapshot({
      visibleContent: "Upload form File input",
      pageContent: "Upload form File input",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Upload File Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-beta.pdf" },
      result: 'Uploaded "File Beta.pdf" (2048 bytes) to [557] file input',
      currentSnapshot: snap,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Uploaded File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "upload",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:upload:file-beta-pdf",
        detail: expect.objectContaining({
          action: "upload",
          source: "upload_file_result",
          targetText: "File Beta.pdf",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer upload_file result evidence from non-upload result text", () => {
    const snap = workflowSnapshot({
      visibleContent: "Upload form File input",
      pageContent: "Upload form File input",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-alpha.pdf" },
      result: "Upload started for File Alpha.pdf.",
      currentSnapshot: snap,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts attach confirmation from visible attachment row after upload_file", () => {
    const pre = workflowSnapshot({
      visibleContent: "Attach files File input",
      pageContent: "Attach files File input",
      elements: [],
    });
    const current = workflowSnapshot({
      visibleContent: "Attachments File Alpha.pdf Attached",
      pageContent: "Attachments File Alpha.pdf Attached",
      elements: [rowElement(642, "File Alpha.pdf Attached")],
    });
    const generated = generateCompletionContract({
      userRequest: "Attach File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-alpha.pdf" },
      result: 'Uploaded "File Alpha.pdf" (2048 bytes) to [557] file input',
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Attached File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "attach",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          confidence: "high",
          logicalKey: "workflow:confirmation:attach:row:file-alpha-pdf",
          detail: expect.objectContaining({
            action: "attach",
            source: "attachment_row_state",
            targetText: "File Alpha.pdf",
            text: "Attachment row visible: File Alpha.pdf",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects attachment row-state evidence for the wrong requested file", () => {
    const pre = workflowSnapshot({
      visibleContent: "Attach files File input",
      pageContent: "Attach files File input",
      elements: [],
    });
    const current = workflowSnapshot({
      visibleContent: "Attachments File Beta.pdf Attached",
      pageContent: "Attachments File Beta.pdf Attached",
      elements: [rowElement(642, "File Beta.pdf Attached")],
    });
    const generated = generateCompletionContract({
      userRequest: "Attach File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-beta.pdf" },
      result: 'Uploaded "File Beta.pdf" (2048 bytes) to [557] file input',
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Attached File Alpha.",
    });

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          confidence: "high",
          logicalKey: "workflow:confirmation:attach:row:file-beta-pdf",
          detail: expect.objectContaining({
            action: "attach",
            source: "attachment_row_state",
            targetText: "File Beta.pdf",
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

  test("does not infer attachment row-state evidence from plain visible text", () => {
    const pre = workflowSnapshot({
      visibleContent: "Attach files File input",
      pageContent: "Attach files File input",
      elements: [],
    });
    const current = workflowSnapshot({
      visibleContent: "Attachments File Alpha.pdf Attached",
      pageContent: "Attachments File Alpha.pdf Attached",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-alpha.pdf" },
      result: 'Uploaded "File Alpha.pdf" (2048 bytes) to [557] file input',
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.objectContaining({
            source: "attachment_row_state",
          }),
        }),
      ]),
    );
  });

  test("does not infer attachment row-state evidence from a row that already existed", () => {
    const pre = workflowSnapshot({
      visibleContent: "Attachments File Alpha.pdf Attached",
      pageContent: "Attachments File Alpha.pdf Attached",
      elements: [rowElement(642, "File Alpha.pdf Attached")],
    });
    const current = workflowSnapshot({
      visibleContent: "Attachments File Alpha.pdf Attached",
      pageContent: "Attachments File Alpha.pdf Attached",
      elements: [rowElement(642, "File Alpha.pdf Attached")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-alpha.pdf" },
      result: 'Uploaded "File Alpha.pdf" (2048 bytes) to [557] file input',
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.objectContaining({
            source: "attachment_row_state",
          }),
        }),
      ]),
    );
  });

  test("does not infer attachment row-state evidence without attachment state text", () => {
    const pre = workflowSnapshot({
      visibleContent: "Attach files File input",
      pageContent: "Attach files File input",
      elements: [],
    });
    const current = workflowSnapshot({
      visibleContent: "Files File Alpha.pdf Available",
      pageContent: "Files File Alpha.pdf Available",
      elements: [rowElement(642, "File Alpha.pdf Available")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-alpha.pdf" },
      result: 'Uploaded "File Alpha.pdf" (2048 bytes) to [557] file input',
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.objectContaining({
            source: "attachment_row_state",
          }),
        }),
      ]),
    );
  });

  test("accepts import confirmation from visible import row after upload_file", () => {
    const pre = workflowSnapshot({
      visibleContent: "Import data File input",
      pageContent: "Import data File input",
      elements: [],
    });
    const current = workflowSnapshot({
      visibleContent: "Imports File Alpha.csv Imported",
      pageContent: "Imports File Alpha.csv Imported",
      elements: [rowElement(642, "File Alpha.csv Imported")],
    });
    const generated = generateCompletionContract({
      userRequest: "Import File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-alpha.csv" },
      result: 'Uploaded "File Alpha.csv" (2048 bytes) to [557] file input',
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Imported File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "import",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          confidence: "high",
          logicalKey: "workflow:confirmation:import:row:file-alpha-csv",
          detail: expect.objectContaining({
            action: "import",
            source: "import_row_state",
            targetText: "File Alpha.csv",
            text: "Import row visible: File Alpha.csv",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects import row-state evidence for the wrong requested file", () => {
    const pre = workflowSnapshot({
      visibleContent: "Import data File input",
      pageContent: "Import data File input",
      elements: [],
    });
    const current = workflowSnapshot({
      visibleContent: "Imports File Beta.csv Imported",
      pageContent: "Imports File Beta.csv Imported",
      elements: [rowElement(642, "File Beta.csv Imported")],
    });
    const generated = generateCompletionContract({
      userRequest: "Import File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-beta.csv" },
      result: 'Uploaded "File Beta.csv" (2048 bytes) to [557] file input',
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Imported File Alpha.",
    });

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          confidence: "high",
          logicalKey: "workflow:confirmation:import:row:file-beta-csv",
          detail: expect.objectContaining({
            action: "import",
            source: "import_row_state",
            targetText: "File Beta.csv",
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

  test("does not infer import row-state evidence from plain visible text", () => {
    const pre = workflowSnapshot({
      visibleContent: "Import data File input",
      pageContent: "Import data File input",
      elements: [],
    });
    const current = workflowSnapshot({
      visibleContent: "Imports File Alpha.csv Imported",
      pageContent: "Imports File Alpha.csv Imported",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-alpha.csv" },
      result: 'Uploaded "File Alpha.csv" (2048 bytes) to [557] file input',
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.objectContaining({
            source: "import_row_state",
          }),
        }),
      ]),
    );
  });

  test("does not infer import row-state evidence from a row that already existed", () => {
    const pre = workflowSnapshot({
      visibleContent: "Imports File Alpha.csv Imported",
      pageContent: "Imports File Alpha.csv Imported",
      elements: [rowElement(642, "File Alpha.csv Imported")],
    });
    const current = workflowSnapshot({
      visibleContent: "Imports File Alpha.csv Imported",
      pageContent: "Imports File Alpha.csv Imported",
      elements: [rowElement(642, "File Alpha.csv Imported")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-alpha.csv" },
      result: 'Uploaded "File Alpha.csv" (2048 bytes) to [557] file input',
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.objectContaining({
            source: "import_row_state",
          }),
        }),
      ]),
    );
  });

  test("does not infer import row-state evidence without imported state text", () => {
    const pre = workflowSnapshot({
      visibleContent: "Import data File input",
      pageContent: "Import data File input",
      elements: [],
    });
    const current = workflowSnapshot({
      visibleContent: "Imports File Alpha.csv Available",
      pageContent: "Imports File Alpha.csv Available",
      elements: [rowElement(642, "File Alpha.csv Available")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.UPLOAD_FILE,
      args: { id: 557, url: "https://files.example.test/file-alpha.csv" },
      result: 'Uploaded "File Alpha.csv" (2048 bytes) to [557] file input',
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.objectContaining({
            source: "import_row_state",
          }),
        }),
      ]),
    );
  });

  test("accepts download confirmation from download_file result evidence", () => {
    const snap = workflowSnapshot({
      visibleContent: "Download center File Alpha File Beta",
      pageContent: "Download center File Alpha File Beta",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Download File Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.DOWNLOAD_FILE,
      args: {
        url: "https://files.example.test/file-alpha.pdf",
        filename: "File Alpha.pdf",
      },
      result: "Download started (ID: 42)",
      currentSnapshot: snap,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Downloaded File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "download",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:download:file-alpha-pdf",
        detail: expect.objectContaining({
          action: "download",
          source: "download_file_result",
          targetText: "File Alpha.pdf",
          text: "Download started: File Alpha.pdf (ID: 42)",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts download_file result evidence target from the URL filename", () => {
    const snap = workflowSnapshot({
      visibleContent: "Download center File Alpha",
      pageContent: "Download center File Alpha",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Download File Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.DOWNLOAD_FILE,
      args: { url: "https://files.example.test/downloads/File%20Alpha.pdf" },
      result: "Download started (ID: 43)",
      currentSnapshot: snap,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Downloaded File Alpha.",
    });

    expect(evidence).toEqual([
      expect.objectContaining({
        logicalKey: "workflow:confirmation:download:file-alpha-pdf",
        detail: expect.objectContaining({
          action: "download",
          source: "download_file_result",
          targetText: "File Alpha.pdf",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts completed download_file result evidence", () => {
    const snap = workflowSnapshot({
      visibleContent: "Download center File Alpha",
      pageContent: "Download center File Alpha",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Download File Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.DOWNLOAD_FILE,
      args: { url: "https://files.example.test/downloads/file-alpha.pdf" },
      result: "Download completed (ID: 45, filename: File Alpha.pdf)",
      currentSnapshot: snap,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Downloaded File Alpha.",
    });

    expect(evidence).toEqual([
      expect.objectContaining({
        logicalKey: "workflow:confirmation:download:file-alpha-pdf",
        detail: expect.objectContaining({
          action: "download",
          source: "download_file_completed",
          targetText: "File Alpha.pdf",
          text: "Download completed: File Alpha.pdf (ID: 45)",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects download_file result evidence for the wrong requested file", () => {
    const snap = workflowSnapshot({
      visibleContent: "Download center File Alpha File Beta",
      pageContent: "Download center File Alpha File Beta",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Download File Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.DOWNLOAD_FILE,
      args: {
        url: "https://files.example.test/file-beta.pdf",
        filename: "File Beta.pdf",
      },
      result: "Download started (ID: 44)",
      currentSnapshot: snap,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Downloaded File Alpha.",
    });

    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:download:file-beta-pdf",
        detail: expect.objectContaining({
          action: "download",
          source: "download_file_result",
          targetText: "File Beta.pdf",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer download_file result evidence from non-start result text", () => {
    const snap = workflowSnapshot({
      visibleContent: "Download center File Alpha",
      pageContent: "Download center File Alpha",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.DOWNLOAD_FILE,
      args: {
        url: "https://files.example.test/file-alpha.pdf",
        filename: "File Alpha.pdf",
      },
      result: "Error starting download: Network failed",
      currentSnapshot: snap,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts import confirmation from named file disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending imports File Alpha Import File Alpha File Beta Import File Beta",
      pageContent:
        "Pending imports File Alpha Import File Alpha File Beta Import File Beta",
      elements: [
        actionButton(559, "Import File Alpha"),
        actionButton(560, "Import File Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending imports File Beta Import File Beta",
      pageContent: "Pending imports File Beta Import File Beta",
      elements: [actionButton(560, "Import File Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Import File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 559 },
      result: "Clicked element 559.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Imported File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "import",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:import:file-alpha",
        detail: expect.objectContaining({
          action: "import",
          source: "target_disappearance",
          text: "Imported target no longer visible: File Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects import target-disappearance evidence for the wrong requested file", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending imports File Alpha Import File Alpha File Beta Import File Beta",
      pageContent:
        "Pending imports File Alpha Import File Alpha File Beta Import File Beta",
      elements: [
        actionButton(559, "Import File Alpha"),
        actionButton(560, "Import File Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending imports File Alpha Import File Alpha",
      pageContent: "Pending imports File Alpha Import File Alpha",
      elements: [actionButton(559, "Import File Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Import File Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 560 },
      result: "Clicked element 560.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Imported File Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "import",
      targetLabel: "File Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:import:file-beta",
        detail: expect.objectContaining({
          action: "import",
          source: "target_disappearance",
          text: "Imported target no longer visible: File Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer import confirmation while the named file remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending imports File Alpha Import File Alpha",
      pageContent: "Pending imports File Alpha Import File Alpha",
      elements: [actionButton(559, "Import File Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending imports File Alpha Import File Alpha",
      pageContent: "Pending imports File Alpha Import File Alpha",
      elements: [actionButton(559, "Import File Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 559 },
      result: "Clicked element 559.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer import confirmation from a generic import file control", () => {
    const genericImportFileButton: TaggedElement = {
      tag: 559,
      tagName: "button",
      role: "button",
      text: "Import file",
      attributes: {
        id: "import-file",
        "aria-label": "Import file",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending imports File Alpha Import file",
      pageContent: "Pending imports File Alpha Import file",
      elements: [genericImportFileButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending imports",
      pageContent: "Pending imports",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 559 },
      result: "Clicked element 559.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts copy confirmation from named link disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending copies Link Alpha Copy Link Alpha Link Beta Copy Link Beta",
      pageContent:
        "Pending copies Link Alpha Copy Link Alpha Link Beta Copy Link Beta",
      elements: [
        actionButton(561, "Copy Link Alpha"),
        actionButton(562, "Copy Link Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending copies Link Beta Copy Link Beta",
      pageContent: "Pending copies Link Beta Copy Link Beta",
      elements: [actionButton(562, "Copy Link Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Copy Link Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 561 },
      result: "Clicked element 561.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Copied Link Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "copy",
      targetLabel: "Link Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:copy:link-alpha",
        detail: expect.objectContaining({
          action: "copy",
          source: "target_disappearance",
          text: "Copied target no longer visible: Link Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects copy target-disappearance evidence for the wrong requested link", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending copies Link Alpha Copy Link Alpha Link Beta Copy Link Beta",
      pageContent:
        "Pending copies Link Alpha Copy Link Alpha Link Beta Copy Link Beta",
      elements: [
        actionButton(561, "Copy Link Alpha"),
        actionButton(562, "Copy Link Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending copies Link Alpha Copy Link Alpha",
      pageContent: "Pending copies Link Alpha Copy Link Alpha",
      elements: [actionButton(561, "Copy Link Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Copy Link Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 562 },
      result: "Clicked element 562.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Copied Link Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "copy",
      targetLabel: "Link Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:copy:link-beta",
        detail: expect.objectContaining({
          action: "copy",
          source: "target_disappearance",
          text: "Copied target no longer visible: Link Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer copy confirmation while the named link remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending copies Link Alpha Copy Link Alpha",
      pageContent: "Pending copies Link Alpha Copy Link Alpha",
      elements: [actionButton(561, "Copy Link Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending copies Link Alpha Copy Link Alpha",
      pageContent: "Pending copies Link Alpha Copy Link Alpha",
      elements: [actionButton(561, "Copy Link Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 561 },
      result: "Clicked element 561.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer copy confirmation from a generic copy link control", () => {
    const genericCopyLinkButton: TaggedElement = {
      tag: 561,
      tagName: "button",
      role: "button",
      text: "Copy link",
      attributes: {
        id: "copy-link",
        "aria-label": "Copy link",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Available links Link Alpha Copy link",
      pageContent: "Available links Link Alpha Copy link",
      elements: [genericCopyLinkButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Available links",
      pageContent: "Available links",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 561 },
      result: "Clicked element 561.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts share confirmation from named report disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending shares Report Alpha Share Report Alpha Report Beta Share Report Beta",
      pageContent:
        "Pending shares Report Alpha Share Report Alpha Report Beta Share Report Beta",
      elements: [
        actionButton(563, "Share Report Alpha"),
        actionButton(564, "Share Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending shares Report Beta Share Report Beta",
      pageContent: "Pending shares Report Beta Share Report Beta",
      elements: [actionButton(564, "Share Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Share Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 563 },
      result: "Clicked element 563.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Shared Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "share",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:share:report-alpha",
        detail: expect.objectContaining({
          action: "share",
          source: "target_disappearance",
          text: "Shared target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects share target-disappearance evidence for the wrong requested report", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending shares Report Alpha Share Report Alpha Report Beta Share Report Beta",
      pageContent:
        "Pending shares Report Alpha Share Report Alpha Report Beta Share Report Beta",
      elements: [
        actionButton(563, "Share Report Alpha"),
        actionButton(564, "Share Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending shares Report Alpha Share Report Alpha",
      pageContent: "Pending shares Report Alpha Share Report Alpha",
      elements: [actionButton(563, "Share Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Share Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 564 },
      result: "Clicked element 564.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Shared Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "share",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:share:report-beta",
        detail: expect.objectContaining({
          action: "share",
          source: "target_disappearance",
          text: "Shared target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer share confirmation while the named report remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending shares Report Alpha Share Report Alpha",
      pageContent: "Pending shares Report Alpha Share Report Alpha",
      elements: [actionButton(563, "Share Report Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending shares Report Alpha Share Report Alpha",
      pageContent: "Pending shares Report Alpha Share Report Alpha",
      elements: [actionButton(563, "Share Report Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 563 },
      result: "Clicked element 563.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer share confirmation from a generic share report control", () => {
    const genericShareReportButton: TaggedElement = {
      tag: 563,
      tagName: "button",
      role: "button",
      text: "Share report",
      attributes: {
        id: "share-report",
        "aria-label": "Share report",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Available reports Report Alpha Share report",
      pageContent: "Available reports Report Alpha Share report",
      elements: [genericShareReportButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Available reports",
      pageContent: "Available reports",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 563 },
      result: "Clicked element 563.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts restore confirmation from named version disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Archived versions Version Alpha Restore Version Alpha Version Beta Restore Version Beta",
      pageContent:
        "Archived versions Version Alpha Restore Version Alpha Version Beta Restore Version Beta",
      elements: [
        actionButton(565, "Restore Version Alpha"),
        actionButton(566, "Restore Version Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Archived versions Version Beta Restore Version Beta",
      pageContent: "Archived versions Version Beta Restore Version Beta",
      elements: [actionButton(566, "Restore Version Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Restore Version Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 565 },
      result: "Clicked element 565.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Restored Version Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "restore",
      targetLabel: "Version Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:restore:version-alpha",
        detail: expect.objectContaining({
          action: "restore",
          source: "target_disappearance",
          text: "Restored target no longer visible: Version Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects restore target-disappearance evidence for the wrong requested version", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Archived versions Version Alpha Restore Version Alpha Version Beta Restore Version Beta",
      pageContent:
        "Archived versions Version Alpha Restore Version Alpha Version Beta Restore Version Beta",
      elements: [
        actionButton(565, "Restore Version Alpha"),
        actionButton(566, "Restore Version Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Archived versions Version Alpha Restore Version Alpha",
      pageContent: "Archived versions Version Alpha Restore Version Alpha",
      elements: [actionButton(565, "Restore Version Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Restore Version Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 566 },
      result: "Clicked element 566.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Restored Version Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "restore",
      targetLabel: "Version Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:restore:version-beta",
        detail: expect.objectContaining({
          action: "restore",
          source: "target_disappearance",
          text: "Restored target no longer visible: Version Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer restore confirmation while the named version remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Archived versions Version Alpha Restore Version Alpha",
      pageContent: "Archived versions Version Alpha Restore Version Alpha",
      elements: [actionButton(565, "Restore Version Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Archived versions Version Alpha Restore Version Alpha",
      pageContent: "Archived versions Version Alpha Restore Version Alpha",
      elements: [actionButton(565, "Restore Version Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 565 },
      result: "Clicked element 565.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer restore confirmation from a generic restore backup control", () => {
    const genericRestoreBackupButton: TaggedElement = {
      tag: 565,
      tagName: "button",
      role: "button",
      text: "Restore backup",
      attributes: {
        id: "restore-backup",
        "aria-label": "Restore backup",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Archived backups Version Alpha Restore backup",
      pageContent: "Archived backups Version Alpha Restore backup",
      elements: [genericRestoreBackupButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Archived backups",
      pageContent: "Archived backups",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 565 },
      result: "Clicked element 565.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts duplicate confirmation from named template disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta",
      pageContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta",
      elements: [
        actionButton(567, "Duplicate Template Alpha"),
        actionButton(568, "Duplicate Template Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Pending duplicate jobs Template Beta Duplicate Template Beta",
      pageContent:
        "Pending duplicate jobs Template Beta Duplicate Template Beta",
      elements: [actionButton(568, "Duplicate Template Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Duplicate Template Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 567 },
      result: "Clicked element 567.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Duplicated Template Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "duplicate",
      targetLabel: "Template Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:duplicate:template-alpha",
        detail: expect.objectContaining({
          action: "duplicate",
          source: "target_disappearance",
          text: "Duplicated target no longer visible: Template Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects duplicate target-disappearance evidence for the wrong requested template", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta",
      pageContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta",
      elements: [
        actionButton(567, "Duplicate Template Alpha"),
        actionButton(568, "Duplicate Template Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha",
      pageContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha",
      elements: [actionButton(567, "Duplicate Template Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Duplicate Template Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 568 },
      result: "Clicked element 568.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Duplicated Template Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "duplicate",
      targetLabel: "Template Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:duplicate:template-beta",
        detail: expect.objectContaining({
          action: "duplicate",
          source: "target_disappearance",
          text: "Duplicated target no longer visible: Template Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts duplicate confirmation from a newly visible duplicate row", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Templates Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta",
      pageContent:
        "Templates Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta",
      elements: [
        rowElement(661, "Template Alpha"),
        actionButton(567, "Duplicate Template Alpha"),
        rowElement(662, "Template Beta"),
        actionButton(568, "Duplicate Template Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Templates Template Alpha Duplicate Template Alpha Template Alpha Copy Duplicated Template Beta Duplicate Template Beta",
      pageContent:
        "Templates Template Alpha Duplicate Template Alpha Template Alpha Copy Duplicated Template Beta Duplicate Template Beta",
      elements: [
        rowElement(661, "Template Alpha"),
        actionButton(567, "Duplicate Template Alpha"),
        rowElement(663, "Template Alpha Copy Duplicated"),
        rowElement(662, "Template Beta"),
        actionButton(568, "Duplicate Template Beta"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Duplicate Template Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 567 },
      result: "Clicked element 567.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Duplicated Template Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "duplicate",
      targetLabel: "Template Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          confidence: "high",
          logicalKey: "workflow:confirmation:duplicate:row:template-alpha",
          detail: expect.objectContaining({
            action: "duplicate",
            source: "duplicate_row_state",
            targetText: "Template Alpha",
            text: "Duplicated row visible: Template Alpha",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts copy confirmation from a newly visible copied row", () => {
    const pre = workflowSnapshot({
      visibleContent: "Links Link Alpha Copy Link Alpha Link Beta Copy Link Beta",
      pageContent: "Links Link Alpha Copy Link Alpha Link Beta Copy Link Beta",
      elements: [
        rowElement(661, "Link Alpha"),
        actionButton(567, "Copy Link Alpha"),
        rowElement(662, "Link Beta"),
        actionButton(568, "Copy Link Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Links Link Alpha Copy Link Alpha Link Alpha Copy Link Beta Copy Link Beta",
      pageContent:
        "Links Link Alpha Copy Link Alpha Link Alpha Copy Link Beta Copy Link Beta",
      elements: [
        rowElement(661, "Link Alpha"),
        actionButton(567, "Copy Link Alpha"),
        rowElement(663, "Link Alpha Copy"),
        rowElement(662, "Link Beta"),
        actionButton(568, "Copy Link Beta"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Copy Link Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 567 },
      result: "Clicked element 567.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Copied Link Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "copy",
      targetLabel: "Link Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          confidence: "high",
          logicalKey: "workflow:confirmation:copy:row:link-alpha",
          detail: expect.objectContaining({
            action: "copy",
            source: "duplicate_row_state",
            targetText: "Link Alpha",
            text: "Copied row visible: Link Alpha",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects duplicate row-state evidence for the wrong requested template", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Templates Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta",
      pageContent:
        "Templates Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta",
      elements: [
        rowElement(661, "Template Alpha"),
        actionButton(567, "Duplicate Template Alpha"),
        rowElement(662, "Template Beta"),
        actionButton(568, "Duplicate Template Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Templates Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta Template Beta Copy Duplicated",
      pageContent:
        "Templates Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta Template Beta Copy Duplicated",
      elements: [
        rowElement(661, "Template Alpha"),
        actionButton(567, "Duplicate Template Alpha"),
        rowElement(662, "Template Beta"),
        actionButton(568, "Duplicate Template Beta"),
        rowElement(663, "Template Beta Copy Duplicated"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Duplicate Template Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 568 },
      result: "Clicked element 568.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Duplicated Template Alpha.",
    });

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          confidence: "high",
          logicalKey: "workflow:confirmation:duplicate:row:template-beta",
          detail: expect.objectContaining({
            action: "duplicate",
            source: "duplicate_row_state",
            targetText: "Template Beta",
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

  test("does not infer duplicate row-state evidence from plain visible text", () => {
    const pre = workflowSnapshot({
      visibleContent: "Templates Template Alpha Duplicate Template Alpha",
      pageContent: "Templates Template Alpha Duplicate Template Alpha",
      elements: [
        rowElement(661, "Template Alpha"),
        actionButton(567, "Duplicate Template Alpha"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Templates Template Alpha Duplicate Template Alpha Template Alpha Copy Duplicated",
      pageContent:
        "Templates Template Alpha Duplicate Template Alpha Template Alpha Copy Duplicated",
      elements: [
        rowElement(661, "Template Alpha"),
        actionButton(567, "Duplicate Template Alpha"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 567 },
      result: "Clicked element 567.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.objectContaining({
            source: "duplicate_row_state",
          }),
        }),
      ]),
    );
  });

  test("does not infer duplicate row-state evidence from a row that already existed", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Templates Template Alpha Duplicate Template Alpha Template Alpha Copy Duplicated",
      pageContent:
        "Templates Template Alpha Duplicate Template Alpha Template Alpha Copy Duplicated",
      elements: [
        rowElement(661, "Template Alpha"),
        actionButton(567, "Duplicate Template Alpha"),
        rowElement(663, "Template Alpha Copy Duplicated"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Templates Template Alpha Duplicate Template Alpha Template Alpha Copy Duplicated",
      pageContent:
        "Templates Template Alpha Duplicate Template Alpha Template Alpha Copy Duplicated",
      elements: [
        rowElement(661, "Template Alpha"),
        actionButton(567, "Duplicate Template Alpha"),
        rowElement(663, "Template Alpha Copy Duplicated"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 567 },
      result: "Clicked element 567.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.objectContaining({
            source: "duplicate_row_state",
          }),
        }),
      ]),
    );
  });

  test("does not infer duplicate row-state evidence without duplicate state text", () => {
    const pre = workflowSnapshot({
      visibleContent: "Templates Template Alpha Duplicate Template Alpha",
      pageContent: "Templates Template Alpha Duplicate Template Alpha",
      elements: [
        rowElement(661, "Template Alpha"),
        actionButton(567, "Duplicate Template Alpha"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Templates Template Alpha Duplicate Template Alpha Template Alpha Active",
      pageContent:
        "Templates Template Alpha Duplicate Template Alpha Template Alpha Active",
      elements: [
        rowElement(661, "Template Alpha"),
        actionButton(567, "Duplicate Template Alpha"),
        rowElement(663, "Template Alpha Active"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 567 },
      result: "Clicked element 567.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.objectContaining({
            source: "duplicate_row_state",
          }),
        }),
      ]),
    );
  });

  test("does not infer duplicate confirmation while the named template remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha",
      pageContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha",
      elements: [actionButton(567, "Duplicate Template Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha",
      pageContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha",
      elements: [actionButton(567, "Duplicate Template Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 567 },
      result: "Clicked element 567.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer duplicate confirmation from a generic duplicate template control", () => {
    const genericDuplicateTemplateButton: TaggedElement = {
      tag: 567,
      tagName: "button",
      role: "button",
      text: "Duplicate template",
      attributes: {
        id: "duplicate-template",
        "aria-label": "Duplicate template",
      },
      rect: { x: 500, y: 80, width: 150, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Available templates Template Alpha Duplicate template",
      pageContent: "Available templates Template Alpha Duplicate template",
      elements: [genericDuplicateTemplateButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Available work",
      pageContent: "Available work",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 567 },
      result: "Clicked element 567.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts invite confirmation from named member disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending invitations Member Alpha Invite Member Alpha Member Beta Invite Member Beta",
      pageContent:
        "Pending invitations Member Alpha Invite Member Alpha Member Beta Invite Member Beta",
      elements: [
        actionButton(569, "Invite Member Alpha"),
        actionButton(570, "Invite Member Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending invitations Member Beta Invite Member Beta",
      pageContent: "Pending invitations Member Beta Invite Member Beta",
      elements: [actionButton(570, "Invite Member Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Invite Member Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 569 },
      result: "Clicked element 569.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Invited Member Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "invite",
      targetLabel: "Member Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:invite:member-alpha",
        detail: expect.objectContaining({
          action: "invite",
          source: "target_disappearance",
          text: "Invited target no longer visible: Member Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects invite target-disappearance evidence for the wrong requested member", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending invitations Member Alpha Invite Member Alpha Member Beta Invite Member Beta",
      pageContent:
        "Pending invitations Member Alpha Invite Member Alpha Member Beta Invite Member Beta",
      elements: [
        actionButton(569, "Invite Member Alpha"),
        actionButton(570, "Invite Member Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending invitations Member Alpha Invite Member Alpha",
      pageContent: "Pending invitations Member Alpha Invite Member Alpha",
      elements: [actionButton(569, "Invite Member Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Invite Member Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 570 },
      result: "Clicked element 570.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Invited Member Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "invite",
      targetLabel: "Member Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:invite:member-beta",
        detail: expect.objectContaining({
          action: "invite",
          source: "target_disappearance",
          text: "Invited target no longer visible: Member Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer invite confirmation while the named member remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending invitations Member Alpha Invite Member Alpha",
      pageContent: "Pending invitations Member Alpha Invite Member Alpha",
      elements: [actionButton(569, "Invite Member Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending invitations Member Alpha Invite Member Alpha",
      pageContent: "Pending invitations Member Alpha Invite Member Alpha",
      elements: [actionButton(569, "Invite Member Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 569 },
      result: "Clicked element 569.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer invite confirmation from a generic invite member control", () => {
    const genericInviteMemberButton: TaggedElement = {
      tag: 569,
      tagName: "button",
      role: "button",
      text: "Invite member",
      attributes: {
        id: "invite-member",
        "aria-label": "Invite member",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Members Member Alpha Invite member",
      pageContent: "Members Member Alpha Invite member",
      elements: [genericInviteMemberButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Members",
      pageContent: "Members",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 569 },
      result: "Clicked element 569.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts invite confirmation from visible pending invitation row", () => {
    const pre = workflowSnapshot({
      visibleContent: "Members Member Alpha Invite Member Alpha",
      pageContent: "Members Member Alpha Invite Member Alpha",
      elements: [actionButton(569, "Invite Member Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending invitations Member Alpha Pending invitation",
      pageContent: "Pending invitations Member Alpha Pending invitation",
      elements: [rowElement(641, "Member Alpha Pending invitation")],
    });
    const generated = generateCompletionContract({
      userRequest: "Invite Member Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 569 },
      result: "Clicked element 569.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Invited Member Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "invite",
      targetLabel: "Member Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:invite:row:member-alpha",
        detail: expect.objectContaining({
          action: "invite",
          source: "invite_row_state",
          targetText: "Member Alpha",
          text: "Invitation row visible: Member Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects invite row-state evidence for the wrong requested member", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Members Member Alpha Invite Member Alpha Member Beta Invite Member Beta",
      pageContent:
        "Members Member Alpha Invite Member Alpha Member Beta Invite Member Beta",
      elements: [
        actionButton(569, "Invite Member Alpha"),
        actionButton(570, "Invite Member Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending invitations Member Beta Pending invitation",
      pageContent: "Pending invitations Member Beta Pending invitation",
      elements: [rowElement(641, "Member Beta Pending invitation")],
    });
    const generated = generateCompletionContract({
      userRequest: "Invite Member Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 570 },
      result: "Clicked element 570.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Invited Member Alpha.",
    });

    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:invite:row:member-beta",
        detail: expect.objectContaining({
          action: "invite",
          source: "invite_row_state",
          targetText: "Member Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer invite row-state evidence from plain visible text", () => {
    const pre = workflowSnapshot({
      visibleContent: "Members Member Alpha Invite Member Alpha",
      pageContent: "Members Member Alpha Invite Member Alpha",
      elements: [actionButton(569, "Invite Member Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending invitations Member Alpha Pending invitation",
      pageContent: "Pending invitations Member Alpha Pending invitation",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 569 },
      result: "Clicked element 569.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer invite row-state evidence from a row that already existed", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending invitations Member Alpha Pending invitation Members Member Alpha Invite Member Alpha",
      pageContent:
        "Pending invitations Member Alpha Pending invitation Members Member Alpha Invite Member Alpha",
      elements: [
        rowElement(641, "Member Alpha Pending invitation"),
        actionButton(569, "Invite Member Alpha"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending invitations Member Alpha Pending invitation",
      pageContent: "Pending invitations Member Alpha Pending invitation",
      elements: [rowElement(641, "Member Alpha Pending invitation")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 569 },
      result: "Clicked element 569.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer invite row-state evidence without invitation state text", () => {
    const pre = workflowSnapshot({
      visibleContent: "Members Member Alpha Invite Member Alpha",
      pageContent: "Members Member Alpha Invite Member Alpha",
      elements: [actionButton(569, "Invite Member Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Members Member Alpha Viewer",
      pageContent: "Members Member Alpha Viewer",
      elements: [rowElement(641, "Member Alpha Viewer")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 569 },
      result: "Clicked element 569.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts send confirmation from named queued message disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Queued messages Message Alpha Send Message Alpha Message Beta Send Message Beta",
      pageContent:
        "Queued messages Message Alpha Send Message Alpha Message Beta Send Message Beta",
      elements: [
        actionButton(571, "Send Message Alpha"),
        actionButton(572, "Send Message Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Queued messages Message Beta Send Message Beta",
      pageContent: "Queued messages Message Beta Send Message Beta",
      elements: [actionButton(572, "Send Message Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Send Message Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 571 },
      result: "Clicked element 571.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Sent Message Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "send",
      targetLabel: "Message Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:send:message-alpha",
        detail: expect.objectContaining({
          action: "send",
          source: "target_disappearance",
          text: "Sent target no longer visible: Message Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects send target-disappearance evidence for the wrong requested message", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Queued messages Message Alpha Send Message Alpha Message Beta Send Message Beta",
      pageContent:
        "Queued messages Message Alpha Send Message Alpha Message Beta Send Message Beta",
      elements: [
        actionButton(571, "Send Message Alpha"),
        actionButton(572, "Send Message Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Queued messages Message Alpha Send Message Alpha",
      pageContent: "Queued messages Message Alpha Send Message Alpha",
      elements: [actionButton(571, "Send Message Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Send Message Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 572 },
      result: "Clicked element 572.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Sent Message Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "send",
      targetLabel: "Message Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:send:message-beta",
        detail: expect.objectContaining({
          action: "send",
          source: "target_disappearance",
          text: "Sent target no longer visible: Message Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer send confirmation while the named queued message remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Queued messages Message Alpha Send Message Alpha",
      pageContent: "Queued messages Message Alpha Send Message Alpha",
      elements: [actionButton(571, "Send Message Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Queued messages Message Alpha Send Message Alpha",
      pageContent: "Queued messages Message Alpha Send Message Alpha",
      elements: [actionButton(571, "Send Message Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 571 },
      result: "Clicked element 571.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer send confirmation from a generic send message control", () => {
    const genericSendMessageButton: TaggedElement = {
      tag: 571,
      tagName: "button",
      role: "button",
      text: "Send message",
      attributes: {
        id: "send-message",
        "aria-label": "Send message",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Queued messages Message Alpha Send message",
      pageContent: "Queued messages Message Alpha Send message",
      elements: [genericSendMessageButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Queued messages",
      pageContent: "Queued messages",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 571 },
      result: "Clicked element 571.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts post confirmation from named draft article disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Draft articles Article Alpha Publish Article Alpha Article Beta Publish Article Beta",
      pageContent:
        "Draft articles Article Alpha Publish Article Alpha Article Beta Publish Article Beta",
      elements: [
        actionButton(573, "Publish Article Alpha"),
        actionButton(574, "Publish Article Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft articles Article Beta Publish Article Beta",
      pageContent: "Draft articles Article Beta Publish Article Beta",
      elements: [actionButton(574, "Publish Article Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Publish Article Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 573 },
      result: "Clicked element 573.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Published Article Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "post",
      targetLabel: "Article Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:post:article-alpha",
        detail: expect.objectContaining({
          action: "post",
          source: "target_disappearance",
          text: "Posted target no longer visible: Article Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects post target-disappearance evidence for the wrong requested article", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Draft articles Article Alpha Publish Article Alpha Article Beta Publish Article Beta",
      pageContent:
        "Draft articles Article Alpha Publish Article Alpha Article Beta Publish Article Beta",
      elements: [
        actionButton(573, "Publish Article Alpha"),
        actionButton(574, "Publish Article Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft articles Article Alpha Publish Article Alpha",
      pageContent: "Draft articles Article Alpha Publish Article Alpha",
      elements: [actionButton(573, "Publish Article Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Publish Article Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 574 },
      result: "Clicked element 574.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Published Article Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "post",
      targetLabel: "Article Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:post:article-beta",
        detail: expect.objectContaining({
          action: "post",
          source: "target_disappearance",
          text: "Posted target no longer visible: Article Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer post confirmation while the named draft article remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Draft articles Article Alpha Publish Article Alpha",
      pageContent: "Draft articles Article Alpha Publish Article Alpha",
      elements: [actionButton(573, "Publish Article Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft articles Article Alpha Publish Article Alpha",
      pageContent: "Draft articles Article Alpha Publish Article Alpha",
      elements: [actionButton(573, "Publish Article Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 573 },
      result: "Clicked element 573.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer post confirmation from a generic publish article control", () => {
    const genericPublishArticleButton: TaggedElement = {
      tag: 573,
      tagName: "button",
      role: "button",
      text: "Publish article",
      attributes: {
        id: "publish-article",
        "aria-label": "Publish article",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Draft articles Article Alpha Publish article",
      pageContent: "Draft articles Article Alpha Publish article",
      elements: [genericPublishArticleButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft articles",
      pageContent: "Draft articles",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 573 },
      result: "Clicked element 573.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts restart confirmation from named service disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Restart queue Service Alpha Restart Service Alpha Service Beta Restart Service Beta",
      pageContent:
        "Restart queue Service Alpha Restart Service Alpha Service Beta Restart Service Beta",
      elements: [
        actionButton(575, "Restart Service Alpha"),
        actionButton(576, "Restart Service Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Restart queue Service Beta Restart Service Beta",
      pageContent: "Restart queue Service Beta Restart Service Beta",
      elements: [actionButton(576, "Restart Service Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Restart Service Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 575 },
      result: "Clicked element 575.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Restarted Service Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "restart",
      targetLabel: "Service Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:restart:service-alpha",
        detail: expect.objectContaining({
          action: "restart",
          source: "target_disappearance",
          text: "Restarted target no longer visible: Service Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects restart target-disappearance evidence for the wrong requested service", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Restart queue Service Alpha Restart Service Alpha Service Beta Restart Service Beta",
      pageContent:
        "Restart queue Service Alpha Restart Service Alpha Service Beta Restart Service Beta",
      elements: [
        actionButton(575, "Restart Service Alpha"),
        actionButton(576, "Restart Service Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Restart queue Service Alpha Restart Service Alpha",
      pageContent: "Restart queue Service Alpha Restart Service Alpha",
      elements: [actionButton(575, "Restart Service Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Restart Service Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 576 },
      result: "Clicked element 576.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Restarted Service Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "restart",
      targetLabel: "Service Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:restart:service-beta",
        detail: expect.objectContaining({
          action: "restart",
          source: "target_disappearance",
          text: "Restarted target no longer visible: Service Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts refresh confirmation from named report disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Refresh queue Report Alpha Refresh Report Alpha Report Beta Refresh Report Beta",
      pageContent:
        "Refresh queue Report Alpha Refresh Report Alpha Report Beta Refresh Report Beta",
      elements: [
        actionButton(577, "Refresh Report Alpha"),
        actionButton(578, "Refresh Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Refresh queue Report Beta Refresh Report Beta",
      pageContent: "Refresh queue Report Beta Refresh Report Beta",
      elements: [actionButton(578, "Refresh Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Refresh Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 577 },
      result: "Clicked element 577.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Refreshed Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "refresh",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:refresh:report-alpha",
        detail: expect.objectContaining({
          action: "refresh",
          source: "target_disappearance",
          text: "Refreshed target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer restart confirmation from a generic restart service control", () => {
    const genericRestartButton: TaggedElement = {
      tag: 575,
      tagName: "button",
      role: "button",
      text: "Restart service",
      attributes: {
        id: "restart-service",
        "aria-label": "Restart service",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Service Alpha Restart service",
      pageContent: "Service Alpha Restart service",
      elements: [genericRestartButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Services",
      pageContent: "Services",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 575 },
      result: "Clicked element 575.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer refresh confirmation from a browser page refresh control", () => {
    const pageRefreshButton: TaggedElement = {
      tag: 577,
      tagName: "button",
      role: "button",
      text: "Refresh page",
      attributes: {
        id: "refresh-page",
        "aria-label": "Refresh page",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Settings page Refresh page",
      pageContent: "Settings page Refresh page",
      elements: [pageRefreshButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Settings",
      pageContent: "Settings",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 577 },
      result: "Clicked element 577.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts create confirmation from named form disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent: "New customer Name Customer Alpha Create customer",
      pageContent: "New customer Name Customer Alpha Create customer",
      elements: [
        textField(575, "Name", "Customer Alpha"),
        actionButton(576, "Create customer"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Customers",
      pageContent: "Customers",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Create Customer Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 576 },
      result: "Clicked element 576.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Created Customer Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "create",
      targetLabel: "Customer Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:create:form:customer-alpha",
        detail: expect.objectContaining({
          action: "create",
          source: "form_disappearance",
          targetText: "Customer Alpha",
          text: "Create form no longer visible: Customer Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects create form-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent: "New customer Name Customer Beta Create customer",
      pageContent: "New customer Name Customer Beta Create customer",
      elements: [
        textField(575, "Name", "Customer Beta"),
        actionButton(576, "Create customer"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Customers",
      pageContent: "Customers",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Create Customer Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 576 },
      result: "Clicked element 576.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Created Customer Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "create",
      targetLabel: "Customer Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:create:form:customer-beta",
        detail: expect.objectContaining({
          action: "create",
          source: "form_disappearance",
          targetText: "Customer Beta",
          text: "Create form no longer visible: Customer Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts create confirmation from visible created-row when form resets", () => {
    const pre = workflowSnapshot({
      visibleContent: "New customer Name Customer Alpha Create customer",
      pageContent: "New customer Name Customer Alpha Create customer",
      elements: [
        textField(575, "Name", "Customer Alpha"),
        actionButton(576, "Create customer"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "New customer Name Create customer Customers Customer Alpha Active",
      pageContent:
        "New customer Name Create customer Customers Customer Alpha Active",
      elements: [
        textField(575, "Name", ""),
        actionButton(576, "Create customer"),
        rowElement(610, "Customer Alpha Active"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Create Customer Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 576 },
      result: "Clicked element 576.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Created Customer Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "create",
      targetLabel: "Customer Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:create:row:customer-alpha",
        detail: expect.objectContaining({
          action: "create",
          source: "created_row",
          targetText: "Customer Alpha",
          text: "Created row visible: Customer Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects visible created-row evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent: "New customer Name Customer Beta Create customer",
      pageContent: "New customer Name Customer Beta Create customer",
      elements: [
        textField(575, "Name", "Customer Beta"),
        actionButton(576, "Create customer"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "New customer Name Create customer Customers Customer Beta Active",
      pageContent:
        "New customer Name Create customer Customers Customer Beta Active",
      elements: [
        textField(575, "Name", ""),
        actionButton(576, "Create customer"),
        rowElement(610, "Customer Beta Active"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Create Customer Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 576 },
      result: "Clicked element 576.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Created Customer Alpha.",
    });

    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:create:row:customer-beta",
        detail: expect.objectContaining({
          action: "create",
          source: "created_row",
          targetText: "Customer Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer created-row evidence from plain visible text", () => {
    const pre = workflowSnapshot({
      visibleContent: "New customer Name Customer Alpha Create customer",
      pageContent: "New customer Name Customer Alpha Create customer",
      elements: [
        textField(575, "Name", "Customer Alpha"),
        actionButton(576, "Create customer"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "New customer Name Create customer Customer Alpha was mentioned in help text",
      pageContent:
        "New customer Name Create customer Customer Alpha was mentioned in help text",
      elements: [
        textField(575, "Name", ""),
        actionButton(576, "Create customer"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 576 },
      result: "Clicked element 576.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer created-row evidence from a row that already existed", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Customers Customer Alpha Active New customer Name Customer Alpha Create customer",
      pageContent:
        "Customers Customer Alpha Active New customer Name Customer Alpha Create customer",
      elements: [
        rowElement(610, "Customer Alpha Active"),
        textField(575, "Name", "Customer Alpha"),
        actionButton(576, "Create customer"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Customers Customer Alpha Active New customer Name Create customer",
      pageContent:
        "Customers Customer Alpha Active New customer Name Create customer",
      elements: [
        rowElement(610, "Customer Alpha Active"),
        textField(575, "Name", ""),
        actionButton(576, "Create customer"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 576 },
      result: "Clicked element 576.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer create confirmation while the named form remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "New customer Name Customer Alpha Create customer",
      pageContent: "New customer Name Customer Alpha Create customer",
      elements: [
        textField(575, "Name", "Customer Alpha"),
        actionButton(576, "Create customer"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "New customer Name Customer Alpha Create customer",
      pageContent: "New customer Name Customer Alpha Create customer",
      elements: [
        textField(575, "Name", "Customer Alpha"),
        actionButton(576, "Create customer"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 576 },
      result: "Clicked element 576.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer create confirmation from a generic create control without a target field", () => {
    const pre = workflowSnapshot({
      visibleContent: "Customers Customer Alpha Create customer",
      pageContent: "Customers Customer Alpha Create customer",
      elements: [actionButton(576, "Create customer")],
    });
    const current = workflowSnapshot({
      visibleContent: "Customers",
      pageContent: "Customers",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 576 },
      result: "Clicked element 576.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer create confirmation when validation appears after form submission", () => {
    const pre = workflowSnapshot({
      visibleContent: "New customer Name Customer Alpha Create customer",
      pageContent: "New customer Name Customer Alpha Create customer",
      elements: [
        textField(575, "Name", "Customer Alpha"),
        actionButton(576, "Create customer"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Name is required. Please fill the required field.",
      pageContent: "Name is required. Please fill the required field.",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 576 },
      result: "Clicked element 576.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts save confirmation from named draft disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending drafts Draft Alpha Save Draft Alpha Draft Beta Save Draft Beta",
      pageContent:
        "Pending drafts Draft Alpha Save Draft Alpha Draft Beta Save Draft Beta",
      elements: [
        actionButton(551, "Save Draft Alpha"),
        actionButton(552, "Save Draft Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending drafts Draft Beta Save Draft Beta",
      pageContent: "Pending drafts Draft Beta Save Draft Beta",
      elements: [actionButton(552, "Save Draft Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Save Draft Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 551 },
      result: "Clicked element 551.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Saved Draft Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "save",
      targetLabel: "Draft Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:save:draft-alpha",
        detail: expect.objectContaining({
          action: "save",
          source: "target_disappearance",
          text: "Saved target no longer visible: Draft Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects save target-disappearance evidence for the wrong requested draft", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending drafts Draft Alpha Save Draft Alpha Draft Beta Save Draft Beta",
      pageContent:
        "Pending drafts Draft Alpha Save Draft Alpha Draft Beta Save Draft Beta",
      elements: [
        actionButton(551, "Save Draft Alpha"),
        actionButton(552, "Save Draft Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending drafts Draft Alpha Save Draft Alpha",
      pageContent: "Pending drafts Draft Alpha Save Draft Alpha",
      elements: [actionButton(551, "Save Draft Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Save Draft Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 552 },
      result: "Clicked element 552.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Saved Draft Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "save",
      targetLabel: "Draft Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:save:draft-beta",
        detail: expect.objectContaining({
          action: "save",
          source: "target_disappearance",
          text: "Saved target no longer visible: Draft Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer save confirmation while the named draft remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending drafts Draft Alpha Save Draft Alpha",
      pageContent: "Pending drafts Draft Alpha Save Draft Alpha",
      elements: [actionButton(551, "Save Draft Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending drafts Draft Alpha Save Draft Alpha",
      pageContent: "Pending drafts Draft Alpha Save Draft Alpha",
      elements: [actionButton(551, "Save Draft Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 551 },
      result: "Clicked element 551.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer save confirmation from a generic save draft control", () => {
    const genericSaveDraftButton: TaggedElement = {
      tag: 551,
      tagName: "button",
      role: "button",
      text: "Save draft",
      attributes: {
        id: "save-draft",
        "aria-label": "Save draft",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending drafts Draft Alpha Save draft",
      pageContent: "Pending drafts Draft Alpha Save draft",
      elements: [genericSaveDraftButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending drafts",
      pageContent: "Pending drafts",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 551 },
      result: "Clicked element 551.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts update confirmation from named package disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending updates Package Alpha Update Package Alpha Package Beta Update Package Beta",
      pageContent:
        "Pending updates Package Alpha Update Package Alpha Package Beta Update Package Beta",
      elements: [
        actionButton(549, "Update Package Alpha"),
        actionButton(550, "Update Package Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending updates Package Beta Update Package Beta",
      pageContent: "Pending updates Package Beta Update Package Beta",
      elements: [actionButton(550, "Update Package Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Update Package Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 549 },
      result: "Clicked element 549.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Updated Package Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "update",
      targetLabel: "Package Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:update:package-alpha",
        detail: expect.objectContaining({
          action: "update",
          source: "target_disappearance",
          text: "Updated target no longer visible: Package Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects update target-disappearance evidence for the wrong requested package", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending updates Package Alpha Update Package Alpha Package Beta Update Package Beta",
      pageContent:
        "Pending updates Package Alpha Update Package Alpha Package Beta Update Package Beta",
      elements: [
        actionButton(549, "Update Package Alpha"),
        actionButton(550, "Update Package Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending updates Package Alpha Update Package Alpha",
      pageContent: "Pending updates Package Alpha Update Package Alpha",
      elements: [actionButton(549, "Update Package Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Update Package Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 550 },
      result: "Clicked element 550.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Updated Package Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "update",
      targetLabel: "Package Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:update:package-beta",
        detail: expect.objectContaining({
          action: "update",
          source: "target_disappearance",
          text: "Updated target no longer visible: Package Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer update confirmation while the named package remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending updates Package Alpha Update Package Alpha",
      pageContent: "Pending updates Package Alpha Update Package Alpha",
      elements: [actionButton(549, "Update Package Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending updates Package Alpha Update Package Alpha",
      pageContent: "Pending updates Package Alpha Update Package Alpha",
      elements: [actionButton(549, "Update Package Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 549 },
      result: "Clicked element 549.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer update confirmation from a generic update package control", () => {
    const genericUpdatePackageButton: TaggedElement = {
      tag: 549,
      tagName: "button",
      role: "button",
      text: "Update package",
      attributes: {
        id: "update-package",
        "aria-label": "Update package",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending updates Package Alpha Update package",
      pageContent: "Pending updates Package Alpha Update package",
      elements: [genericUpdatePackageButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending updates",
      pageContent: "Pending updates",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 549 },
      result: "Clicked element 549.",
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

  test("accepts send confirmation from visible submitted draft row", () => {
    const draftText = "Hi David, Monday at 2 PM works for me.";
    const pre = draftSnapshot({
      visibleContent: `Email thread Reply message ${draftText} Send reply`,
      pageContent: `Email thread Reply message ${draftText} Send reply`,
      elements: [
        ...(draftSnapshot().elements ?? []),
        actionButton(302, "Send reply"),
      ],
    });
    const current = draftSnapshot({
      visibleContent: `Email thread Sent ${draftText}`,
      pageContent: `Email thread Sent ${draftText}`,
      elements: [
        {
          ...textField(301, "Reply message", ""),
          tagName: "textarea",
          attributes: {
            id: "reply-message",
            name: "reply-message",
            label: "Reply message",
            value: "",
          },
        },
        actionButton(302, "Send reply"),
        rowElement(640, `Sent ${draftText}`),
      ],
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
        logicalKey: "workflow:confirmation:send:draft-row:reply-message",
        detail: expect.objectContaining({
          action: "send",
          source: "submitted_draft_row",
          targetText: draftText,
          text: "Sent draft visible as row: Reply message",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects submitted draft row evidence for the wrong requested target", () => {
    const draftText = "Beta rollout message: please review before Friday.";
    const pre = draftSnapshot({
      visibleContent: `Email thread Reply message ${draftText} Send reply`,
      pageContent: `Email thread Reply message ${draftText} Send reply`,
      elements: [
        {
          ...textField(301, "Reply message", draftText),
          tagName: "textarea",
          attributes: {
            id: "reply-message",
            name: "reply-message",
            label: "Reply message",
            value: draftText,
          },
        },
        actionButton(302, "Send reply"),
      ],
    });
    const current = draftSnapshot({
      visibleContent: `Email thread Sent ${draftText}`,
      pageContent: `Email thread Sent ${draftText}`,
      elements: [
        {
          ...textField(301, "Reply message", ""),
          tagName: "textarea",
          attributes: {
            id: "reply-message",
            name: "reply-message",
            label: "Reply message",
            value: "",
          },
        },
        actionButton(302, "Send reply"),
        rowElement(640, `Sent ${draftText}`),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Send the Alpha rollout message.",
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
      summary: "Sent the Alpha rollout message.",
    });

    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:send:draft-row:reply-message",
        detail: expect.objectContaining({
          action: "send",
          source: "submitted_draft_row",
          targetText: draftText,
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer submitted draft row while the editor still contains the draft", () => {
    const draftText = "Hi David, Monday at 2 PM works for me.";
    const pre = draftSnapshot({
      elements: [
        ...(draftSnapshot().elements ?? []),
        actionButton(302, "Send reply"),
      ],
    });
    const current = draftSnapshot({
      visibleContent: `Email thread Reply message ${draftText} Sent ${draftText}`,
      pageContent: `Email thread Reply message ${draftText} Sent ${draftText}`,
      elements: [
        ...(draftSnapshot().elements ?? []),
        actionButton(302, "Send reply"),
        rowElement(640, `Sent ${draftText}`),
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

  test("does not infer submitted draft row from a row that already existed", () => {
    const draftText = "Hi David, Monday at 2 PM works for me.";
    const pre = draftSnapshot({
      visibleContent: `Email thread Reply message ${draftText} Sent ${draftText} Send reply`,
      pageContent: `Email thread Reply message ${draftText} Sent ${draftText} Send reply`,
      elements: [
        ...(draftSnapshot().elements ?? []),
        actionButton(302, "Send reply"),
        rowElement(640, `Sent ${draftText}`),
      ],
    });
    const current = draftSnapshot({
      visibleContent: `Email thread Sent ${draftText}`,
      pageContent: `Email thread Sent ${draftText}`,
      elements: [
        {
          ...textField(301, "Reply message", ""),
          tagName: "textarea",
          attributes: {
            id: "reply-message",
            name: "reply-message",
            label: "Reply message",
            value: "",
          },
        },
        actionButton(302, "Send reply"),
        rowElement(640, `Sent ${draftText}`),
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

});
