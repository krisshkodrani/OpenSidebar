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

function selectField(
  tag: number,
  label: string,
  value: string,
  text = "",
): TaggedElement {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    tag,
    tagName: "select",
    role: "combobox",
    text,
    attributes: {
      id: key,
      name: key,
      value,
      selected: value,
      label,
    },
    rect: { x: 0, y: tag * 20, width: 180, height: 24 },
    isVisible: true,
    isDisabled: false,
  };
}

function buttonElement(tag: number, label: string): TaggedElement {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    tag,
    tagName: "button",
    role: "button",
    text: label,
    attributes: {
      id: key,
      name: key,
      label,
    },
    rect: { x: 0, y: tag * 20, width: 140, height: 32 },
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

  test("does not infer a message-body fill from an open-only composer request", () => {
    const messageBody = {
      ...textField(301, "Message body"),
      tagName: "textarea",
      attributes: {
        ...textField(301, "Message body").attributes,
        placeholder: "Write your message here...",
      },
    };
    const generated = generateCompletionContract({
      userRequest:
        'Open the message composer on the Social Feed page\nSuccess criteria: The subtask outcome for "Open the message composer on the Social Feed page" is verified on the page or in tool output.',
      snapshot: formSnapshot({
        title: "Social Feed",
        url: "https://example.test/social-feed",
        visibleContent:
          'Welcome to your feed. Click "Compose Message" to open the message editor. Message Composer',
        pageContent:
          'Welcome to your feed. Click "Compose Message" to open the message editor. Message Composer',
        elements: [messageBody],
      }),
    });

    expect(generated?.contract.kind).not.toBe("form_fill");
  });

  test("still infers message-body fill when the request has explicit fill intent", () => {
    const messageBody = {
      ...textField(301, "Message body"),
      tagName: "textarea",
      attributes: {
        ...textField(301, "Message body").attributes,
        placeholder: "Write your message here...",
      },
    };
    const generated = generateCompletionContract({
      userRequest: "Fill the message body with Launch update ready.",
      snapshot: formSnapshot({
        elements: [messageBody],
      }),
    });

    expect(generated?.contract).toMatchObject({
      kind: "form_fill",
      requiredFields: [
        { label: "Message body", value: "Launch update ready." },
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

  test("does not require submit because decorated skill text mentions submit", () => {
    const snap = formSnapshot({
      title: "Modal & Overlay Test",
      url: "https://example.test/modal-overlays",
      visibleContent: "Account Settings Notification Email user@test.com",
      pageContent: "Account Settings Notification Email user@test.com",
      elements: [textField(201, "Notification Email", "user@test.com", "email")],
    });
    const generated = generateCompletionContract({
      userRequest: `
Selected workflow skill:
- structured-form-fill: Fill a form with submit-last discipline.
Skill procedure:
11. Submit only when all requested values are present.
Completion checks:
- After submit, a success state is visible when the user requested submission.

Original user request (reference for specific values):
Close any popups on the page, set the notification email to user@test.com, then delete the account and confirm.
`,
      activeObjective:
        "Open the notification email settings and set the email to user@test.com",
      successCriteria: "Notification email field shows user@test.com",
      snapshot: snap,
    });

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 5),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "The notification email field shows user@test.com.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "form_fill",
      requiresSubmit: false,
      requiresConfirmation: false,
      requiredFields: [{ label: "Notification Email", value: "user@test.com" }],
    });
    expect(decision.status).toBe("accepted");
  });

  test("ignores planner-injected save intent for field-only tasks without a submit control", () => {
    const snap = formSnapshot({
      title: "Modal & Overlay Test",
      url: "https://example.test/modal-overlays",
      visibleContent: "Account Settings Notification Email user@test.com Delete Account",
      pageContent: "Account Settings Notification Email user@test.com Delete Account",
      elements: [
        textField(201, "Notification Email", "user@test.com", "email"),
        buttonElement(202, "Delete Account"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: `Original user request (reference for specific values):
Close any popups on the page, set the notification email to user@test.com, then delete the account and confirm.`,
      activeObjective:
        "Open the notification settings and set the email field to user@test.com, then save/apply the change",
      successCriteria:
        "Notification email field displays 'user@test.com' and a save/confirmation indicator is visible",
      snapshot: snap,
    });

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 5),
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "Notification email field verified and set to user@test.com. No explicit save/apply button exists on this page.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "form_fill",
      requiresSubmit: false,
      requiresConfirmation: false,
      requiredFields: [{ label: "Notification Email", value: "user@test.com" }],
    });
    expect(decision.status).toBe("accepted");
  });

  test("keeps user-requested save tasks submit-required", () => {
    const snap = formSnapshot({
      title: "Profile",
      url: "https://example.test/profile",
      visibleContent: "Profile Notification Email Save",
      pageContent: "Profile Notification Email Save",
      elements: [
        textField(201, "Notification Email", "user@test.com", "email"),
        buttonElement(202, "Save"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Save the notification email as user@test.com.",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 5),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "The notification email field shows user@test.com.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "form_fill",
      requiresSubmit: true,
      requiresConfirmation: true,
    });
    expect(decision.status).toBe("needs_verification");
  });
  test("trims sentence punctuation from inferred email values", () => {
    const generated = generateCompletionContract({
      userRequest: "Checkout as Alex Morgan, email: alex.morgan@example.com.",
      snapshot: formSnapshot({
        elements: [textField(201, "Email Address", "", "email")],
      }),
    });

    expect(generated?.contract).toMatchObject({
      kind: "form_fill",
      requiredFields: [
        { label: "Email Address", value: "alex.morgan@example.com" },
      ],
    });
  });

  test("does not include page history in inferred email values", () => {
    const generated = generateCompletionContract({
      userRequest: `Original user request (reference for specific values):
Name: Alex Morgan, email: alex.morgan@example.com.

Page history from prior steps on this tab:
Prior actions (Add Novablast 4 shoes to cart): done() REJECTED: summary was cut off.`,
      activeObjective: "Fill checkout contact fields",
      successCriteria:
        "Full name shows Alex Morgan and Email address shows alex.morgan@example.com.",
      snapshot: formSnapshot({
        elements: [
          textField(201, "Full name"),
          textField(202, "Email address", "", "email"),
        ],
      }),
    });

    expect(generated?.contract).toMatchObject({
      kind: "form_fill",
      requiredFields: [
        { label: "Full name", value: "Alex Morgan" },
        { label: "Email address", value: "alex.morgan@example.com" },
      ],
    });
  });

  test("does not infer future checkout fields during a cart-only active objective", () => {
    const generated = generateCompletionContract({
      userRequest: `
Original user request (reference for specific values):
I'd like to order the Pegasus 41 shoes and the Novablast 4 shoes. Use coupon SAVE10 for the discount. Ship express please. Name: Alex Morgan, email: alex.morgan@example.com.
`,
      activeObjective: "Add Pegasus 41 shoes to cart from the Performance Running catalog",
      successCriteria: "Cart shows Pegasus 41, cart counter displays 1+",
      snapshot: formSnapshot({
        title: "Northstar Outfitters - Performance Running",
        url: "https://example.test/shop",
        visibleContent:
          "Northstar Outfitters Your Cart Air Zoom Pegasus 41 Size 8 | black Unit $149.00 Qty 1 Subtotal $149.00 Checkout Full name Email address",
        pageContent:
          "Northstar Outfitters Your Cart Air Zoom Pegasus 41 Size 8 | black Unit $149.00 Qty 1 Subtotal $149.00 Checkout Full name Email address",
        elements: [
          textField(201, "Full name"),
          textField(202, "Email address", "", "email"),
        ],
      }),
    });

    expect(generated?.contract.kind).not.toBe("form_fill");
  });

  test("uses active coupon scope without pulling checkout fields forward", () => {
    const generated = generateCompletionContract({
      userRequest: `Original user request (reference for specific values):
Add the Air Zoom Pegasus 41 to cart, apply coupon SAVE10, choose express shipping, and checkout as Alex Morgan (alex.morgan@example.com).

Page history from prior steps on this tab:
Prior actions (Add Air Zoom Pegasus 41 to cart): completed.`,
      activeObjective: "Open cart and apply coupon code SAVE10 in the promo input",
      successCriteria: "Coupon SAVE10 applied and discount is visible",
      snapshot: formSnapshot({
        title: "Northstar Outfitters - Performance Running",
        url: "https://example.test/shop",
        visibleContent:
          "Your Cart Promo code Full name Email address Shipping method",
        pageContent:
          "Your Cart Promo code Full name Email address Shipping method",
        elements: [
          textField(172, "Promo code"),
          textField(173, "Full name"),
          textField(174, "Email address", "", "email"),
        ],
      }),
    });

    expect(generated?.contract).toMatchObject({
      kind: "form_fill",
      requiredFields: [{ label: "Promo code", value: "SAVE10" }],
    });
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

  test("does not treat page error title as active form validation after send success", () => {
    const snap = formSnapshot({
      title: "Error Recovery Test",
      url: "https://example.test/errors",
      visibleContent:
        "Error Scenarios Contact Form Email address Message Message sent successfully!",
      pageContent:
        "Error Scenarios Contact Form Email address Message Message sent successfully!",
      elements: [
        textField(201, "Email address", "test@example.com"),
        textField(
          202,
          "Message",
          "Hello, this is a test message for the contact form",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest:
        "Fill out the contact form with email test@example.com and message 'Hello, this is a test message for the contact form' and send it.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 6);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "The contact form was filled and sent. The page shows Message sent successfully.",
    });

    expect(
      evidence.some((event) => event.type === "validation_error"),
    ).toBe(false);
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "form:confirmation",
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts configured product option state with derived price", () => {
    const snap = formSnapshot({
      title: "Custom Product Configurator",
      url: "https://example.test/dynamic-compute",
      visibleContent:
        "Custom Product Configurator Premium Water Bottle Size Large (32 oz) Add custom engraving (+$15) Your configuration: large / black / engraved $112.50",
      pageContent:
        "Custom Product Configurator Premium Water Bottle Size Large (32 oz) Add custom engraving (+$15) Your configuration: large / black / engraved $112.50",
      elements: [
        checkboxField(101, "Add custom engraving", true),
        selectField(
          102,
          "Size",
          "large",
          "Small (16 oz) Medium (24 oz) Large (32 oz)",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest:
        "Configure the product: pick the Large (32 oz) size, enable custom engraving, and tell me the total price.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 4);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "Large (32 oz) is selected, custom engraving is enabled, and the total price is $112.50.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "form_fill",
      requiresSubmit: false,
      requiresConfirmation: false,
      requiredFields: [
        { label: "Add custom engraving", value: "true" },
        { label: "Size", value: "large" },
      ],
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not use success criteria prose as scoped field values", () => {
    const snap = formSnapshot({
      title: "Checkout",
      url: "https://example.test/shop",
      visibleContent: "Checkout Enter code Full name Email address",
      pageContent: "Checkout Enter code Full name Email address",
      elements: [
        textField(172, "Enter code", "SAVE10"),
        textField(173, "Full name", "Alex Morgan"),
        textField(174, "Email address", "alex.morgan@example.com"),
        buttonElement(179, "Apply"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest:
        "Name: Alex Morgan, email: alex.morgan@example.com. Use coupon SAVE10.",
      activeObjective:
        "Enter SAVE10 in the Enter code promo/discount input and submit it.",
      successCriteria:
        "Discount line shows SAVE10. Full name field shows Alex Morgan. Email input fields are visible.",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 5),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "The SAVE10 coupon, Alex Morgan name, and alex.morgan@example.com email are visible.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "form_fill",
      requiredFields: expect.arrayContaining([
        expect.objectContaining({ label: "Enter code", value: "SAVE10" }),
      ]),
    });
    expect(JSON.stringify(generated?.contract)).not.toContain("field shows");
    expect(JSON.stringify(generated?.contract)).not.toContain("Discount line shows");
    expect(decision.status).not.toBe("rejected");
  });
  test("keeps coupon code value concise when original request has trailing instructions", () => {
    const snap = formSnapshot({
      title: "Checkout",
      url: "https://example.test/shop",
      visibleContent: "Checkout Enter code Discount SAVE10",
      pageContent: "Checkout Enter code Discount SAVE10",
      elements: [textField(172, "Enter code", "SAVE10"), buttonElement(179, "Apply")],
    });
    const generated = generateCompletionContract({
      userRequest:
        "I'd like to order shoes. Use coupon SAVE10 for the discount. Ship express please.",
      activeObjective: "Enter coupon in the Enter code field and apply it.",
      successCriteria: "Discount line shows SAVE10.",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 5),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "SAVE10 is entered and the discount is visible.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "form_fill",
      requiredFields: [expect.objectContaining({ label: "Enter code", value: "SAVE10" })],
    });
    expect(JSON.stringify(generated?.contract)).not.toContain("Ship express");
    expect(decision.status).not.toBe("rejected");
  });
  test("accepts coupon form completion when applied confirmation is visible", () => {
    const snap = formSnapshot({
      title: "Checkout",
      url: "https://example.test/shop",
      visibleContent:
        "Checkout Enter code Coupon status: SAVE10 applied successfully. Coupon applied: 10% off Discount - $28.90",
      pageContent:
        "Checkout Enter code Coupon status: SAVE10 applied successfully. Coupon applied: 10% off Discount - $28.90",
      elements: [textField(172, "Enter code", "SAVE10"), buttonElement(179, "Apply")],
    });
    const generated = generateCompletionContract({
      userRequest:
        "I'd like to order shoes. Use coupon SAVE10 for the discount. Ship express please.",
      activeObjective: "Enter coupon in the Enter code field and apply it.",
      successCriteria: "Coupon SAVE10 applied and discount is visible.",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 5),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "SAVE10 is applied and the discount is visible.",
    });

    expect(decision.status).toBe("accepted");
  });
});
