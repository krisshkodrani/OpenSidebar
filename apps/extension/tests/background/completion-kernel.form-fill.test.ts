import { describe, expect, test } from "vitest";
import "../setup";
import {
  buildCompletionRecoveryHint,
  deriveCompletionEvidenceFromSnapshot,
  deriveCompletionEvidenceFromToolOutcome,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import { ToolName, type DomSnapshot, type TaggedElement } from "../../src/types";

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


describe("completion kernel form-fill", () => {
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
});
