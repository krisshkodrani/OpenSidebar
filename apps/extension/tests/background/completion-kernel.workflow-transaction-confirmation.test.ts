import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromSnapshot,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import type { DomSnapshot } from "../../src/types";

function transactionSnapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    title: "Checkout",
    url: "https://example.test/checkout",
    visibleContent: "Checkout",
    pageContent: "Checkout",
    elements: [],
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    ...overrides,
  };
}

describe("completion kernel transactional confirmation", () => {
  test("accepts a submit/order objective when an order receipt is visible", () => {
    const snap = transactionSnapshot({
      visibleContent: [
        "Thank you for your order",
        "Order #NS-01001",
        "Status: confirmed",
        "Air Zoom Pegasus 41",
        "Novablast 4",
        "SAVE10 applied",
        "Shipping: Express",
        "Total $275.10",
      ].join("\n"),
      pageContent: [
        "Thank you for your order",
        "Order #NS-01001",
        "Status: confirmed",
        "Air Zoom Pegasus 41",
        "Novablast 4",
        "SAVE10 applied",
        "Shipping: Express",
        "Total $275.10",
      ].join("\n"),
    });
    const generated = generateCompletionContract({
      userRequest: "Complete order submission and verify confirmation",
      snapshot: snap,
      activeObjective: "Complete order submission and verify confirmation",
      successCriteria: "Order confirmation page with order ID or thank you message visible",
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 9);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "Order submission is complete and confirmed. Order #NS-01001 is visible with the requested items, SAVE10 discount, express shipping, and total $275.10.",
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
          detail: expect.objectContaining({
            action: "submit",
            source: "visible_text",
            text: expect.stringContaining("Order #NS-01001"),
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("does not accept an ungrounded order summary with a different order id", () => {
    const snap = transactionSnapshot({
      visibleContent: "Order #NS-01001\nStatus: confirmed\nReceipt",
      pageContent: "Order #NS-01001\nStatus: confirmed\nReceipt",
    });
    const generated = generateCompletionContract({
      userRequest: "Complete order submission and verify confirmation",
      snapshot: snap,
      activeObjective: "Complete order submission and verify confirmation",
      successCriteria: "Order confirmation page with order ID visible",
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 9);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Order #NS-99999 is confirmed.",
    });

    expect(decision.status).toBe("inconclusive");
  });
});