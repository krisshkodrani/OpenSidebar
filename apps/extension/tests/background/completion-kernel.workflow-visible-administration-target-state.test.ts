import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromSnapshot,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import type { DomSnapshot } from "../../src/types";

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

describe("completion kernel target-aware visible enable/disable workflow confirmation", () => {
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

  test("accepts shadow action status for the requested activation target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Web Components Interaction Status Action: notifications",
      pageContent: "Web Components Interaction Status Action: notifications",
    });
    const generated = generateCompletionContract({
      userRequest: "Activate Notification Settings.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Activated Notification Settings.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
      targetLabel: "Notification Settings",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:enable",
          detail: expect.objectContaining({
            action: "enable",
            source: "visible_text",
            text: "Action: notifications",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts shadow action status when the requested target includes click instructions", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Web Components Interaction Status Action: notifications",
      pageContent: "Web Components Interaction Status Action: notifications",
    });
    const generated = generateCompletionContract({
      userRequest:
        "Activate the Notification Settings action by clicking its toggle or button.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Activated Notification Settings.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
      targetLabel: "Notification Settings",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts visible cart state as add-to-cart confirmation", () => {
    const snap = workflowSnapshot({
      title: "Northstar Outfitters - Performance Running",
      url: "https://example.test/shop",
      visibleContent:
        "Cart: 1 Open Cart Your Cart Air Zoom Pegasus 41 Size 8 | black Unit $149.00 Qty 1 Subtotal $149.00",
      pageContent:
        "Cart: 1 Open Cart Your Cart Air Zoom Pegasus 41 Size 8 | black Unit $149.00 Qty 1 Subtotal $149.00",
    });
    const generated = generateCompletionContract({
      userRequest: "Add Pegasus 41 shoes to cart from the Performance Running catalog.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Successfully added Pegasus 41 shoes to cart.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "create",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:create",
          detail: expect.objectContaining({
            action: "create",
            source: "visible_text",
            text: expect.stringContaining("Air Zoom Pegasus 41"),
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts multi-item cart state for the requested added item", () => {
    const snap = workflowSnapshot({
      title: "Northstar Outfitters - Performance Running",
      url: "https://example.test/shop",
      visibleContent:
        "Cart: 2 Open Cart Your Cart Air Zoom Pegasus 41 Size 10 | black Unit $149.00 Qty 1 Novablast 4 Size 10 | black Unit $140.00 Qty 1 Subtotal $289.00",
      pageContent:
        "Cart: 2 Open Cart Your Cart Air Zoom Pegasus 41 Size 10 | black Unit $149.00 Qty 1 Novablast 4 Size 10 | black Unit $140.00 Qty 1 Subtotal $289.00",
    });
    const generated = generateCompletionContract({
      userRequest: "Add Novablast 4 shoes to cart from the product catalog.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Successfully added Novablast 4 shoes to the cart.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "create",
    });
    expect(decision.status).toBe("accepted");
  });

  test("uses current worker objective instead of prior cart action history", () => {
    const snap = workflowSnapshot({
      title: "Northstar Outfitters - Performance Running",
      url: "https://example.test/shop",
      visibleContent:
        "Cart: 2 Open Cart Your Cart Air Zoom Pegasus 41 Size 10 | black Unit $149.00 Qty 1 Novablast 4 Size 10 | black Unit $140.00 Qty 1 Subtotal $289.00",
      pageContent:
        "Cart: 2 Open Cart Your Cart Air Zoom Pegasus 41 Size 10 | black Unit $149.00 Qty 1 Novablast 4 Size 10 | black Unit $140.00 Qty 1 Subtotal $289.00",
    });
    const workerRequest = [
      "Objective: Add Novablast 4 shoes to cart from the Performance Running catalog",
      "Success criteria: Cart shows Novablast 4, cart counter displays 2+",
      "",
      "Original user request (reference for specific values - names, emails, codes):",
      "I'd like to order the Pegasus 41 shoes and the Novablast 4 shoes. Use coupon SAVE10 for the discount.",
      "",
      "Page history from prior steps on this tab:",
      "Prior actions (Add Pegasus 41 shoes to cart from the Performance Running catalog):",
      'T1: click_element [58] -> Clicked [58] button "Add Air Zoom Pegasus 41 to cart"',
    ].join("\n");
    const generated = generateCompletionContract({
      userRequest: workerRequest,
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "Objective already satisfied. The cart displays Novablast 4 and the cart counter reads 2.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "create",
      targetLabel: "Novablast 4 shoes to cart",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts visible coupon status as coupon-code confirmation", () => {
    const snap = workflowSnapshot({
      title: "Northstar Outfitters - Performance Running",
      url: "https://example.test/shop",
      visibleContent:
        "Your Cart Promo code SAVE10 Coupon status: SAVE10 applied successfully. Discount -$14.90",
      pageContent:
        "Your Cart Promo code SAVE10 Coupon status: SAVE10 applied successfully. Discount -$14.90",
    });
    const generated = generateCompletionContract({
      userRequest: "Open cart and apply coupon code SAVE10 in the promo input.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Coupon SAVE10 is applied.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "update",
      targetLabel: "coupon code SAVE10",
    });
    expect(decision.status).toBe("accepted");
  });

  test("rejects shadow action status for a different activation target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Web Components Interaction Status Action: notifications",
      pageContent: "Web Components Interaction Status Action: notifications",
    });
    const generated = generateCompletionContract({
      userRequest: "Activate Privacy Settings.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Activated Privacy Settings.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
      targetLabel: "Privacy Settings",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
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

});
